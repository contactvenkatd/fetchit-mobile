#!/usr/bin/env python3
"""Hidden live-key input; exactly one read-only GET /wallet/me, no retries."""
import datetime
import getpass
import json
import re
import sys
import tempfile
import urllib.request
import warnings

WALLET_URL = 'https://api.zinc.com/wallet/me'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def read_wallet(key):
    if not re.fullmatch(r'zn_live_[A-Za-z0-9_-]+', key):
        raise ValueError('invalid_key')
    request = urllib.request.Request(WALLET_URL, method='GET', headers={
        'Authorization': 'Bearer ' + key, 'Accept': 'application/json',
    })
    opener = urllib.request.build_opener(NoRedirect())
    with opener.open(request, timeout=20) as response:
        if response.status != 200:
            raise ValueError('wallet_unavailable')
        body = response.read(65537)
    if len(body) > 65536:
        raise ValueError('response_too_large')
    wallet = json.loads(body)
    if not isinstance(wallet, dict) or type(wallet.get('user_id')) is not int or wallet['user_id'] != 1035:
        raise ValueError('wrong_account')
    fee = wallet.get('order_fee_cents')
    if type(fee) is not int:
        raise ValueError('missing_or_invalid_fee')
    # Only validated account/fee fields leave memory; never the raw response.
    return {
        'observedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'source': WALLET_URL, 'method': 'GET', 'userId': 1035,
        'userVerified': True, 'orderFeeCents': fee,
        'connectFeeApplicabilityVerified': False,
        'productionCustomerMaximumVerified': False,
        'financialOperations': 0,
    }


def main():
    if sys.argv[1:] or not sys.stdin.isatty():
        print('Run without arguments in an interactive Terminal. No requests sent.')
        return 1
    key = None
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', getpass.GetPassWarning)
            key = getpass.getpass('Existing LIVE Zinc key (hidden; GET /wallet/me only): ').strip()
        result = read_wallet(key)
    except ValueError as error:
        # Only these locally generated failures may be described. JSON decoder
        # exceptions or provider bodies must never be printed.
        if str(error) == 'wrong_account':
            print('Wallet is not verified as user 1035. Fee withheld; no further requests.')
        elif str(error) == 'invalid_key':
            print('A complete unmasked zn_live_ key is required. No requests sent.')
        else:
            print('Wallet response could not be verified. Details withheld; no retry.')
        return 1
    except (EOFError, KeyboardInterrupt):
        print('Cancelled. No key saved and no automatic retry.')
        return 1
    except Exception:
        print('Wallet read or hidden input unavailable. Details withheld; no retry.')
        return 1
    finally:
        # Python strings cannot be reliably zeroed; process exit drops memory.
        key = None
    with tempfile.NamedTemporaryFile(mode='w', prefix='fetchit-zinc-wallet-pricing-result-',
                                     suffix='.json', delete=False) as saved:
        json.dump(result, saved, indent=2)
        saved.write('\n')
    print(json.dumps(result, indent=2))
    print('Sanitized result (contains no key): ' + saved.name)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        print('Result could not be saved. No key saved; no retry.')
        sys.exit(1)
