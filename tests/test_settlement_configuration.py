"""New diagnostic safety checks only. All provider responses are mocked."""
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch
import io

spec = importlib.util.spec_from_file_location('audit', Path(__file__).resolve().parents[1] / 'scripts/read-settlement-configuration.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
ZINC = 'zn_live_private_fixture'
STRIPE = 'sk_live_private_fixture'
METADATA = [{'name': name, 'value': hashlib.sha256(key.encode()).hexdigest()}
            for name, key in [('ZINC_API_KEY', ZINC), ('STRIPE_SECRET_KEY', STRIPE)]]


class Tests(unittest.TestCase):
    def test_get_only_url_boundary_and_no_redirect(self):
        for url in ['https://evil.invalid/v1/account', 'http://api.stripe.com/v1/account',
                    'https://api.stripe.com/v1/payment_intents/pi_fixture/capture',
                    'https://api.zinc.com/orders/'+audit.FAILED_ORDER+'/cancel',
                    'https://api.zinc.com/orders', 'https://api.stripe.com/v1/account?secret=bad']:
            self.assertFalse(audit.allowed_url(url))
        class Response(io.BytesIO):
            def __enter__(self): return self
            def __exit__(self,*args): self.close()
        with patch.object(audit.OPENER, 'open', return_value=Response(b'{}')) as network:
            audit.read_json('https://api.stripe.com/v1/account', STRIPE)
        request = network.call_args.args[0]
        self.assertEqual(request.get_method(), 'GET')
        self.assertIsNone(request.data)
        self.assertIsNone(audit.NoRedirect().redirect_request(None,None,302,'',{},'https://evil.invalid'))

    def test_wrong_deployed_key_stops_before_provider_access(self):
        reads=[]
        def read(url,key): reads.append(url); return METADATA
        with self.assertRaisesRegex(audit.SafeError, 'does_not_match'):
            audit.audit(ZINC+'wrong', STRIPE, 'management_fixture', read)
        self.assertEqual(len(reads),1)

    def test_configuration_and_existing_capture_are_sanitized(self):
        reads=[]
        pi='pi_fixture'
        order={'status':'order_placed', 'shipping_address':{'address_line1':'PRIVATE ADDRESS'},
               'connect':{'state':'captured','simulated':False,'connected_account_id':audit.ACCOUNT,
                          'payment_intent_id':pi,'order_cost':1172,'zinc_fee':100,'customer_margin':114,
                          'final_charge':1386,'stripe_fee':70,'transfer_amount':44},
               'job_result':{'price_components':{'subtotal':399,'shipping':699,'tax':74,'total':1172}}}
        def read(url,key):
            self.assertTrue(audit.allowed_url(url)); reads.append(url)
            if url.endswith('/secrets'): return METADATA
            if url.endswith('/wallet/me'): return {'user_id':1035,'order_fee_cents':100}
            if url.endswith('/v1/account'): return {'id':audit.ACCOUNT,'type':'standard','charges_enabled':True,
                'controller':{'type':'account','fees':{'payer':'account'},'stripe_dashboard':{'type':'full'}}}
            if url.endswith('limit=20'): return {'orders':[]}
            if '/v1/payment_intents/' in url: return {'livemode':True,'status':'succeeded','amount':1386,
                'amount_received':1386,'application':'ca_fixture','application_fee_amount':1272,
                'client_secret':'PRIVATE SECRET','latest_charge':{'balance_transaction':{
                    'fee':1342,'net':44,'fee_details':[{'type':'stripe_fee','amount':70,'description':'PRIVATE'},
                    {'type':'application_fee','amount':1272}]}}}
            return order
        result=audit.audit(ZINC,STRIPE,'management_fixture',read)
        self.assertEqual(result['stripeAccount']['feePayer'],'account')
        self.assertEqual(result['orders'][0]['stripePayment']['actualNet'],44)
        self.assertFalse(result['integratedSettlementVerified'])
        self.assertEqual(result['financialOperations'],0)
        for secret in [ZINC,STRIPE,'PRIVATE ADDRESS','PRIVATE SECRET','PRIVATE']:
            self.assertNotIn(secret,json.dumps(result))

    def test_partial_access_retains_account_evidence_without_inventing_settlement(self):
        def read(url,key):
            if url.endswith('/secrets'): return METADATA
            if url.endswith('/wallet/me'): return {'user_id':1035}
            if url.endswith('/v1/account'): return {'id':audit.ACCOUNT}
            raise audit.SafeError('read_http_403')
        result=audit.audit(ZINC,STRIPE,'management_fixture',read)
        self.assertIsNone(result['stripeAccount']['feePayer'])
        self.assertEqual(result['orders'],[])
        self.assertEqual(result['originalOrderReadFailure'],'read_http_403')
        self.assertFalse(result['integratedSettlementVerified'])


if __name__ == '__main__': unittest.main()
