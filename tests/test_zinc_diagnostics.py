"""Offline diagnostic safety tests. No real credentials or network calls."""
import contextlib
import getpass
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
import urllib.error
import warnings
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('diagnostic', Path(__file__).resolve().parents[1] / 'scripts/diagnose-zinc-orders.py')
diag = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diag)
KEY = 'zn_live_PRIVATE_fixture_credential'


class Response(io.BytesIO):
    status = 200


def response(value):
    return Response(json.dumps(value).encode())


class ZincDiagnosticsTests(unittest.TestCase):
    def test_production_digest_comparison_is_read_only_and_sanitized(self):
        digest = hashlib.sha256(KEY.encode()).hexdigest()
        for stored, expected in ((digest, True), ('0' * 64, False)):
            with patch.dict(diag.os.environ, {'SUPABASE_ACCESS_TOKEN': 'fixture_token'}), patch.object(diag.OPENER, 'open', return_value=response([
                {'name': 'ZINC_API_KEY', 'value': stored, 'updated_at': '2026-08-08T17:19:49.022Z'}
            ])) as network:
                result = diag.verify_production_key(KEY)
            request = network.call_args.args[0]
            self.assertEqual(request.get_method(), 'GET')
            self.assertIsNone(request.data)
            self.assertEqual(request.full_url, 'https://api.supabase.com/v1/projects/' + diag.PROJECT_REF + '/secrets')
            self.assertEqual(result['matches_current_fetchit_zinc_key'], expected)
            self.assertEqual(result['supplied_key_mode'], 'live')
            self.assertNotIn(KEY, json.dumps(result))
            self.assertNotIn(stored, json.dumps(result))

    def test_mismatched_key_stops_before_zinc_lookups(self):
        output = io.StringIO()
        with patch.object(diag, 'hidden_key', return_value=KEY), patch.object(diag, 'verify_production_key', return_value={'matches_current_fetchit_zinc_key': False}), patch.object(diag.OPENER, 'open') as network, contextlib.redirect_stdout(output):
            self.assertEqual(diag.main(['--verify-production-key']), 1)
        network.assert_not_called()
        self.assertNotIn(KEY, output.getvalue())

    def run_main(self, opened):
        output = io.StringIO()
        with patch.object(diag, 'hidden_key', return_value=KEY), patch.object(diag.OPENER, 'open', side_effect=opened) as network, contextlib.redirect_stdout(output):
            status = diag.main()
        self.assertNotIn(KEY, output.getvalue())
        return status, output.getvalue(), network

    def test_four_gets_to_fixed_host_with_bearer_and_no_body(self):
        def opened(request, **kwargs):
            self.assertEqual(request.get_method(), 'GET')
            self.assertIsNone(request.data)
            self.assertEqual(request.get_header('Authorization'), 'Bearer ' + KEY)
            self.assertEqual(kwargs['timeout'], 30)
            self.assertTrue(request.full_url.startswith('https://api.zinc.com/orders/'))
            order_id = request.full_url.split('/')[4]
            return response({'order_id': order_id, 'current_status': 'failed', 'milestones': []} if request.full_url.endswith('/timeline') else {'id': order_id, 'status': 'failed'})
        status, output, network = self.run_main(opened)
        self.assertEqual(status, 0)
        self.assertEqual(network.call_count, 4)
        urls = [call.args[0].full_url for call in network.call_args_list]
        self.assertEqual(urls, [diag.BASE_URL + '/orders/' + order_id + suffix for order_id in diag.ORDER_IDS for suffix in ('', '/timeline')])
        self.assertIn(diag.ORDER_IDS[0], output)
        self.assertIn(diag.ORDER_IDS[1], output)

    def test_order_allowlist_preserves_diagnosis_and_excludes_customer_secrets_and_free_text(self):
        raw = {
            'status': 'failed', 'created_at': '2026-10-02T22:57:00-04:00',
            'updated_at': '2026-10-03T02:58:00Z',
            'shipping_address': {'first_name': 'PRIVATE_CUSTOMER'},
            'customer_notifications': {'email': 'private@example.com'},
            'payment_method': 'pm_PRIVATE', 'client_secret': 'pi_fixture_secret_PRIVATE',
            'job_result': {'error': 'PRIVATE_FULL_MESSAGE ' + KEY, 'error_type': 'payment_failed',
                           'error_details': {'code': 'card_declined', 'message': 'PRIVATE_MESSAGE'}},
            'connect': {'state': 'released', 'simulated': False,
                        'payment_intent_id': 'pi_fixture123', 'connected_account_id': 'acct_fixture123',
                        'customer': 'cus_PRIVATE', 'secret': KEY, 'final_charge': 537},
            'items': [{'status': 'failed', 'error_type': 'product_not_found', 'url': 'https://private.example', 'name': 'PRIVATE_ITEM'}],
        }
        summary = diag.sanitize_order(raw, KEY)
        self.assertEqual(summary['created_at'], '2026-10-03T02:57:00Z')
        self.assertEqual(summary['job_result']['error_code'], 'card_declined')
        self.assertEqual(summary['connect']['payment_intent_id'], 'pi_fixture123')
        self.assertEqual(summary['connect']['connected_account_id'], 'acct_fixture123')
        self.assertIs(summary['connect']['simulated'], False)
        text = json.dumps(summary)
        for private in [KEY, 'PRIVATE', 'private@example.com', '537', 'shipping_address', 'customer']:
            self.assertNotIn(private, text)

    def test_timeline_excludes_labels_source_and_arbitrary_detail(self):
        summary = diag.sanitize_timeline({'current_status': 'failed', 'milestones': [{
            'type': 'order_failed', 'label': 'PRIVATE_CUSTOMER', 'source': KEY,
            'occurred_at': '2026-10-03T03:00:00Z',
            'detail': {'status': 'failed', 'error_type': 'payment_failed', 'error_details': {'code': 'card_declined', 'message': KEY}, 'address': 'PRIVATE'},
        }]}, KEY)
        self.assertEqual(summary['milestones'][0]['error_code'], 'card_declined')
        self.assertEqual(summary['milestones'][0]['status'], 'failed')
        self.assertNotIn('PRIVATE', json.dumps(summary))
        self.assertNotIn(KEY, json.dumps(summary))
        self.assertNotIn('label', json.dumps(summary))

    def test_secret_echo_and_invalid_types_are_withheld_even_in_allowed_fields(self):
        for raw in [KEY, 'sk_live_private', 'zn_test_private', 'private@example.com', 'Failed\nPRIVATE', {'secret': KEY}, ['PRIVATE']]:
            self.assertIsNone(diag.safe_code(raw, KEY))
        self.assertIsNone(diag.safe_id('pi_fixture_secret_PRIVATE', 'pi_', KEY))
        self.assertIsNone(diag.safe_id(KEY, 'acct_', KEY))
        self.assertIsNone(diag.safe_timestamp('2026-99-99T00:00:00Z', KEY))
        self.assertIsNone(diag.safe_timestamp('PRIVATE', KEY))
        self.assertIsNone(diag.connect_summary({'simulated': 'false'}, KEY)['simulated'])

    def test_auth_failure_is_explicit_stops_and_never_prints_body(self):
        for status, code in [(401, 'authentication_failed'), (403, 'access_denied')]:
            def opened(request, **kwargs):
                raise urllib.error.HTTPError(request.full_url, status, KEY, {}, io.BytesIO(KEY.encode()))
            result, output, network = self.run_main(opened)
            self.assertEqual(result, 1)
            self.assertIn(code, output)
            self.assertEqual(network.call_count, 1)

    def test_missing_orders_continue_independently_without_retries_or_claiming_global_absence(self):
        def opened(request, **kwargs):
            raise urllib.error.HTTPError(request.full_url, 404, KEY, {}, io.BytesIO(KEY.encode()))
        status, output, network = self.run_main(opened)
        self.assertEqual(status, 1)
        self.assertEqual(network.call_count, 4)
        self.assertEqual(output.count('not_found_in_this_account_or_environment'), 4)

    def test_http_error_machine_code_is_preserved_but_echoed_secrets_are_not(self):
        body = {'error': {'code': 'invalid_api_key', 'message': KEY, 'customer': 'PRIVATE'}}
        def opened(request, **kwargs):
            raise urllib.error.HTTPError(request.full_url, 401, KEY, {}, io.BytesIO(json.dumps(body).encode()))
        status, output, network = self.run_main(opened)
        self.assertEqual(status, 1)
        self.assertIn('invalid_api_key', output)
        self.assertNotIn('PRIVATE', output)
        self.assertEqual(network.call_count, 1)

    def test_timeout_and_rate_limit_are_not_retried(self):
        for error in [TimeoutError(KEY), urllib.error.URLError(KEY), urllib.error.HTTPError('https://api.zinc.com/orders', 429, KEY, {}, io.BytesIO(KEY.encode()))]:
            status, output, network = self.run_main(lambda *args, **kwargs: (_ for _ in ()).throw(error))
            self.assertEqual(status, 1)
            self.assertEqual(network.call_count, 4)
            self.assertIn('no_retry', output)

    def test_redirect_is_refused_without_forwarding_credentials(self):
        request = __import__('urllib.request', fromlist=['Request']).Request(diag.BASE_URL, headers={'Authorization': 'Bearer ' + KEY})
        self.assertIsNone(diag.NoRedirect().redirect_request(request, None, 302, 'redirect', {}, 'https://untrusted.example'))
        def opened(request, **kwargs):
            raise urllib.error.HTTPError(request.full_url, 302, KEY, {'Location': 'https://untrusted.example/' + KEY}, io.BytesIO(KEY.encode()))
        status, output, network = self.run_main(opened)
        self.assertEqual(status, 1)
        self.assertEqual(network.call_count, 4)
        self.assertIn('redirect_refused', output)
        self.assertNotIn('untrusted', output)

    def test_malformed_oversized_or_wrong_order_responses_never_print_raw_body(self):
        fixtures = [Response(KEY.encode()), Response(b'[]'), Response(b'x' * (diag.MAX_RESPONSE_BYTES + 1)), response({'id': 'other_PRIVATE', 'status': 'completed', 'secret': KEY})]
        for fixture in fixtures:
            with patch.object(diag.OPENER, 'open', return_value=fixture):
                summary = diag.get_resource(diag.ORDER_IDS[0], 'order', KEY)
            self.assertIn(summary['error_code'], ['invalid_json_response', 'invalid_response_shape', 'response_too_large', 'response_order_id_mismatch'])
            self.assertNotIn(KEY, json.dumps(summary))
            self.assertNotIn('completed', json.dumps(summary))

    def test_unapproved_resource_is_blocked_before_network(self):
        with patch.object(diag.OPENER, 'open') as network:
            for order_id, resource in [('unknown', 'order'), (diag.ORDER_IDS[0], 'cancel')]:
                with self.assertRaises(diag.SafeError):
                    diag.get_resource(order_id, resource, KEY)
            network.assert_not_called()

    def test_hidden_input_is_trimmed_with_no_credential_output(self):
        output = io.StringIO()
        with patch.object(diag.sys.stdin, 'isatty', return_value=True), patch.object(diag.getpass, 'getpass', return_value='  ' + KEY + '  '), contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            self.assertEqual(diag.hidden_key(), KEY)
        self.assertEqual(output.getvalue(), '')

    def test_hidden_input_fails_closed_without_tty_or_echo_control(self):
        with patch.object(diag.sys.stdin, 'isatty', return_value=False), patch.object(diag.getpass, 'getpass') as prompt:
            with self.assertRaises(diag.SafeError):
                diag.hidden_key()
            prompt.assert_not_called()
        def fallback(_):
            warnings.warn('echo unavailable', getpass.GetPassWarning)
            self.fail('Must stop before an echoed fallback reads input')
        with patch.object(diag.sys.stdin, 'isatty', return_value=True), patch.object(diag.getpass, 'getpass', side_effect=fallback):
            with self.assertRaises(diag.SafeError):
                diag.hidden_key()

    def test_invalid_key_format_never_enters_network(self):
        for value in ['', 'Bearer ' + KEY, 'ZINC_API_KEY=' + KEY, '"' + KEY + '"', 'key\nPRIVATE', 'key\u200bPRIVATE']:
            with patch.object(diag.sys.stdin, 'isatty', return_value=True), patch.object(diag.getpass, 'getpass', return_value=value), patch.object(diag.OPENER, 'open') as network:
                with self.assertRaises(diag.SafeError) as caught:
                    diag.main()
                self.assertNotIn(KEY, str(caught.exception))
                network.assert_not_called()


if __name__ == '__main__':
    unittest.main()
