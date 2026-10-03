#!/usr/bin/env python3
"""Switch one production secret using the administrator-verified Connect evidence.
Never places orders. Never prints keys, hashes, raw responses or customer data.
"""
import importlib.util
import hashlib
import hmac
import json
from pathlib import Path
import sys
import urllib.request

spec = importlib.util.spec_from_file_location('diagnostic', Path(__file__).with_name('diagnose-zinc-orders.py'))
diag = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diag)
PROJECT = diag.PROJECT_REF
STRIPE_ACCOUNT = 'acct_1Th9uUQg8UTscDty'
BASE = 'https://api.supabase.com/v1/projects/' + PROJECT
ZINC_USER = 1035
# Authenticated /settings/connect response supplied and explicitly accepted by
# the administrator on 2026-10-03; these are identifiers/booleans, not secrets.
VERIFIED_CONNECT = {
    'user_id': ZINC_USER, 'connected_account_id': STRIPE_ACCOUNT,
    'connect_ready': True, 'charges_enabled': True, 'details_submitted': True,
    'statement_descriptor_ok': True,
}


def request_json(url, headers, method='GET', data=None):
    request = urllib.request.Request(url, headers=headers, method=method,
                                     data=None if data is None else json.dumps(data).encode())
    with diag.OPENER.open(request, timeout=30) as response:
        body = response.read(diag.MAX_RESPONSE_BYTES + 1)
    if len(body) > diag.MAX_RESPONSE_BYTES:
        raise diag.SafeError('Response too large. Raw details withheld.')
    return json.loads(body) if body else None


def inspect_accounts(key, token, read=request_json):
    """Resolve authenticated identities, without any secret update or purchase."""
    if not key.startswith('zn_live_') or len(key) <= len('zn_live_'):
        raise diag.SafeError('A complete live Zinc key is required. Nothing changed.')
    wallet = read('https://api.zinc.com/wallet/me', {'Authorization': 'Bearer ' + key})
    user_id = wallet.get('user_id') if isinstance(wallet, dict) else None
    if type(user_id) is not int or user_id < 1:
        raise diag.SafeError('Zinc account identity could not be verified. Nothing changed.')
    readiness = read('https://' + PROJECT + '.supabase.co/functions/v1/stripe-readiness',
                     {'x-management-token': token})
    account = diag.safe_id(readiness.get('accountId'), 'acct_', key) if isinstance(readiness, dict) else None
    if not account:
        raise diag.SafeError('FetchIt Stripe identity could not be verified. Nothing changed.')
    return {
        'zinc_user_id': user_id, 'supplied_key_mode': 'live',
        'fetchit_stripe_account_id': account,
        'fetchit_stripe_charges_enabled': readiness.get('chargesEnabled') is True,
        'fetchit_stripe_card_payments_active': readiness.get('capabilities', {}).get('card_payments') == 'active',
        'zinc_linked_stripe_account_id': None,
        'zinc_connect_account_verified': False,
        'production_secret_updated': False,
    }


def switch(key, token, read=request_json):
    if not key.startswith('zn_live_') or len(key) <= len('zn_live_'):
        raise diag.SafeError('A complete live Zinc key is required. Nothing changed.')
    wallet = read('https://api.zinc.com/wallet/me', {'Authorization': 'Bearer ' + key})
    if not isinstance(wallet, dict) or type(wallet.get('user_id')) is not int or wallet['user_id'] != ZINC_USER:
        raise diag.SafeError('The live key does not belong to verified Zinc user 1035. Nothing changed.')
    if VERIFIED_CONNECT['connected_account_id'] != STRIPE_ACCOUNT or not all(
            VERIFIED_CONNECT[name] is True for name in
            ('connect_ready', 'charges_enabled', 'details_submitted', 'statement_descriptor_ok')):
        raise diag.SafeError('Verified Connect evidence does not match. Nothing changed.')
    headers = {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}
    functions = read(BASE + '/functions', headers)
    order = next((f for f in functions if f.get('slug') == 'place-order'), None)
    if not order or order.get('status') != 'ACTIVE' or order.get('verify_jwt') is not True or order.get('version', 0) < 11:
        raise diag.SafeError('The production checkout guard is not active. Nothing changed.')
    versions = {f['slug']: f['version'] for f in functions}
    # Exactly one secret update. No retry on an ambiguous update response.
    read(BASE + '/secrets', headers, 'POST', [{'name': 'ZINC_API_KEY', 'value': key}])
    secrets = read(BASE + '/secrets', headers)
    digest = next((x.get('value') for x in secrets if x.get('name') == 'ZINC_API_KEY'), None)
    if not isinstance(digest, str) or not hmac.compare_digest(
            digest.lower(), hashlib.sha256(key.encode()).hexdigest()):
        raise diag.SafeError('Secret update was attempted but its digest is unverified. Do not place an order.')
    after = read(BASE + '/functions', headers)
    if {f['slug']: f['version'] for f in after} != versions:
        raise diag.SafeError('The key digest matches, but function versions changed during setup. Investigate before checkout.')
    return {
        'switch_succeeded': True, 'production_secret_updated': 'ZINC_API_KEY',
        'stored_digest_verified': True, 'configured_key_mode': 'live',
        'zinc_user_id': ZINC_USER, 'connected_stripe_account_id': STRIPE_ACCOUNT,
        'connect_verification_source': 'administrator_supplied_authenticated_settings_response',
        'connect_ready': True, 'production_guard_active': True,
        'place_order_version': order['version'], 'existing_functions_unchanged': True,
        'orders_submitted': 0, 'charges_created': 0,
    }


def verify_stored_key(key, token, read=request_json):
    """Independent read-only check after an interrupted or warned switch."""
    if not key.startswith('zn_live_') or len(key) <= len('zn_live_'):
        raise diag.SafeError('A complete live Zinc key is required. No changes made.')
    wallet = read('https://api.zinc.com/wallet/me', {'Authorization': 'Bearer ' + key})
    if not isinstance(wallet, dict) or type(wallet.get('user_id')) is not int or wallet['user_id'] != ZINC_USER:
        raise diag.SafeError('This live key does not belong to Zinc user 1035. No changes made.')
    secrets = read(BASE + '/secrets', {'Authorization': 'Bearer ' + token})
    secret = next((x for x in secrets if x.get('name') == 'ZINC_API_KEY'), {})
    digest = secret.get('value')
    if not isinstance(digest, str) or not hmac.compare_digest(
            digest.lower(), hashlib.sha256(key.encode()).hexdigest()):
        raise diag.SafeError('The supplied live key does not match the stored production key. No changes made.')
    return {'stored_live_key_verified': True, 'zinc_user_id': ZINC_USER,
            'stored_digest_matches': True, 'secret_updated_at': diag.safe_timestamp(secret.get('updated_at'), key),
            'read_only': True, 'orders_submitted': 0, 'charges_created': 0}


def main():
    if sys.argv[1:] not in ([], ['--inspect'], ['--switch'], ['--verify']):
        raise diag.SafeError('Usage: switch-zinc-live-key.py [--inspect|--switch|--verify]; credentials use hidden input.')
    key = diag.hidden_key()
    try:
        # Existing authenticated CLI login only; no backend key retrieval.
        spec = importlib.util.spec_from_file_location('login', Path(__file__).with_name('deduplicate-stripe-webhooks.py'))
        login = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(login)
        action = (inspect_accounts if sys.argv[1:] == ['--inspect'] else
                  verify_stored_key if sys.argv[1:] == ['--verify'] else switch)
        print(json.dumps(action(key, login.login()), indent=2))
    finally:
        key = None


if __name__ == '__main__':
    try:
        main()
    except diag.SafeError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except (EOFError, KeyboardInterrupt):
        print('Stopped. If interrupted during the secret update, verify configuration before checkout.', file=sys.stderr)
        sys.exit(1)
    except Exception:
        print('Setup failed; raw details withheld. Configuration may require verification; do not place an order.', file=sys.stderr)
        sys.exit(1)
