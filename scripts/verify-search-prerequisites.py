#!/usr/bin/env python3
"""Read-only search release gate. Uses the existing Supabase CLI login; prints no credentials.
Run before deploying search-products. Missing quota migrations must be installed,
not bypassed: Zinc intentionally fails closed when quota accounting is unavailable.
"""
import importlib.util
import json
from pathlib import Path
import sys
import urllib.request

QUERY = """
select to_regclass('public.usage_quotas') is not null as quota_table,
       to_regclass('public.plan_entitlements') is not null as entitlement_table,
       exists(select 1 from information_schema.columns where table_schema='public'
              and table_name='usage_quotas' and column_name='cents_used') as dollar_metering,
       to_regprocedure('public.quota_consume(uuid,text,numeric,numeric,boolean)') is not null as consume_rpc,
       to_regprocedure('public.quota_status(uuid,text,numeric)') is not null as status_rpc
"""


def main():
    spec = importlib.util.spec_from_file_location('access', Path(__file__).with_name('read-settlement-configuration.py'))
    access = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(access)
    token = access.management_token()
    req = urllib.request.Request(f'https://api.supabase.com/v1/projects/{access.PROJECT}/database/query',
                                 headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
                                 data=json.dumps({'query': QUERY}).encode(), method='POST')
    with urllib.request.urlopen(req, timeout=30) as response:
        rows = json.load(response)
    checks = rows[0] if isinstance(rows, list) and len(rows) == 1 else {}
    ready = len(checks) == 5 and all(value is True for value in checks.values())
    print(json.dumps({'searchPrerequisitesReady': ready, 'checks': checks}))
    if not ready:
        print('Apply usage_quotas and usage_quotas_cents migrations before deploying search. Do not bypass the budget check.')
    return 0 if ready else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        print('Search prerequisite verification unavailable; no changes made and details withheld.', file=sys.stderr)
        sys.exit(1)
