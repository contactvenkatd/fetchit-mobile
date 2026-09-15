"""Offline input and verification-order tests; dummy credentials only."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
import warnings
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('cleanup', Path(__file__).resolve().parents[1] / 'scripts/deduplicate-stripe-webhooks.py')
cleanup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleanup)


class CleanupInputTests(unittest.TestCase):
    def test_variable_lengths_and_surrounding_whitespace(self):
        for suffix in ['a', 'offline_fixture', 'A1' * 200]:
            value = 'whsec_' + suffix
            self.assertEqual(cleanup.validate_signing_secret(' \t\n\u00a0' + value + '\r\n '), value)

    def test_reasons_without_disclosing_input(self):
        cases = [('', 'Empty'), (' \t ', 'Empty'), ('••••••', 'Masked'),
                 ('whsec_...masked', 'Masked'), ('whsec_●●●', 'Masked'),
                 ('whsec_***', 'Masked'), ('whsec_…', 'Masked'),
                 ('sk_live_dummy', 'Wrong key type'), ('pk_live_dummy', 'Wrong key type'),
                 ('rk_live_dummy', 'Wrong key type'), ('we_dummy', 'endpoint ID'),
                 ('STRIPE_WEBHOOK_SECRET=whsec_dummy', 'assignment'),
                 ('"whsec_dummy"', 'Quoted'), ('dummy_input', 'Missing'),
                 ('whsec_', 'Incomplete'), ('whsec_a b', 'Whitespace inside'),
                 ('whsec_a\u200bb', 'Hidden formatting')]
        for value, reason in cases:
            with self.subTest(reason=reason):
                with self.assertRaises(cleanup.setup.SafeError) as caught:
                    cleanup.validate_signing_secret(value)
                self.assertIn(reason, str(caught.exception))
                if value.strip() and value != 'whsec_':
                    self.assertNotIn(value.strip(), str(caught.exception))

    def test_hidden_input_trims_without_output(self):
        output = io.StringIO()
        with patch.object(cleanup.setup.sys.stdin, 'isatty', return_value=True), patch.object(cleanup.setup.getpass, 'getpass', return_value=' \twhsec_dummy\n'), contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            self.assertEqual(cleanup.setup.hidden('Hidden: '), 'whsec_dummy')
        self.assertEqual(output.getvalue(), '')

    def test_echo_fallback_is_refused(self):
        def fallback(_):
            warnings.warn('Cannot control echo', cleanup.setup.getpass.GetPassWarning)
            self.fail('Must stop before echoed fallback')
        with patch.object(cleanup.setup.sys.stdin, 'isatty', return_value=True), patch.object(cleanup.setup.getpass, 'getpass', side_effect=fallback):
            with self.assertRaisesRegex(cleanup.setup.SafeError, 'Hidden input is unavailable'):
                cleanup.setup.hidden('Hidden: ')

    def test_invalid_input_makes_no_requests(self):
        with patch.object(cleanup, 'login', return_value='dummy_admin'), patch.object(cleanup.setup, 'hidden', return_value='••••'), patch.object(cleanup.setup.OPENER, 'open') as network:
            with self.assertRaises(cleanup.setup.SafeError):
                cleanup.main()
            network.assert_not_called()

    def test_probe_must_pass_before_cleanup(self):
        for succeeds in [False, True]:
            calls = []
            def opened(req, **kwargs):
                calls.append(req)
                self.assertNotIn(b'whsec_dummy', req.data)
                if len(calls) == 1:
                    return io.BytesIO(json.dumps({'received': succeeds, 'ignored': succeeds}).encode())
                return io.BytesIO(json.dumps({'retained': cleanup.ORIGINAL, 'disabled': cleanup.ADDITIONAL, 'originalSecretVerified': True}).encode())
            output = io.StringIO()
            with patch.object(cleanup, 'login', return_value='dummy_admin'), patch.object(cleanup.setup, 'hidden', return_value=' \twhsec_dummy\n') as prompt, patch.object(cleanup.setup.OPENER, 'open', side_effect=opened), contextlib.redirect_stdout(output):
                if succeeds:
                    cleanup.main()
                else:
                    with self.assertRaises(cleanup.setup.SafeError):
                        cleanup.main()
            self.assertEqual(prompt.call_count, 1)
            self.assertEqual(len(calls), 2 if succeeds else 1)
            self.assertTrue(calls[0].full_url.endswith('/stripe-webhook'))
            if succeeds:
                self.assertTrue(calls[1].full_url.endswith('/stripe-webhook-cleanup'))
            self.assertNotIn('whsec_dummy', output.getvalue())


if __name__ == '__main__':
    unittest.main()
