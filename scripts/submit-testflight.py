#!/usr/bin/env python3
"""Upload the existing build with Apple's altool; no rebuild or review submission.

EAS CLI imposes an extra password-format restriction, so EAS is used only to
locate the existing artifact. Apple validates the upload credential itself.
"""
import getpass
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys
import tempfile
import unicodedata
import warnings
import zipfile

PROJECT = Path(__file__).resolve().parents[1]
RELEASE = json.loads((PROJECT / 'config/testflight-release.json').read_text())
BUILD_ID = RELEASE['buildId']
VERSION = RELEASE['version']
BUILD_NUMBER = RELEASE['buildNumber']
RECEIPT = PROJECT / '.expo/testflight-delivery.json'
APP_ID = '6814347211'
APPLE_ID = 'vduddukuri@gmail.com'
PROVIDER_ID = '2f762cc1-a23d-4388-8f66-3b082abecfc7'
PASSWORD_ENV = 'EXPO_APPLE_APP_SPECIFIC_PASSWORD'


class UploadError(Exception):
    """Only static, credential-free messages may be raised here."""


def validate_password(value):
    value = value.strip()
    if not value:
        raise UploadError('No password was entered. Generate an app-specific password at account.apple.com.')
    if any(c.isspace() or unicodedata.category(c).startswith('C') for c in value):
        raise UploadError('The entry contains internal whitespace or hidden characters. Copy only the generated password.')
    # Do not infer credential validity from length, case, grouping, or symbols.
    # Apple is authoritative; preserve all remaining password bytes.
    return value


def read_password():
    value = os.environ.get(PASSWORD_ENV, '')
    if not value:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter('error', getpass.GetPassWarning)
                value = getpass.getpass(f'Apple app-specific password for {APPLE_ID} (hidden): ')
        except (getpass.GetPassWarning, EOFError, KeyboardInterrupt):
            raise UploadError('Run this script in Terminal; password input must remain hidden.') from None
    return validate_password(value)


def clean_environment():
    env = dict(os.environ)
    for name in (PASSWORD_ENV, 'DEBUG', 'EXPO_DEBUG', 'FASTLANE_VERBOSE'):
        env.pop(name, None)
    return env


def verify_artifact(path):
    with zipfile.ZipFile(path) as archive:
        info = plistlib.loads(archive.read('Payload/fetchitmobile.app/Info.plist'))
    if (info.get('CFBundleIdentifier'), info.get('CFBundleShortVersionString'),
            info.get('CFBundleVersion')) != ('ai.compreo.fetchit', VERSION, BUILD_NUMBER):
        raise UploadError('Artifact does not match the selected FetchIt release. Nothing uploaded.')
    expected = json.loads((PROJECT / 'app.json').read_text())['expo']['ios']['infoPlist']['NSCameraUsageDescription']
    if info.get('NSCameraUsageDescription') != expected:
        raise UploadError('Artifact is missing the expected camera purpose string. Nothing uploaded.')


def fetch_artifact(directory, env):
    result = subprocess.run(['eas', 'build:view', BUILD_ID, '--json'], cwd=PROJECT,
                            env=env, capture_output=True, text=True)
    if result.returncode:
        raise UploadError('Could not read the existing EAS build. Run eas login in Terminal and retry.')
    build = json.loads(result.stdout)
    if (build.get('id'), build.get('status'), build.get('appVersion'),
            build.get('appBuildVersion')) != (BUILD_ID, 'FINISHED', VERSION, BUILD_NUMBER):
        raise UploadError('EAS did not return the expected completed replacement build. Nothing uploaded.')
    url = build.get('artifacts', {}).get('buildUrl', '')
    if not url.startswith('https://'):
        raise UploadError('The existing build has no secure artifact download URL.')
    path = Path(directory) / f'FetchIt-{VERSION}-{BUILD_NUMBER}.ipa'
    downloaded = subprocess.run(['curl', '--location', '--fail', '--silent', '--show-error',
                                  '--proto', '=https', '--proto-redir', '=https',
                                  url, '--output', str(path)], env=env, capture_output=True)
    if downloaded.returncode:
        raise UploadError('Could not download the existing IPA. Nothing uploaded.')
    verify_artifact(path)
    return path


def parse_apple_output(text, returncode=0):
    result = {'returncode': returncode, 'delivery_id': None, 'build_status': None,
              'import_status': None, 'on_connect': None, 'failed': returncode != 0}
    for line in text.splitlines():
        delivery = re.search(r'DELIVERY[- _](?:UUID|ID)\s*[:=]\s*([0-9a-fA-F-]{36})', line, re.I)
        if delivery:
            result['delivery_id'] = delivery.group(1)
        for label, key in [('BUILD-STATUS', 'build_status'), ('IMPORT-STATUS', 'import_status')]:
            status = re.search(label + r'\s*:\s*([A-Z_]+)', line, re.I)
            if status:
                value = status.group(1).upper()
                result[key] = value
                if value in {'FAILED', 'FAILURE', 'INVALID', 'REJECTED', 'ERROR', 'CANCELED', 'CANCELLED'}:
                    result['failed'] = True
        present = re.search(r'IS-ON-APP-STORE-CONNECT\s*:\s*(true|false)', line, re.I)
        if present:
            result['on_connect'] = present.group(1).lower() == 'true'
        if re.search(r'\bERROR:|(?:code\s*:\s*|error\s+)90683\b', line, re.I):
            result['failed'] = True
    return result


def imported(result):
    complete = {'VALID', 'COMPLETE', 'COMPLETED', 'SUCCESS', 'SUCCEEDED', 'IMPORTED'}
    # Build distribution status is distinct from import validation status.
    ready_build = complete | {'VALID_BINARY', 'BETA_INTERNAL_TESTING'}
    return (not result['failed'] and result['returncode'] == 0 and result['on_connect'] is True
            and result['build_status'] in ready_build and result['import_status'] in complete)


def internal_testing_available(result):
    return imported(result) and result['build_status'] == 'BETA_INTERNAL_TESTING'


def processing(result):
    pending = {'PROCESSING', 'UPLOAD_COMPLETE'}
    return (not result['failed'] and not imported(result) and
            (result['build_status'] in pending or result['import_status'] in pending))


def run_apple(arguments, env, password):
    command = ['xcrun', 'altool', *arguments, '--username', APPLE_ID,
               '--password', '@env:' + PASSWORD_ENV, '--provider-public-id', PROVIDER_ID]
    lines = []
    with subprocess.Popen(command, env=env, stdout=subprocess.PIPE,
                          stderr=subprocess.STDOUT, text=True) as child:
        for line in child.stdout:
            safe = line.replace(password, '[REDACTED]')
            safe = safe.replace(json.dumps(password)[1:-1], '[REDACTED]')
            lines.append(safe)
            print(safe, end='', flush=True)
        return parse_apple_output(''.join(lines), child.wait())


def status_arguments(delivery_id):
    # altool accepts delivery ID OR app/version selectors, never both.
    return ['--build-status', '--delivery-id', delivery_id, '--wait']


def read_receipt():
    if not RECEIPT.exists():
        return None
    saved = json.loads(RECEIPT.read_text())
    if saved.get('buildId') != BUILD_ID:
        return None
    delivery = saved.get('deliveryId', '')
    if not re.fullmatch(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}', delivery):
        raise UploadError('Invalid delivery receipt. Check Apple processing before retrying.')
    return delivery


def save_receipt(delivery_id):
    # Only public build identifiers are persisted, never credentials or tool logs.
    RECEIPT.parent.mkdir(parents=True, exist_ok=True)
    temporary = RECEIPT.with_suffix('.tmp')
    temporary.write_text(json.dumps({'buildId': BUILD_ID, 'deliveryId': delivery_id,
                                     'version': VERSION, 'buildNumber': BUILD_NUMBER}))
    temporary.replace(RECEIPT)


def main():
    env = clean_environment()
    try:
        password = read_password()
        delivery_id = read_receipt()
        if not delivery_id:
            with tempfile.TemporaryDirectory(prefix='fetchit-testflight-') as directory:
                path = fetch_artifact(directory, env)
                env[PASSWORD_ENV] = password
                print(f'Uploading verified FetchIt {VERSION} ({BUILD_NUMBER}).')
                result = run_apple(['--upload-package', str(path), '--wait'], env, password)
                delivery_id = result['delivery_id']
                if delivery_id:
                    save_receipt(delivery_id)
                if result['failed']:
                    raise UploadError('Apple upload or processing failed. This is not a successful TestFlight import.')
                if not delivery_id:
                    raise UploadError('Upload result has no delivery ID; processing is unverified. Check App Store Connect before uploading again.')
        env[PASSWORD_ENV] = password
        print('Checking Apple processing for the recorded delivery; no duplicate upload will be sent.')
        result = run_apple(status_arguments(delivery_id), env, password)
        if result['failed']:
            raise UploadError('Apple import failed. Check the reported error and saved delivery before retrying; no duplicate upload was sent.')
        if not imported(result):
            if processing(result):
                print('Apple processing is still in progress. Rerun this script to check the saved delivery without uploading again.')
            else:
                print('Apple import has not yet been verified. Check App Store Connect or rerun the saved-delivery status check without uploading again.')
            return 2
        if internal_testing_available(result):
            print(f'Apple confirms FetchIt {VERSION} ({BUILD_NUMBER}) was imported into App Store Connect and is available for internal TestFlight testing.')
        else:
            print(f'Apple confirms FetchIt {VERSION} ({BUILD_NUMBER}) was imported into App Store Connect. Check its TestFlight testing-group availability.')
        return 0
    except UploadError as error:
        print(str(error), file=sys.stderr)
        return 1
    except FileNotFoundError:
        print('Install/sign in to EAS CLI and select Xcode command-line tools, then retry in Terminal.', file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print('\nStopped. Check TestFlight processing before rerunning an upload.', file=sys.stderr)
        return 1
    except Exception:
        # Never include arbitrary exception text that might contain credentials.
        print('Upload preparation or status check failed. Check TestFlight before retrying; no rebuild attempted.', file=sys.stderr)
        return 1
    finally:
        env.pop(PASSWORD_ENV, None)


if __name__ == '__main__':
    sys.exit(main())
