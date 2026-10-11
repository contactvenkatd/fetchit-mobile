#!/usr/bin/env python3
"""Hidden credential entry; GET-only account/payment evidence. Never submits orders."""
import base64
import datetime
import getpass
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import warnings

PROJECT = 'fpphpncruohjlppqhfep'
ACCOUNT = 'acct_1Th9uUQg8UTscDty'
FAILED_ORDER = 'd22c4050-dac6-49f5-a3f7-7e2b604cd9fe'
RESULT = Path(tempfile.gettempdir()) / 'fetchit-settlement-account-readonly.json'
MAX_BYTES = 2 * 1024 * 1024


class SafeError(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = urllib.request.build_opener(NoRedirect())


def allowed_url(url):
    u = urllib.parse.urlsplit(url)
    if u.scheme != 'https' or u.username or u.password or u.fragment:
        return False
    if u.netloc == 'api.supabase.com':
        return u.path == f'/v1/projects/{PROJECT}/secrets' and not u.query
    if u.netloc == 'api.zinc.com':
        return ((u.path == '/wallet/me' and not u.query)
                or (u.path == '/orders' and u.query == 'limit=20')
                or (re.fullmatch(r'/orders/[a-f0-9-]{36}(?:/timeline)?', u.path) and not u.query))
    if u.netloc == 'api.stripe.com':
        return ((u.path == '/v1/account' and not u.query)
                or (re.fullmatch(r'/v1/payment_intents/pi_[A-Za-z0-9]+', u.path)
                    and u.query == 'expand%5B%5D=latest_charge.balance_transaction'))
    return False


def read_json(url, key):
    if not allowed_url(url):
        raise SafeError('read_target_not_allowed')
    headers = {'Authorization': 'Bearer ' + key, 'Accept': 'application/json'}
    if urllib.parse.urlsplit(url).netloc == 'api.stripe.com':
        headers['Stripe-Version'] = '2025-02-24.acacia'
    req = urllib.request.Request(url, headers=headers, method='GET')
    try:
        with OPENER.open(req, timeout=30) as response:
            data = response.read(MAX_BYTES + 1)
        if len(data) > MAX_BYTES:
            raise SafeError('response_too_large')
        return json.loads(data)
    except urllib.error.HTTPError as error:
        # Never read or log provider error messages, URLs, headers or bodies.
        raise SafeError(f'read_http_{error.code}') from None
    except (urllib.error.URLError, TimeoutError, ValueError):
        raise SafeError('read_unavailable') from None


def hidden(prompt, prefix):
    with warnings.catch_warnings():
        warnings.simplefilter('error', getpass.GetPassWarning)
        key = getpass.getpass(prompt).strip()
    if not re.fullmatch(re.escape(prefix) + r'[A-Za-z0-9_-]+', key):
        raise SafeError('invalid_credential_format')
    return key


def management_token():
    token = os.environ.get('SUPABASE_ACCESS_TOKEN')
    if not token and sys.platform == 'darwin':
        p = subprocess.run(['security', 'find-generic-password', '-s', 'Supabase CLI',
                            '-a', 'supabase', '-w'], capture_output=True, text=True)
        if p.returncode == 0:
            token = p.stdout.strip()
            if token.startswith('go-keyring-base64:'):
                token = base64.b64decode(token.split(':', 1)[1]).decode()
    if not token:
        raise SafeError('existing_supabase_cli_login_missing')
    return token


def cents(v):
    return v if type(v) is int and 0 <= v <= 9007199254740991 else None


def obj(v):
    return v if isinstance(v, dict) else {}


def enum(v, values):
    return v if v in values else None


def account_summary(raw):
    c = obj(raw.get('controller'))
    return {'expectedAccountVerified': raw.get('id') == ACCOUNT,
            'accountType': enum(raw.get('type'), ['standard', 'express', 'custom', 'none']),
            'chargesEnabled': raw.get('charges_enabled') is True,
            'payoutsEnabled': raw.get('payouts_enabled') is True,
            'controllerType': enum(c.get('type'), ['account', 'application']),
            'feePayer': enum(obj(c.get('fees')).get('payer'),
                             ['account', 'application', 'application_custom', 'application_express']),
            'dashboardType': enum(obj(c.get('stripe_dashboard')).get('type'), ['full', 'express', 'none']),
            'lossesPayments': enum(obj(c.get('losses')).get('payments'), ['stripe', 'application']),
            'controllerReturned': isinstance(raw.get('controller'), dict)}


def connect_summary(raw):
    c = obj(raw.get('connect'))
    result = {'status': enum(raw.get('status'), ['pending', 'queued', 'processing', 'order_placed', 'failed', 'cancelled', 'shipped', 'delivered']),
              'connectPresent': bool(c),
              'state': enum(c.get('state'), ['secured', 'captured', 'released', 'refunded', 'failed']),
              'simulated': c.get('simulated') if type(c.get('simulated')) is bool else None,
              'expectedStripeAccountLinked': c.get('connected_account_id') == ACCOUNT if c.get('connected_account_id') else None}
    for field in ['secured_amount', 'order_cost', 'customer_margin', 'zinc_fee', 'stripe_fee', 'final_charge', 'transfer_amount']:
        result[field] = cents(c.get(field))
    parts = obj(obj(raw.get('job_result')).get('price_components'))
    result['retailerCosts'] = {k: cents(parts.get(k)) for k in ['subtotal', 'shipping', 'tax', 'total']}
    return result


def payment_summary(raw):
    charge = obj(raw.get('latest_charge'))
    balance = obj(charge.get('balance_transaction'))
    return {'livemode': raw.get('livemode') is True,
            'status': enum(raw.get('status'), ['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing', 'requires_capture', 'canceled', 'succeeded']),
            'amount': cents(raw.get('amount')), 'amountCapturable': cents(raw.get('amount_capturable')),
            'amountReceived': cents(raw.get('amount_received')),
            'applicationPresent': isinstance(raw.get('application'), str),
            'applicationFeeAmount': cents(raw.get('application_fee_amount')),
            'transferDataPresent': isinstance(raw.get('transfer_data'), dict),
            'transferAmount': cents(obj(raw.get('transfer_data')).get('amount')),
            'balanceTransactionAvailable': bool(balance),
            'actualFee': cents(balance.get('fee')),
            'actualNet': balance.get('net') if type(balance.get('net')) is int else None,
            'feeDetails': [{'type': enum(x.get('type'), ['stripe_fee', 'application_fee', 'payment_method_passthrough_fee', 'tax']),
                            'amount': cents(x.get('amount'))} for x in balance.get('fee_details', []) if isinstance(x, dict)]}


def audit(zinc, stripe, management, read=read_json):
    metadata = read(f'https://api.supabase.com/v1/projects/{PROJECT}/secrets', management)
    if not isinstance(metadata, list):
        raise SafeError('secret_identity_metadata_unavailable')
    for name, key in [('ZINC_API_KEY', zinc), ('STRIPE_SECRET_KEY', stripe)]:
        saved = next((x.get('value') for x in metadata if isinstance(x, dict) and x.get('name') == name), None)
        if not isinstance(saved, str) or not re.fullmatch(r'[a-fA-F0-9]{64}', saved):
            raise SafeError('configured_credential_identity_unavailable')
        if not hmac.compare_digest(saved.lower(), hashlib.sha256(key.encode()).hexdigest()):
            raise SafeError('credential_does_not_match_deployed_configuration')
    wallet = obj(read('https://api.zinc.com/wallet/me', zinc))
    if type(wallet.get('user_id')) is not int or wallet['user_id'] != 1035:
        raise SafeError('unexpected_zinc_account')
    account = account_summary(obj(read('https://api.stripe.com/v1/account', stripe)))
    if not account['expectedAccountVerified']:
        raise SafeError('unexpected_stripe_account')
    report = {'observedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'scope': 'existing production resources; read-only, not a payment test',
              'deployedCredentialsMatched': True, 'zincUserVerified': True,
              'walletOrderFeeCents': cents(wallet.get('order_fee_cents')),
              'walletFeeAppliesToConnect': None, 'stripeAccount': account,
              'financialOperations': 0, 'integratedSettlementVerified': False, 'orders': []}
    orders = []
    try:
        orders.append(obj(read(f'https://api.zinc.com/orders/{FAILED_ORDER}', zinc)))
    except SafeError as error:
        report['originalOrderReadFailure'] = str(error)
    try:
        recent = obj(read('https://api.zinc.com/orders?limit=20', zinc)).get('orders')
        if not isinstance(recent, list):
            raise SafeError('order_list_shape_unavailable')
    except SafeError as error:
        report['recentOrdersReadFailure'] = str(error)
        recent = []
    seen = {FAILED_ORDER}
    for item in recent:
        if not isinstance(item, dict) or item.get('id') in seen:
            continue
        order_id = item.get('id')
        if not isinstance(order_id, str) or not re.fullmatch(r'[a-f0-9-]{36}', order_id):
            continue
        seen.add(order_id)
        if obj(item.get('connect')):
            try:
                orders.append(obj(read('https://api.zinc.com/orders/' + order_id, zinc)))
            except SafeError as error:
                report.setdefault('orderDetailReadFailures', []).append(str(error))
        if len(orders) >= 6:
            break
    for order in orders:
        summary = connect_summary(order)
        c = obj(order.get('connect'))
        pi = c.get('payment_intent_id')
        if c.get('connected_account_id') == ACCOUNT and c.get('simulated') is not True and isinstance(pi, str) and re.fullmatch(r'pi_[A-Za-z0-9]+', pi):
            try:
                payment = obj(read('https://api.stripe.com/v1/payment_intents/' + pi + '?expand%5B%5D=latest_charge.balance_transaction', stripe))
                if payment.get('livemode') is not True:
                    raise SafeError('unexpected_payment_mode')
                summary['stripePayment'] = payment_summary(payment)
            except SafeError as error:
                summary['stripePaymentReadFailure'] = str(error)
        report['orders'].append(summary)
    return report


def main():
    if sys.argv[1:] or not sys.stdin.isatty():
        print('Use this script in Terminal without arguments. No requests sent.')
        return 1
    print('READ ONLY: existing account configuration and payment records. No financial operations.')
    print('Enter existing deployed keys only. Input is hidden; keys are not saved or printed.')
    zinc = stripe = management = None
    try:
        management = management_token()
        zinc = hidden('Existing FetchIt Zinc LIVE key (hidden): ', 'zn_live_')
        stripe = hidden('Existing FetchIt Stripe LIVE secret (hidden): ', 'sk_live_')
        report = audit(zinc, stripe, management)
        # Only allowlisted fields above reach disk or output; no keys/addresses/raw bodies.
        with tempfile.NamedTemporaryFile(mode='w', dir=RESULT.parent, prefix='fetchit-settlement-', delete=False) as out:
            json.dump(report, out, indent=2)
            out.write('\n')
            temporary = out.name
        os.replace(temporary, RESULT)
        print('Read-only diagnostics complete. Sanitized result: ' + str(RESULT))
        return 0
    except SafeError as error:
        print('Diagnostics stopped: ' + str(error) + '. No financial changes.')
        return 1
    except (EOFError, KeyboardInterrupt):
        print('\nPrivate input cancelled. No credentials saved.')
        return 1
    except Exception:
        print('Diagnostics unavailable; raw details withheld. No credentials saved.')
        return 1
    finally:
        zinc = stripe = management = None


if __name__ == '__main__':
    sys.exit(main())
