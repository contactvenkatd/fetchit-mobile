#!/usr/bin/env python3
"""Read four existing Zinc resources. No writes, retries, redirects, or key storage.

References:
https://www.zinc.com/docs/v2/api-reference/introduction/authentication
https://www.zinc.com/docs/v2/api-reference/orders/get-order
https://www.zinc.com/docs/v2/api-reference/orders/get-order-timeline
"""
import datetime
import base64
import getpass
import hashlib
import hmac
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
import warnings

BASE_URL = 'https://api.zinc.com'
ORDER_IDS = (
    'ca260bad-0964-40d5-8150-dde5357a30aa',
    'b4b16775-2ae9-4de8-99d8-c4688c282e54',
)
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
PROJECT_REF = 'fpphpncruohjlppqhfep'


class SafeError(Exception):
    """Only static, non-sensitive messages may enter this exception."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = urllib.request.build_opener(NoRedirect())


def verify_production_key(key):
    """Compare in memory with Supabase's SHA256 secret digest; GET only."""
    token = os.environ.get('SUPABASE_ACCESS_TOKEN')
    if not token and sys.platform == 'darwin':
        result = subprocess.run(
            ['security', 'find-generic-password', '-s', 'Supabase CLI',
             '-a', 'supabase', '-w'], capture_output=True, text=True)
        if result.returncode == 0:
            token = result.stdout.strip()
            if token.startswith('go-keyring-base64:'):
                token = base64.b64decode(token.split(':', 1)[1]).decode()
    if not token:
        raise SafeError('Supabase CLI login unavailable; production key identity remains unknown.')
    request = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{PROJECT_REF}/secrets',
        headers={'Authorization': f'Bearer {token}'}, method='GET')
    try:
        with OPENER.open(request, timeout=30) as response:
            data = response.read(MAX_RESPONSE_BYTES + 1)
        if len(data) > MAX_RESPONSE_BYTES:
            raise SafeError('Secret metadata response too large; key identity remains unknown.')
        secrets = json.loads(data)
    except (urllib.error.URLError, TimeoutError, ValueError):
        raise SafeError('Secret metadata lookup failed; key identity remains unknown.') from None
    finally:
        token = None
    if not isinstance(secrets, list):
        raise SafeError('Invalid secret metadata; key identity remains unknown.')
    secret = next((item for item in secrets if isinstance(item, dict)
                   and item.get('name') == 'ZINC_API_KEY'), None)
    digest = secret.get('value') if secret else None
    if not isinstance(digest, str) or not re.fullmatch(r'[a-fA-F0-9]{64}', digest):
        raise SafeError('Zinc secret digest unavailable; key identity remains unknown.')
    return {
        'matches_current_fetchit_zinc_key': hmac.compare_digest(
            hashlib.sha256(key.encode()).hexdigest(), digest.lower()),
        'configured_key_updated_at': safe_timestamp(secret.get('updated_at'), key),
        'supplied_key_mode': ('live' if key.startswith('zn_live_') else
                              'test' if key.startswith('zn_test_') else 'unknown'),
    }


def hidden_key():
    if not sys.stdin.isatty():
        raise SafeError('Run in an interactive terminal; hidden input requires a TTY.')
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        try:
            key = getpass.getpass('Production Zinc API key used by FetchIt (hidden): ').strip()
        except getpass.GetPassWarning:
            raise SafeError('Hidden input is unavailable. No key was read or sent.') from None
    if not key:
        raise SafeError('Empty key. No requests sent.')
    if key.startswith(('Bearer ', 'ZINC_API_KEY=', '"', "'", '`')):
        raise SafeError('Enter only the API key, without an assignment, Bearer prefix, or quotes.')
    if not key.isascii() or any(char.isspace() or ord(char) < 33 or ord(char) == 127 for char in key):
        raise SafeError('The key contains whitespace or unsupported formatting. No requests sent.')
    return key


def safe_code(value, key):
    # Accept machine codes, never arbitrary upstream messages or terminal escapes.
    if not isinstance(value, str) or not re.fullmatch(r'[a-z][a-z0-9_]{0,79}', value):
        return None
    if key and key.lower() in value.lower():
        return None
    if value.startswith(('zn_', 'zinc_', 'sk_', 'pk_', 'rk_', 'whsec_', 'sb_', 'eyj')):
        return None
    return value


def safe_id(value, prefix, key):
    # Underscores after the prefix are forbidden: pi_*_secret_* never passes.
    if not isinstance(value, str) or not re.fullmatch(re.escape(prefix) + r'[A-Za-z0-9]{1,128}', value):
        return None
    return None if key and key in value else value


def safe_timestamp(value, key):
    if not isinstance(value, str) or (key and key in value):
        return None
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})', value):
        return None
    try:
        stamp = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
        return stamp.astimezone(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')
    except ValueError:
        return None


def obj(value):
    return value if isinstance(value, dict) else {}


def error_codes(value, key):
    value = obj(value)
    error = obj(value.get('error'))
    details = obj(value.get('error_details'))
    return {
        'error_type': safe_code(value.get('error_type'), key),
        'error_code': safe_code(details.get('code') or error.get('code') or value.get('code'), key),
    }


def connect_summary(value, key):
    value = obj(value)
    return {
        'state': safe_code(value.get('state'), key),
        'simulated': value.get('simulated') if type(value.get('simulated')) is bool else None,
        'payment_intent_id': safe_id(value.get('payment_intent_id'), 'pi_', key),
        'connected_account_id': safe_id(value.get('connected_account_id'), 'acct_', key),
    }


def sanitize_order(raw, key):
    raw = obj(raw)
    job = obj(raw.get('job_result'))
    return {
        'status': safe_code(raw.get('status'), key),
        'created_at': safe_timestamp(raw.get('created_at'), key),
        'updated_at': safe_timestamp(raw.get('updated_at'), key),
        **error_codes(raw, key),
        'job_result': error_codes(job, key),
        'connect': connect_summary(raw.get('connect'), key),
        'items': [
            {
                'status': safe_code(item.get('status'), key),
                'created_at': safe_timestamp(item.get('created_at'), key),
                'updated_at': safe_timestamp(item.get('updated_at'), key),
                **error_codes(item, key),
            }
            for item in raw.get('items', []) if isinstance(item, dict)
        ] if isinstance(raw.get('items'), list) else [],
    }


def sanitize_timeline(raw, key):
    raw = obj(raw)
    return {
        'current_status': safe_code(raw.get('current_status'), key),
        'milestones': [
            {
                'occurred_at': safe_timestamp(milestone.get('occurred_at'), key),
                'status': safe_code(milestone.get('status') or obj(milestone.get('detail')).get('status'), key),
                **error_codes(obj(milestone.get('detail')), key),
            }
            for milestone in raw.get('milestones', []) if isinstance(milestone, dict)
        ] if isinstance(raw.get('milestones'), list) else [],
    }


def get_resource(order_id, resource, key):
    if order_id not in ORDER_IDS or resource not in ('order', 'timeline'):
        raise SafeError('Resource is outside the fixed diagnostic allowlist.')
    suffix = '/timeline' if resource == 'timeline' else ''
    request = urllib.request.Request(
        BASE_URL + '/orders/' + order_id + suffix,
        headers={'Authorization': 'Bearer ' + key, 'Accept': 'application/json'},
        method='GET',
    )
    try:
        with OPENER.open(request, timeout=30) as response:
            status = response.status
            data = response.read(MAX_RESPONSE_BYTES + 1)
        if len(data) > MAX_RESPONSE_BYTES:
            return {'http_status': status, 'error_code': 'response_too_large'}
        try:
            raw = json.loads(data)
        except (ValueError, UnicodeError):
            return {'http_status': status, 'error_code': 'invalid_json_response'}
        if not isinstance(raw, dict):
            return {'http_status': status, 'error_code': 'invalid_response_shape'}
        # Do not attribute a response for another order to the requested ID.
        returned_id = raw.get('order_id' if resource == 'timeline' else 'id')
        if returned_id != order_id:
            return {'http_status': status, 'error_code': 'response_order_id_mismatch'}
        sanitize = sanitize_timeline if resource == 'timeline' else sanitize_order
        return {'http_status': status, **sanitize(raw, key)}
    except urllib.error.HTTPError as error:
        status = error.code
        # Error bodies can echo credentials. Extract only validated machine
        # codes in memory; never output messages, headers, or the raw body.
        upstream = {}
        try:
            data = error.read(MAX_RESPONSE_BYTES + 1)
            if len(data) <= MAX_RESPONSE_BYTES:
                upstream = error_codes(json.loads(data), key)
        except (ValueError, UnicodeError, OSError):
            pass
        finally:
            error.close()
        code = {
            401: 'authentication_failed', 403: 'access_denied',
            404: 'not_found_in_this_account_or_environment',
            429: 'rate_limited_no_retry',
        }.get(status, 'redirect_refused' if 300 <= status < 400 else 'http_error')
        return {
            'http_status': status, 'error_code': code,
            'upstream_error_type': upstream.get('error_type'),
            'upstream_error_code': upstream.get('error_code'),
        }
    except (TimeoutError, urllib.error.URLError):
        return {'http_status': None, 'error_code': 'network_or_timeout_no_retry'}


def main(args=None):
    args = [] if args is None else args
    if args not in ([], ['--verify-production-key']):
        raise SafeError('Usage: diagnose-zinc-orders.py [--verify-production-key]')
    key = hidden_key()
    failed = False
    try:
        if args:
            identity = verify_production_key(key)
            print(json.dumps({'credential_context': identity}, indent=2))
            if not identity['matches_current_fetchit_zinc_key']:
                # Establish the mismatch before repeating lookups in another account.
                return 1
        for order_id in ORDER_IDS:
            summary = {'zinc_order_id': order_id}
            for resource in ('order', 'timeline'):
                result = get_resource(order_id, resource, key)
                summary[resource] = result
                expected_field = 'status' if resource == 'order' else 'current_status'
                failed = failed or result.get('http_status') != 200 or expected_field not in result
                if result.get('http_status') in (401, 403):
                    print(json.dumps(summary, indent=2))
                    # Avoid sending the same rejected credential again.
                    return 1
            print(json.dumps(summary, indent=2))
        return int(failed)
    finally:
        # No files, environment variables, subprocess arguments, or logs receive
        # the key. Python strings cannot be reliably zeroed; process exit drops it.
        key = None


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except SafeError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except (EOFError, KeyboardInterrupt):
        print('Stopped. No changes made.', file=sys.stderr)
        sys.exit(1)
    except Exception:
        # Tracebacks and raw provider exceptions can contain sensitive content.
        print('Diagnostic failed; raw details withheld. No changes made.', file=sys.stderr)
        sys.exit(1)
