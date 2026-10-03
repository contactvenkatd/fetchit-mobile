#!/usr/bin/env python3
"""Read-only backend trace for one new checkout after a captured baseline.
No order calls, event replays, database writes, secrets or customer output.
"""
import datetime
import importlib.util
import json
from pathlib import Path
import sys
import urllib.parse
import urllib.request

PROJECT = 'fpphpncruohjlppqhfep'
BASELINE = Path('/private/tmp/fetchit-new-checkout-baseline.json')


def main():
    if sys.argv[1:]:
        raise ValueError('No arguments accepted')
    baseline = json.loads(BASELINE.read_text())
    start = datetime.datetime.fromisoformat(baseline['prepared_at_utc'])
    end = datetime.datetime.now(datetime.timezone.utc)
    spec = importlib.util.spec_from_file_location('login', Path(__file__).with_name('deduplicate-stripe-webhooks.py'))
    login = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(login)
    token = login.login()
    base = 'https://api.supabase.com/v1/projects/' + PROJECT
    headers = {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}
    query = "SELECT id,zinc_order_id,status,created_at,order_price,service_fee FROM public.orders ORDER BY created_at DESC LIMIT 20"
    request = urllib.request.Request(base + '/database/query', headers=headers,
                                   data=json.dumps({'query': query}).encode(), method='POST')
    with urllib.request.urlopen(request, timeout=30) as response:
        rows = json.load(response)
    previous = {r['id'] for r in baseline['existing_orders']}
    rows = [r for r in rows if r['id'] not in previous]
    # Bounds are parsed timestamps, not user-supplied SQL fragments.
    sql = "SELECT timestamp,id,log_attributes['request_id'] AS request_id,log_attributes['execution_id'] AS execution_id,log_attributes['version'] AS function_version,log_attributes['response.status_code'] AS http_status,log_attributes['execution_time_ms'] AS duration_ms FROM function_edge_logs WHERE event_message ILIKE '%place-order%' ORDER BY timestamp DESC LIMIT 20"
    stamp = lambda value: value.isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    params = urllib.parse.urlencode({'sql': sql, 'iso_timestamp_start': stamp(start), 'iso_timestamp_end': stamp(end)})
    request = urllib.request.Request(base + '/analytics/endpoints/logs?' + params, headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        logs = json.load(response)
    if isinstance(logs, dict):
        logs = logs.get('result', [])
    allowed = ('timestamp', 'id', 'request_id', 'execution_id', 'function_version', 'http_status', 'duration_ms')
    logs = [{k: row.get(k) for k in allowed} for row in logs] if isinstance(logs, list) else []
    print(json.dumps({'window_start': start.isoformat(), 'window_end': end.isoformat(),
                      'new_orders': rows, 'backend_invocations': logs,
                      'correlation': 'one_candidate' if len(rows) == 1 else 'none' if not rows else 'multiple_candidates_do_not_guess',
                      'zinc_acceptance': 'requires_order_read', 'stripe_payment': 'requires_linked_payment_read',
                      'retailer_order': 'requires_zinc_status_read', 'frontend_confirmation': 'requires_app_observation'}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Read-only trace failed; raw details withheld. No changes made.', file=sys.stderr)
        sys.exit(1)
