import test from 'node:test';
import assert from 'node:assert/strict';
import { integrationReadiness } from '../api/_lib/integration-readiness.js';
const now = Date.parse('2026-10-02T12:00:00Z');
const store = { id:'store-a', name:'Cozinha A', owner_id:'owner-a' };
function sources() {
  return Object.fromEntries(Object.entries({
    subscriptions:[{id:'sub-a',user_id:'store-a',plan_id:'free',status:'trialing',current_period_end:'2027-01-01T00:00:00Z'}],
    plans:[{id:'free',name:'Beta',price:0}], permissions:[{plan_id:'free',permission_key:'kds'}],
    beta:[{id:'beta-a',store_id:'store-a',subscription_id:'sub-a',status:'active',beta_ends_at:'2027-01-01T00:00:00Z'}],
    ifood:[{store_id:'store-a',merchant_id:'merchant-a',status:'ACTIVE'}],
    devices:[{id:'device-a',restaurant_id:'store-a',provider:'CIELO',trust_status:'TRUSTED'}],
    cieloAccounts:[{id:'merchant-a',restaurant_id:'store-a',status:'ACTIVE'}],
    cieloBindings:[{restaurant_id:'store-a',device_id:'device-a',provider_account_id:'merchant-a'}],
    mpAccounts:[], memberships:[],
  }).map(([name,data])=>[name,{available:true,data}]));
}
test('free beta requires a valid linked subscription; configuration never proves a transaction',()=>{
  const result=integrationReadiness(store,sources(),now);
  assert.equal(result.beta.state,'ready'); assert.equal(result.ifood.state,'configured'); assert.equal(result.cielo.state,'configured');
  assert.equal(result.mercadoPago.state,'neutral');
});
test('failed reads cannot announce free beta or enabled modules',()=>{
  const input=sources(); input.subscriptions.available=false;
  const result=integrationReadiness(store,input,now);
  assert.equal(result.beta.state,'unknown'); assert.equal(result.access.state,'unknown'); assert.equal(result.modulesVerified,false);
});
test('paid beta, expired cycle and wrong subscription require review',()=>{
  for (const mutate of [s=>s.plans.data[0].price=99,s=>s.beta.data[0].beta_ends_at='2026-09-01T00:00:00Z',s=>s.beta.data[0].subscription_id='another-sub']) {
    const input=sources();mutate(input);assert.equal(integrationReadiness(store,input,now).beta.state,'attention');
  }
});
test('retired terminals and bindings from other operations do not validate Cielo',()=>{
  const input=sources(); input.devices.data[0].trust_status='RETIRED';
  assert.equal(integrationReadiness(store,input,now).cielo.state,'neutral');
  const other=sources();other.cieloBindings.data[0].restaurant_id='store-b';
  assert.equal(integrationReadiness(store,other,now).cielo.state,'attention');
});
test('expired restaurant OAuth connection needs renewal without exposing credentials',()=>{
  const input=sources();input.mpAccounts.data.push({store_id:'store-a',mp_token_expires_at:'2026-09-01T00:00:00Z',mp_access_token:'do-not-expose'});
  const result=integrationReadiness(store,input,now);assert.equal(result.mercadoPago.state,'attention');assert.ok(!JSON.stringify(result).includes('do-not-expose'));
});
