import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import integrations from '../api/admin/integrations.js';
import subscriptions from '../api/admin/subscriptions.js';
import billing from '../api/admin/billing.js';
import plans from '../api/admin/plans.js';
const accountId=randomUUID(),storeId=randomUUID(),otherStore=randomUUID(),planId=randomUUID(),subId=randomUUID();
function setup(t,{role='platform_admin',linked=false,beta=false,failure=false}={}) {
  for(const [key,value] of Object.entries({SUPABASE_URL:'https://db.example.invalid',SUPABASE_SECRET_KEY:'server-test-only',ROOT_ADMIN_EMAILS:''})){
    const previous=process.env[key];process.env[key]=value;t.after(()=>previous===undefined?delete process.env[key]:process.env[key]=previous);
  }
  const calls=[];t.mock.method(globalThis,'fetch',async(url,options={})=>{
    const parsed=new URL(url), table=parsed.pathname.split('/').at(-1),call={table,path:parsed.pathname,query:parsed.search,method:options.method||'GET',body:options.body?JSON.parse(options.body):null};calls.push(call);
    let body=[],status=200;
    if(parsed.pathname==='/auth/v1/user')body={id:accountId,email:'ops@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'};
    else if(table==='system_admins')body=[{email:'ops@example.invalid',role,status:'active',auth_user_id:accountId,mfa_required:false}];
    else if(table==='stores')body=parsed.searchParams.has('id')?[{id:storeId,owner_id:accountId,name:'Loja B'}]:[{id:storeId,owner_id:accountId,name:'Loja B'},{id:otherStore,owner_id:accountId,name:'Loja A'}];
    else if(table==='plans')body=[{id:planId,name:'Completo',price:199}];
    else if(table==='subscriptions')body=[{id:subId,user_id:storeId,plan_id:planId,status:'active',current_period_end:'2027-01-01T00:00:00Z',mercado_pago_subscription_id:linked?'provider-test':null}];
    else if(table==='beta_participants')body=beta?[{id:randomUUID(),store_id:storeId,status:'active'}]:[];
    else if(table==='devices'&&failure){status=503;body={message:'database unavailable'};}
    return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  });return calls;
}
async function send(handler,body={},method='POST',route='subscriptions'){
  const res={headers:{},status(code){this.code=code;return this;},setHeader(k,v){this.headers[k]=v;return this;},json(value){this.body=value;return this;},end(){return this;}};
  await handler({method,body,url:'/api/admin/'+route,headers:{authorization:'Bearer verified-fixture-token'}},res);return res;
}
const change=()=>({accountId,storeId,planId,status:'active',currentPeriodEnd:'2027-01-01T00:00:00Z',reason:'Revisão contratual de teste'});
test('integration read fails partially instead of incorrectly clearing configured services',async t=>{
  const calls=setup(t,{failure:true});t.mock.method(console,'warn',()=>{});
  const result=await send(integrations,{},'GET','integrations');assert.equal(result.code,207);assert.equal(result.body.data[0].cielo.state,'unknown');assert.equal(result.body.data[0].access.state,'ready');
  const credentialCall=calls.find(c=>c.table==='store_integration_credentials');assert.ok(credentialCall);assert.equal(new URLSearchParams(credentialCall.query).get('select'),'store_id,mp_token_expires_at');assert.equal(calls.filter(c=>c.method!=='GET').length,0);
});
test('explicit operation wins over account and updates only its subscription',async t=>{
  const calls=setup(t);const result=await send(subscriptions,change());assert.equal(result.code,200);
  const mutation=calls.find(c=>c.table==='subscriptions'&&c.method==='PATCH');assert.ok(mutation);assert.ok(mutation.query.includes(subId));assert.equal(result.body.data.storeId,storeId);
});
test('multi-store account requires choosing an operation',async t=>{
  const calls=setup(t);const body=change();delete body.storeId;const result=await send(subscriptions,body);assert.equal(result.code,400);assert.ok(!calls.some(c=>c.method==='PATCH'));
});
test('provider-managed contract and paid beta edits cannot diverge from provider or gratuity',async t=>{
  const calls=setup(t,{linked:true});assert.equal((await send(subscriptions,change())).code,409);assert.ok(!calls.some(c=>c.method==='PATCH'));
});
test('active beta cannot be changed to a paid plan',async t=>{
  const calls=setup(t,{beta:true});assert.equal((await send(subscriptions,change())).code,409);assert.ok(!calls.some(c=>c.method==='PATCH'));
});
test('read-only administrator cannot change access or refresh a provider contract',async t=>{
  const calls=setup(t,{role:'auditor'});assert.equal((await send(subscriptions,change())).code,403);assert.equal((await send(billing,{action:'sync_subscription',storeId,reason:'Teste de autorização'},'POST','billing')).code,403);assert.ok(calls.every(c=>c.method==='GET'));
});
test('billing bridge rejects charge and cancellation commands before forwarding',async t=>{
  const calls=setup(t);assert.equal((await send(billing,{action:'cancel_subscription',storeId,reason:'Teste de autorização'},'POST','billing')).code,400);assert.ok(calls.every(c=>c.method==='GET'));
});
test('editing the shared beta plan cannot turn active participants into paying customers',async t=>{
  const calls=setup(t,{beta:true});assert.equal((await send(plans,{id:planId,plan:{price:199}},'PUT','plans')).code,409);assert.ok(!calls.some(c=>c.method==='PATCH'));
});
