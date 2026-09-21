import contextlib
import getpass
import importlib.util
import io
import os
import json
import plistlib
import tempfile
import zipfile
from pathlib import Path
import unittest
from unittest.mock import patch, MagicMock
import warnings

spec = importlib.util.spec_from_file_location('upload', Path(__file__).parents[1] / 'scripts/submit-testflight.py')
upload = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upload)


class UploadTests(unittest.TestCase):
    def test_trim_without_format_assumptions(self):
        for value in ['AAAA-b2B2-cCcC-9d9D', 'Mixed123!different-length', 'aaaa-bbbb-cccc-dddd']:
            self.assertEqual(upload.validate_password(' \n' + value + '\t '), value)

    def test_bad_paste_errors_never_echo_input(self):
        for value in ['', '  ', 'fixture secret', 'fixture\u200bsecret']:
            with self.assertRaises(upload.UploadError) as error:
                upload.validate_password(value)
            if value.strip():
                self.assertNotIn(value, str(error.exception))

    def test_hidden_input_fails_closed(self):
        def fallback(*args):
            warnings.warn('echo unavailable', getpass.GetPassWarning)
            return 'must-not-be-used'
        with patch.dict(os.environ, {}, clear=True), patch.object(upload.getpass, 'getpass', side_effect=fallback):
            with self.assertRaises(upload.UploadError):
                upload.read_password()

    def test_invalid_input_never_downloads_or_uploads(self):
        with patch.dict(os.environ, {upload.PASSWORD_ENV: '  '}, clear=True), patch.object(upload, 'fetch_artifact') as fetch, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(upload.main(), 1)
            fetch.assert_not_called()

    def test_password_only_in_upload_environment_and_output_is_redacted(self):
        password = 'Fixture-secret-123'
        child = MagicMock()
        child.stdout = iter(['upstream echoed ' + password + '\n'])
        child.wait.return_value = 0
        process = MagicMock()
        process.__enter__.return_value = child
        output = io.StringIO()
        with patch.object(upload.subprocess, 'Popen', return_value=process) as popen, contextlib.redirect_stdout(output):
            self.assertEqual(upload.run_apple(['--build-status'], {upload.PASSWORD_ENV: password}, password)['returncode'], 0)
            self.assertNotIn(password, str(popen.call_args.args))
            self.assertEqual(popen.call_args.kwargs['env'][upload.PASSWORD_ENV], password)
        self.assertNotIn(password, output.getvalue())
        self.assertIn('[REDACTED]', output.getvalue())

    def test_rejection_90683_overrides_zero_exit_and_upload_success(self):
        result = upload.parse_apple_output("""
= BUILD-STATUS: FAILED
= DELIVERY-UUID: 1cf5efc4-b790-415d-acf6-bd36586813d2
= PROCESSING-ERRORS:
  code : 90683
= IMPORT-STATUS: FAILED
= IS-ON-APP-STORE-CONNECT: false
No errors uploading archive at '/tmp/fixture.ipa'.
""", 0)
        self.assertTrue(result['failed'])
        self.assertFalse(upload.imported(result))
        self.assertEqual(result['delivery_id'], '1cf5efc4-b790-415d-acf6-bd36586813d2')

    def test_complete_transfer_is_not_complete_import(self):
        for text in ['', 'No errors uploading archive.', '= BUILD-STATUS: UPLOAD_COMPLETE',
                     '= BUILD-STATUS: PROCESSING\n= IMPORT-STATUS: PROCESSING\n= IS-ON-APP-STORE-CONNECT: false']:
            self.assertFalse(upload.imported(upload.parse_apple_output(text, 0)))
        ready = '= BUILD-STATUS: VALID\n= IMPORT-STATUS: COMPLETE\n= IS-ON-APP-STORE-CONNECT: true'
        self.assertTrue(upload.imported(upload.parse_apple_output(ready, 0)))
        self.assertFalse(upload.imported(upload.parse_apple_output(ready, 1)))

    def test_artifact_rejects_missing_camera_and_wrong_build(self):
        info = {'CFBundleIdentifier': 'ai.compreo.fetchit',
                'CFBundleShortVersionString': upload.VERSION,
                'CFBundleVersion': upload.BUILD_NUMBER,
                'NSCameraUsageDescription': json.loads((upload.PROJECT / 'app.json').read_text())['expo']['ios']['infoPlist']['NSCameraUsageDescription']}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'fixture.ipa'
            for values, valid in [(info, True),
                                  ({k: v for k, v in info.items() if k != 'NSCameraUsageDescription'}, False),
                                  ({**info, 'CFBundleVersion': '6'}, False)]:
                with zipfile.ZipFile(path, 'w') as archive:
                    archive.writestr('Payload/fetchitmobile.app/Info.plist', plistlib.dumps(values))
                if valid:
                    upload.verify_artifact(path)
                else:
                    with self.assertRaises(upload.UploadError):
                        upload.verify_artifact(path)

    def test_status_has_all_required_flags(self):
        args = upload.status_arguments('11111111-2222-3333-4444-555555555555')
        for flag, value in [('--delivery-id', '11111111-2222-3333-4444-555555555555'),
                            ('--platform', 'ios'), ('--bundle-short-version-string', '1.0.0'),
                            ('--bundle-version', upload.BUILD_NUMBER)]:
            self.assertEqual(args[args.index(flag) + 1], value)

    def test_upload_records_delivery_then_checks_status(self):
        delivery = '11111111-2222-3333-4444-555555555555'
        uploaded = upload.parse_apple_output('DELIVERY-UUID: ' + delivery)
        ready = upload.parse_apple_output('BUILD-STATUS: VALID\nIMPORT-STATUS: COMPLETE\nIS-ON-APP-STORE-CONNECT: true')
        with patch.object(upload, 'read_password', return_value='Fixture'), patch.object(upload, 'read_receipt', return_value=None), patch.object(upload, 'save_receipt') as save, patch.object(upload, 'fetch_artifact', return_value=Path('/tmp/fixture.ipa')), patch.object(upload, 'run_apple', side_effect=[uploaded, ready]) as apple, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(upload.main(), 0)
            save.assert_called_once_with(delivery)
            self.assertEqual(apple.call_args_list[1].args[0], upload.status_arguments(delivery))

    def test_saved_delivery_resumes_status_without_duplicate_upload(self):
        with patch.object(upload, 'read_password', return_value='Fixture'), patch.object(upload, 'read_receipt', return_value='11111111-2222-3333-4444-555555555555'), patch.object(upload, 'fetch_artifact') as fetch, patch.object(upload, 'run_apple', return_value=upload.parse_apple_output('IMPORT-STATUS: FAILED')) as apple, contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(upload.main(), 1)
            fetch.assert_not_called()
            self.assertEqual(apple.call_count, 1)
            self.assertEqual(apple.call_args.args[0][0], '--build-status')

    def test_failed_upload_is_not_retried(self):
        with patch.object(upload, 'read_password', return_value='Fixture'), patch.object(upload, 'read_receipt', return_value=None), patch.object(upload, 'fetch_artifact', return_value=Path('/tmp/fixture.ipa')), patch.object(upload, 'run_apple', return_value=upload.parse_apple_output('IMPORT-STATUS: FAILED', 0)) as apple, contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(upload.main(), 1)
            self.assertEqual(apple.call_count, 1)


if __name__ == '__main__':
    unittest.main()
