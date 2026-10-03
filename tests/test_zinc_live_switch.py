import hashlib
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('switch', Path(__file__).resolve().parents[1] / 'scripts/switch-zinc-live-key.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
KEY = 'zn_live_fixture_PRIVATE'


class LiveSwitchTests(unittest.TestCase):
    def test_post_switch_verification_is_only_reads_and_never_prints_digest(self):
        calls = []
        def read(url, headers, method='GET', data=None):
            calls.append((url, method, data))
            if url.endswith('/wallet/me'): return {'user_id': 1035}
            return [{'name': 'ZINC_API_KEY', 'value': hashlib.sha256(KEY.encode()).hexdigest(), 'updated_at': '2026-10-03T04:25:47.246Z'}]
        result = module.verify_stored_key(KEY, 'fixture_token', read)
        self.assertTrue(result['stored_live_key_verified'])
        self.assertNotIn(KEY, str(result))
        self.assertNotIn(hashlib.sha256(KEY.encode()).hexdigest(), str(result))
        self.assertEqual(len(calls), 2)
        self.assertTrue(all(c[1] == 'GET' and c[2] is None for c in calls))

    def test_inspection_resolves_identity_without_treating_backend_account_as_zinc_link(self):
        calls = []
        def read(url, headers, method='GET', data=None):
            calls.append((url, method, data))
            if url.endswith('/wallet/me'):
                return {'user_id': 42, 'balance': 999, 'private_customer': 'withheld'}
            return {'accountId': module.STRIPE_ACCOUNT, 'chargesEnabled': True,
                    'capabilities': {'card_payments': 'active'}}
        result = module.inspect_accounts(KEY, 'fixture_token', read)
        self.assertEqual(result['zinc_user_id'], 42)
        self.assertEqual(result['fetchit_stripe_account_id'], module.STRIPE_ACCOUNT)
        self.assertFalse(result['zinc_connect_account_verified'])
        self.assertIsNone(result['zinc_linked_stripe_account_id'])
        self.assertFalse(result['production_secret_updated'])
        self.assertEqual(len(calls), 2)
        self.assertTrue(all(c[1] == 'GET' and c[2] is None for c in calls))
        self.assertNotIn('private_customer', str(result))
        self.assertNotIn(KEY, str(result))

    def test_switch_updates_only_zinc_secret_and_verifies_digest(self):
        calls = []
        functions = [{'slug': 'place-order', 'version': 11, 'status': 'ACTIVE', 'verify_jwt': True}]
        def read(url, headers, method='GET', data=None):
            calls.append((url, method, data))
            if url.endswith('/wallet/me'): return {'user_id': 1035}
            if url.endswith('/functions'): return functions
            if method == 'POST': return None
            return [{'name': 'ZINC_API_KEY', 'value': hashlib.sha256(KEY.encode()).hexdigest()}]
        result = module.switch(KEY, 'fixture_token', read)
        self.assertTrue(result['switch_succeeded'])
        self.assertTrue(result['stored_digest_verified'])
        self.assertNotIn(KEY, str(result))
        self.assertNotIn(hashlib.sha256(KEY.encode()).hexdigest(), str(result))
        self.assertEqual([c for c in calls if c[1] != 'GET'], [(module.BASE + '/secrets', 'POST', [{'name': 'ZINC_API_KEY', 'value': KEY}])])
        self.assertTrue(all('/orders' not in c[0] and '/payment' not in c[0] for c in calls))

    def test_switch_wrong_user_never_writes(self):
        calls = []
        def read(url, headers, method='GET', data=None):
            calls.append(method)
            return {'user_id': 1036}
        with self.assertRaises(module.diag.SafeError): module.switch(KEY, 'fixture_token', read)
        self.assertEqual(calls, ['GET'])

    def test_switch_without_active_production_guard_never_writes(self):
        calls = []
        def read(url, headers, method='GET', data=None):
            calls.append(method)
            if url.endswith('/wallet/me'): return {'user_id': 1035}
            return [{'slug': 'place-order', 'version': 10, 'status': 'ACTIVE', 'verify_jwt': True}]
        with self.assertRaises(module.diag.SafeError): module.switch(KEY, 'fixture_token', read)
        self.assertEqual(calls, ['GET', 'GET'])

    def test_switch_digest_failure_never_claims_success_or_retries(self):
        calls = []
        def read(url, headers, method='GET', data=None):
            calls.append(method)
            if url.endswith('/wallet/me'): return {'user_id': 1035}
            if url.endswith('/functions'): return [{'slug': 'place-order', 'version': 11, 'status': 'ACTIVE', 'verify_jwt': True}]
            if method == 'POST': return None
            return [{'name': 'ZINC_API_KEY', 'value': '0' * 64}]
        with self.assertRaises(module.diag.SafeError): module.switch(KEY, 'fixture_token', read)
        self.assertEqual(calls.count('POST'), 1)

    def test_nonlive_or_malformed_identity_blocks_without_writes(self):
        for key, user in [('zn_test_fixture', 42), ('zn_live_', 42), (KEY, '42')]:
            calls = []
            def read(url, headers, method='GET', data=None):
                calls.append(method)
                return {'user_id': user}
            with self.subTest(key_mode=key[:8], user_type=type(user).__name__):
                with self.assertRaises(module.diag.SafeError):
                    module.inspect_accounts(key, 'fixture_token', read)
                self.assertTrue(all(method == 'GET' for method in calls))


if __name__ == '__main__':
    unittest.main()
