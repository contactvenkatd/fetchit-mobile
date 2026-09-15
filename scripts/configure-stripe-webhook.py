#!/usr/bin/env python3
"""Configure only FetchIt's webhook and Supabase signing secret. No payments.
Run in your own interactive terminal. Credentials are hidden and memory-only.
"""
import base64
import getpass
import hashlib
import json
import os
import re
import subprocess
import sys
import warnings
import urllib.error
import urllib.parse
import urllib.request

PROJECT = 'fpphpncruohjlppqhfep'
URL = f'https://{PROJECT}.supabase.co/functions/v1/stripe-webhook'
VERSION = '2025-02-24.acacia'
DESCRIPTION = 'FetchIt Production Webhook'
EVENTS = [
    'customer.subscription.created', 'customer.subscription.updated',
    'customer.subscription.deleted', 'customer.subscription.paused',
    'customer.subscription.resumed', 'invoice.paid', 'invoice.payment_failed',
    'invoice.payment_action_required',
]
REDACTIONS = []


class SafeError(Exception):
    pass


def sanitize(value):
    text = str(value)
    for secret in REDACTIONS:
        if secret:
            text = text.replace(secret, '[REDACTED]')
    return re.sub(r'(?:[srp]k_(?:live|test)_|whsec_|sbp_|sb_secret_)[A-Za-z0-9_*.-]+',
                  '[REDACTED]', text)


def hidden(prompt):
    if not sys.stdin.isatty():
        raise SafeError('Run this script in your own interactive terminal; hidden input requires a TTY.')
    # getpass otherwise falls back to echoed input when terminal controls fail.
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        try:
            value = getpass.getpass(prompt).strip()
        except getpass.GetPassWarning:
            raise SafeError('Hidden input is unavailable in this terminal. Nothing entered or changed.') from None
    REDACTIONS.append(value)
    return value


# Reject redirects rather than risk forwarding Authorization to another host.
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = urllib.request.build_opener(NoRedirect())


def request(url, credential, method='GET', data=None, stripe=False, idempotency=None):
    headers = {'Authorization': 'Bearer ' + credential}
    if data is not None:
        if stripe:
            body = urllib.parse.urlencode(data, doseq=True).encode()
            headers['Content-Type'] = 'application/x-www-form-urlencoded'
        else:
            body = json.dumps(data).encode()
            headers['Content-Type'] = 'application/json'
    else:
        body = None
    if stripe:
        headers['Stripe-Version'] = VERSION
    if idempotency:
        headers['Idempotency-Key'] = idempotency
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with OPENER.open(req, timeout=60) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        if stripe:
            try:
                detail = json.loads(error.read()).get('error', {})
                safe = {k: sanitize(detail[k]) for k in ['type', 'code', 'param', 'message'] if k in detail}
            except (ValueError, TypeError, AttributeError):
                safe = {'message': 'Non-JSON error body withheld.'}
            raise SafeError(f'Stripe HTTP {error.code}: ' + json.dumps(safe)) from None
        raise SafeError(f'Supabase HTTP {error.code}; response body withheld.') from None
    except (urllib.error.URLError, TimeoutError):
        raise SafeError('Network request failed; no raw response logged. Rerun to inspect existing endpoints before retrying creation.') from None


def supabase_token():
    token = os.environ.get('SUPABASE_ACCESS_TOKEN')
    if not token and sys.platform == 'darwin':
        result = subprocess.run(['security', 'find-generic-password', '-s', 'Supabase CLI',
                                 '-a', 'supabase', '-w'], capture_output=True, text=True)
        if result.returncode == 0:
            token = result.stdout.strip()
            if token.startswith('go-keyring-base64:'):
                token = base64.b64decode(token.split(':', 1)[1]).decode()
    token = token or hidden('Supabase personal access token (hidden; dashboard account/tokens): ')
    REDACTIONS.append(token)
    return token


def verify(endpoint):
    expected = (endpoint.get('url') == URL and endpoint.get('api_version') == VERSION
                and endpoint.get('livemode') is True and endpoint.get('status') == 'enabled'
                and sorted(endpoint.get('enabled_events', [])) == sorted(EVENTS)
                and endpoint.get('application') is None)
    if not expected:
        raise SafeError('Existing/returned endpoint does not match required URL, live mode, version, exact events, enabled status or own-account scope. No duplicate or substitute created. Inspect Stripe Dashboard.')


def main():
    # Deliberately do not load Stripe keys from old env files or cached CLI keys.
    stripe_key = hidden('Newly rotated LIVE Stripe secret from the intended account (hidden): ')
    if not stripe_key.startswith('sk_live_'):
        raise SafeError('A newly rotated sk_live_ secret is required. Nothing changed.')
    token = supabase_token()
    management = f'https://api.supabase.com/v1/projects/{PROJECT}'
    request(management + '/secrets', token)  # Check access before creating anything.
    stripe = 'https://api.stripe.com/v1'
    account = request(stripe + '/account', stripe_key, stripe=True)
    balance = request(stripe + '/balance', stripe_key, stripe=True)
    if balance.get('livemode') is not True:
        raise SafeError('Stripe did not confirm live mode. Nothing changed.')
    print('Authenticated Stripe account:', account['id'])
    matches = []
    cursor = None
    while True:
        query = {'limit': 100}
        if cursor:
            query['starting_after'] = cursor
        page = request(stripe + '/webhook_endpoints?' + urllib.parse.urlencode(query), stripe_key, stripe=True)
        matches.extend(e for e in page['data'] if e.get('url', '').rstrip('/') == URL.rstrip('/'))
        if not page.get('has_more'):
            break
        if not page['data']:
            raise SafeError('Invalid endpoint pagination; stopped without creating a duplicate.')
        cursor = page['data'][-1]['id']
    if len(matches) > 1:
        raise SafeError('Multiple endpoints already use this URL. Resolve duplicates in Stripe Dashboard; nothing changed.')
    if matches:
        endpoint = matches[0]
        verify(endpoint)
        print('Reusing verified endpoint:', endpoint['id'])
        # Stripe does not return an existing endpoint's signing secret on GET.
        signing_secret = hidden('Existing destination signing secret from Stripe Dashboard (hidden): ')
    else:
        params = {'url': URL, 'api_version': VERSION, 'connect': 'false',
                  'enabled_events[]': EVENTS, 'description': DESCRIPTION}
        fingerprint = hashlib.sha256(json.dumps(params, sort_keys=True).encode()).hexdigest()
        endpoint = request(stripe + '/webhook_endpoints', stripe_key, method='POST', data=params,
                           stripe=True, idempotency='fetchit-webhook-' + fingerprint)
        signing_secret = endpoint.get('secret', '')
        REDACTIONS.append(signing_secret)
        verify(endpoint)
        print('Created endpoint:', endpoint['id'])
    if not signing_secret.startswith('whsec_'):
        raise SafeError('Signing secret missing/invalid. Endpoint retained; obtain its signing secret in Stripe Dashboard and rerun.')
    # Retrieve independently; never print the create response containing secret.
    persisted = request(stripe + '/webhook_endpoints/' + endpoint['id'], stripe_key, stripe=True)
    verify(persisted)
    while True:
        try:
            request(management + '/secrets', token, method='POST',
                    data=[{'name': 'STRIPE_WEBHOOK_SECRET', 'value': signing_secret}])
            secrets = request(management + '/secrets', token)
            if not any(s.get('name') == 'STRIPE_WEBHOOK_SECRET' for s in secrets):
                raise SafeError('Signing secret was not found after save.')
            break
        except SafeError as error:
            print(sanitize(error))
            print('Endpoint remains created; signing secret is still held only in this process memory.')
            if input('Retry Supabase save? [y/N]: ').strip().lower() != 'y':
                raise SafeError('Save not verified. Retrieve the signing secret in Stripe Dashboard and save it securely to Supabase.')
    print(json.dumps({k: persisted.get(k) for k in ['id', 'url', 'api_version', 'livemode', 'enabled_events', 'status']}, indent=2))
    print('STRIPE_WEBHOOK_SECRET saved to production Supabase. No payment was attempted.')
    print('STRIPE_SECRET_KEY was not changed. Account/publishable-key pairing still requires Dashboard confirmation.')


if __name__ == '__main__':
    try:
        main()
    except SafeError as error:
        print(sanitize(error), file=sys.stderr)
        sys.exit(1)
    except (KeyboardInterrupt, EOFError):
        print('Stopped. No credentials logged.', file=sys.stderr)
        sys.exit(1)
    except Exception:
        print('Unexpected failure; details withheld to protect credentials. Check endpoint existence before rerunning.', file=sys.stderr)
        sys.exit(1)
