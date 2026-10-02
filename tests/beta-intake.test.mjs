import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import handler from '../api/public/beta-application.js';
import { updateBetaApplication } from '../api/_lib/beta-operations.js';

function backend(t, responder) {
  for (const [key,value] of Object.entries({ SUPABASE_URL:'https://example.invalid', SUPABASE_SECRET_KEY:'test-only-key' })) {
    const previous=process.env[key]; process.env[key]=value;
    t.after(() => previous === undefined ? delete process.env[key] : process.env[key]=previous);
  }
  const calls=[];
  t.mock.method(globalThis,'fetch',async (url,options={}) => {
    const call={ path:new URL(url).pathname, query:new URL(url).search, ...options, body:options.body ? JSON.parse(options.body) : null }; calls.push(call);
    const [status,body]=responder(call);
    return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  });
  return calls;
}
async function send(body,method='POST',origin='https://chefos.shop') {
  const res={ headers:{},status(code){this.code=code;return this;},setHeader(key,value){this.headers[key]=value;return this;},json(value){this.body=value;return this;},end(){return this;} };
  await handler({method,body,headers:{origin,'x-forwarded-for':'192.0.2.1'}},res);
  return res;
}
const valid=() => ({name:'Responsável de teste',restaurantName:'Casa de teste',email:'BETA@example.invalid',phone:'31999999999',city:'Belo Horizonte',equipment:'Cielo Smart',consentTerms:true,consentPrivacy:true,consentMarketing:false,termsVersion:'beta-terms-v1',privacyVersion:'privacy-v1',requestId:randomUUID(),campaign:{source:'instagram',medium:'social',name:'bh-piloto'}});

test('novo formulário faz uma gravação transacional com aceites separados e atribuição de campanha',async t => {
  const calls=backend(t,() => [200,{http_status:201,received:true,id:randomUUID()}]);
  const result=await send(valid()); assert.equal(result.code,201); assert.equal(calls.length,1);
  assert.equal(calls[0].path,'/rest/v1/rpc/submit_beta_application_atomic');
  const data=calls[0].body.p_payload;
  assert.equal(data.email,'beta@example.invalid'); assert.equal(data.city,'Belo Horizonte'); assert.equal(data.consentMarketing,false); assert.equal(data.consentPrivacy,true); assert.equal(data.campaign.name,'bh-piloto');
  assert.match(data.requestHash,/^[a-f0-9]{64}$/); assert.match(calls[0].body.p_fingerprint,/^[a-f0-9]{64}$/);
});
test('reenvio usa a mesma chave e hash para não criar outra candidatura',async t => {
  const calls=backend(t,() => [200,{http_status:200,received:true,id:'existing'}]);
  const body=valid(); await send(body); await send(body);
  assert.deepEqual(calls[0].body,calls[1].body);
});
test('formulário antigo continua compatível sem inventar aceite de privacidade',async t => {
  const calls=backend(t,() => [200,{http_status:201,received:true}]);
  const result=await send({name:'Teste',restaurantName:'Casa',email:'beta@example.invalid',consentTerms:true});
  assert.equal(result.code,201); assert.equal(calls[0].body.p_payload.consentPrivacy,null); assert.equal(calls[0].body.p_payload.privacyVersion,null);
});
test('aceite ou versão inválidos e JSON malformado não chegam ao banco',async t => {
  const calls=backend(t,() => {throw Error('Unexpected backend call');});
  assert.equal((await send({...valid(),consentPrivacy:false})).code,400);
  assert.equal((await send({...valid(),termsVersion:'outdated'})).code,400);
  assert.equal((await send('{invalid')).code,400); assert.equal(calls.length,0);
});
test('honeypot e preflight não criam candidaturas; CORS aceita o domínio da landing',async t => {
  const calls=backend(t,() => {throw Error('Unexpected backend call');});
  assert.equal((await send({...valid(),website:'spam'})).code,202);
  const result=await send({},'OPTIONS'); assert.equal(result.code,204); assert.equal(result.headers['Access-Control-Allow-Origin'],'https://chefos.shop'); assert.equal(calls.length,0);
});
test('falha do banco produz mensagem pública controlada',async t => {
  backend(t,() => [500,{message:'private backend diagnostic',code:'XX000'}]); t.mock.method(console,'error',() => {});
  const result=await send(valid()); assert.equal(result.code,502); assert.doesNotMatch(JSON.stringify(result.body),/private backend/);
});

test('vínculo verifica o proprietário pelo endpoint administrativo antes do RPC',async t => {
  const id=randomUUID(),storeId=randomUUID(),ownerId=randomUUID();
  const candidate={id,status:'approved',email:'beta@example.invalid',updated_at:'2026-10-02T18:00:00Z'};
  const calls=backend(t,call => {
    if(call.path==='/rest/v1/beta_applications') return [200,[candidate]];
    if(call.path==='/rest/v1/stores') return [200,[{id:storeId,owner_id:ownerId}]];
    if(call.path===`/auth/v1/admin/users/${ownerId}`) return [200,{id:ownerId,email:candidate.email}];
    if(call.path==='/rest/v1/rpc/update_beta_application_atomic') return [200,{...candidate,status:'onboarding'}];
    throw Error('Unexpected endpoint '+call.path);
  });
  const result=await updateBetaApplication({user:{id:randomUUID(),email:'admin@example.invalid'},capabilities:['onboarding.manage']},{id,status:'onboarding',storeId,note:'Preparar conta',expectedUpdatedAt:candidate.updated_at});
  assert.equal(result.status,'onboarding'); assert.equal(calls.at(-1).body.p_store_id,storeId);
});
test('operação de outro proprietário não pode ser vinculada ao candidato',async t => {
  const id=randomUUID(),storeId=randomUUID(),ownerId=randomUUID();
  const candidate={id,status:'approved',email:'beta@example.invalid',updated_at:'2026-10-02T18:00:00Z'};
  const calls=backend(t,call => call.path==='/rest/v1/beta_applications' ? [200,[candidate]] : call.path==='/rest/v1/stores' ? [200,[{id:storeId,owner_id:ownerId}]] : [200,{email:'other@example.invalid'}]);
  await assert.rejects(updateBetaApplication({user:{id:randomUUID(),email:'admin@example.invalid'},capabilities:['onboarding.manage']},{id,status:'onboarding',storeId,note:'Preparar conta',expectedUpdatedAt:candidate.updated_at}),error => error.status===409);
  assert.equal(calls.some(call=>call.path.includes('/rpc/')),false);
});
test('ativação do beta recusa plano pago antes de iniciar o período gratuito',async t=>{
  const id=randomUUID(),storeId=randomUUID(),planId=randomUUID();
  const candidate={id,status:'onboarding',email:'beta@example.invalid',updated_at:'2026-10-02T18:00:00Z',participant:{store_id:storeId,subscription_id:randomUUID()}};
  const calls=backend(t,call=>call.path==='/rest/v1/beta_applications'?[200,[candidate]]:call.path==='/rest/v1/subscriptions'?[200,[{id:candidate.participant.subscription_id,plan_id:planId,mercado_pago_subscription_id:null}]]:[200,[{id:planId,price:199}]]);
  await assert.rejects(updateBetaApplication({user:{id:randomUUID(),email:'admin@example.invalid'}},{id,status:'active',note:'Ativar participante',expectedUpdatedAt:candidate.updated_at}),error=>error.status===409);
  assert.equal(calls.some(call=>call.path.includes('/rpc/')),false);
});
