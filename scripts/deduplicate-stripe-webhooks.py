#!/usr/bin/env python3
"""One hidden signing-secret prompt; reuse CLI login and backend Stripe key."""
import base64
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request

spec = importlib.util.spec_from_file_location('setup', Path(__file__).with_name('configure-stripe-webhook.py'))
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)
ORIGINAL = 'we_1UFn7YQg8UTscDtyMlgwUZy0'
ADDITIONAL = 'we_1UFnTvQg8UTscDtyzYEbRfnv'


def login():
    token = os.environ.get('SUPABASE_ACCESS_TOKEN')
    if not token and sys.platform == 'darwin':
        result = subprocess.run(['security', 'find-generic-password', '-s', 'Supabase CLI', '-a', 'supabase', '-w'], capture_output=True, text=True)
        if result.returncode == 0:
            token = result.stdout.strip()
            if token.startswith('go-keyring-base64:'):
                token = base64.b64decode(token.split(':', 1)[1]).decode()
    if not token:
        raise setup.SafeError('CLI login unavailable. Run: npm_config_cache=/tmp/fetchit-npm-cache npx --yes supabase@2.39.2 login')
    setup.REDACTIONS.append(token)
    return token


def validate_signing_secret(value):
    """Classify obvious paste mistakes without exposing input or fixing key bytes.

    There is no fixed-length requirement; cryptographic verification determines
    whether an otherwise plausible signing secret is the working secret.
    """
    value = value.strip()
    if not value:
        raise setup.SafeError('Empty input. Paste the revealed original webhook signing secret.')
    if any(char in value for char in '.•●·∙⋅…*'):
        raise setup.SafeError('Masked or abbreviated input. Reveal and copy the full signing secret in Stripe.')
    if value.startswith(('sk_', 'pk_', 'rk_', 'sb_', 'sbp_', 'eyJ')):
        raise setup.SafeError('Wrong key type. A webhook signing secret is required, not an API key or access token.')
    if value.startswith(('we_', 'acct_', 'http://', 'https://')):
        raise setup.SafeError('An endpoint ID, account ID, or URL was entered instead of a signing secret.')
    if value.startswith('STRIPE_WEBHOOK_SECRET='):
        raise setup.SafeError('Variable assignment pasted. Enter only the signing-secret value.')
    if value.startswith(('"', "'", '`')):
        raise setup.SafeError('Quoted input. Enter the signing-secret value without surrounding quotes.')
    if not value.startswith('whsec_'):
        raise setup.SafeError('Missing webhook signing-secret prefix. Copy the revealed value beginning with whsec_.')
    if not value[len('whsec_'):]:
        raise setup.SafeError('Incomplete input. The signing-secret prefix has no value after it.')
    if any(char.isspace() for char in value):
        raise setup.SafeError('Whitespace inside the signing secret. Copy the value as one uninterrupted string.')
    if any(ord(char) < 32 or char in '\u200b\u200c\u200d\ufeff' for char in value):
        raise setup.SafeError('Hidden formatting characters inside the input. Copy the plain signing-secret value.')
    return value


def main():
    token = login()
    secret = validate_signing_secret(setup.hidden(f'Original webhook {ORIGINAL} signing secret (hidden): '))
    body = json.dumps({'id': 'evt_fetchit_cleanup_proof', 'object': 'event', 'type': 'fetchit.webhook_cleanup',
                       'livemode': True, 'data': {'object': {'retain': ORIGINAL, 'disable': ADDITIONAL}}}).encode()
    timestamp = str(int(time.time()))
    digest = hmac.new(secret.encode(), timestamp.encode() + b'.' + body, hashlib.sha256).hexdigest()
    headers = {'Content-Type': 'application/json', 'Stripe-Signature': f't={timestamp},v1={digest}'}
    # Send only a signature, never the signing secret itself.
    def post(url, admin=False):
        request = urllib.request.Request(url, method='POST', data=body,
                  headers={**headers, **({'Authorization': 'Bearer ' + token} if admin else {})})
        try:
            with setup.OPENER.open(request, timeout=60) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            # Only this controlled handler's error code is exposed, never a raw response.
            try:
                code = json.load(error).get('error', 'request_failed')
                if not isinstance(code, str) or not all(c.islower() or c == '_' for c in code):
                    code = 'request_failed'
            except (ValueError, AttributeError):
                code = 'request_failed'
            raise setup.SafeError(f'HTTP {error.code}: {code}. No secrets changed; inspect endpoint status before retrying.') from None
    probe = post(setup.URL)
    if probe.get('received') is not True or probe.get('ignored') is not True:
        raise setup.SafeError('Original secret not verified by deployed handler. Nothing disabled.')
    result = post(setup.URL.replace('/stripe-webhook', '/stripe-webhook-cleanup'), admin=True)
    if result.get('retained') != ORIGINAL or result.get('disabled') != ADDITIONAL or result.get('originalSecretVerified') is not True:
        raise setup.SafeError('Cleanup result not verified; inspect Dashboard. No secrets changed.')
    print('Retained:', ORIGINAL, '(enabled; original signing secret verified)')
    print('Disabled:', ADDITIONAL)
    print('No endpoints deleted, working secrets changed, or financial transactions created.')


if __name__ == '__main__':
    try:
        main()
    except setup.SafeError as error:
        print(setup.sanitize(error), file=sys.stderr)
        sys.exit(1)
    except (EOFError, KeyboardInterrupt):
        print('Stopped. No secrets logged; inspect status if interrupted during cleanup.', file=sys.stderr)
        sys.exit(1)
    except Exception:
        print('Request failed. Details withheld to protect credentials; inspect endpoint status before retrying.', file=sys.stderr)
        sys.exit(1)
