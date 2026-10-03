#!/usr/bin/env python3
"""Run Stripe test checks with a hidden key, without storing or logging it."""
import getpass
from pathlib import Path
import re
import subprocess
import sys
import warnings


def main():
    if not sys.argv[1:] and sys.stdin.isatty():
        with warnings.catch_warnings():
            warnings.simplefilter('error', getpass.GetPassWarning)
            key = getpass.getpass('Stripe test secret (hidden, sk_test_ only): ').strip()
    else:
        print('Use an interactive terminal. No requests sent.')
        return 1
    if not re.fullmatch(r'sk_test_[A-Za-z0-9]+', key):
        print('An unmasked sk_test_ key is required. No requests sent.')
        return 1
    # The key is pipe input: never an argument, file, or environment variable.
    result = subprocess.run(['node', str(Path(__file__).with_name('stripe-stdin.cjs'))],
                            input=key, text=True)
    key = None
    return result.returncode


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (EOFError, KeyboardInterrupt):
        print('Hidden input cancelled. No key saved.')
        sys.exit(1)
    except Exception:
        print('Hidden input failed; details withheld. No key saved.')
        sys.exit(1)
