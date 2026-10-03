#!/usr/bin/env python3
"""Read exactly one NEW Zinc order and its timeline using a hidden live key.
The two earlier simulated orders are excluded. No writes or retries.
"""
import importlib.util
from pathlib import Path
import sys
import uuid

spec = importlib.util.spec_from_file_location('diagnostic', Path(__file__).with_name('diagnose-zinc-orders.py'))
diag = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diag)


def main():
    if len(sys.argv) != 2:
        raise diag.SafeError('Usage: trace-zinc-new-order.py NEW_ZINC_ORDER_UUID')
    try:
        order_id = str(uuid.UUID(sys.argv[1]))
    except ValueError:
        raise diag.SafeError('Invalid Zinc order UUID. No requests sent.') from None
    if order_id in diag.ORDER_IDS:
        raise diag.SafeError('This is an earlier simulated order. Supply the NEW order ID.')
    diag.ORDER_IDS = (order_id,)
    original = diag.hidden_key
    def live_key():
        key = original()
        if not key.startswith('zn_live_') or len(key) <= len('zn_live_'):
            raise diag.SafeError('A complete live key is required. No requests sent.')
        return key
    diag.hidden_key = live_key
    return diag.main(['--verify-production-key'])


if __name__ == '__main__':
    try:
        sys.exit(main())
    except diag.SafeError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except (EOFError, KeyboardInterrupt):
        print('Stopped. No changes made.', file=sys.stderr)
        sys.exit(1)
    except Exception:
        print('Read-only trace failed; raw details withheld. No changes made.', file=sys.stderr)
        sys.exit(1)
