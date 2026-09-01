import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const health = read('api/admin/health.js');
const subscriptions = read('api/admin/subscriptions.js');
const proxy = read('api/admin/mercadopago.js');
const helper = read('api/_lib/portal-billing.js');
const ui = read('public/billing-integration.js');
const html = read('index.html');

test('health checks the real provider through the ChefOS Portal', () => {
  assert.match(health, /probe\('mercadopago', \(\) => portalBilling\(req\)\)/);
  assert.match(health, /mercadopago_connection/);
  assert.match(health, /webhookSecretConfigured/);
  assert.match(health, /invalidRemotePlans/);
  assert.match(health, /providerExpiredAccess/);
  assert.match(health, /legacyExpiredAccess/);
  assert.match(health, /não representam falha ativa do Mercado Pago/);
});

test('Control Center proxies provider actions without storing a second Mercado Pago secret', () => {
  assert.match(proxy, /portalBilling\(/);
  assert.match(proxy, /sync_all_plans/);
  assert.match(proxy, /cancel_subscription/);
  assert.match(helper, /CHEFOS_PORTAL_URL/);
  assert.match(helper, /Authorization: bearer\(req\)/);
  assert.doesNotMatch(helper, /MERCADOPAGO_ACCESS_TOKEN|MERCADO_PAGO_ACCESS_TOKEN/);
});

test('provider-managed subscriptions cannot drift through manual local edits', () => {
  assert.match(subscriptions, /existing\.mercado_pago_subscription_id/);
  assert.match(subscriptions, /providerAction = status === 'canceled' \? 'cancel_subscription' : 'sync_subscription'/);
  assert.match(subscriptions, /prevaleceu o estado real do Mercado Pago/);
  assert.match(subscriptions, /O vencimento de uma assinatura Mercado Pago é controlado pelo provedor/);
});

test('plan page exposes guided provider verification and synchronization', () => {
  assert.match(html, /billing-integration\.js/);
  assert.match(ui, /\/api\/admin\/mercadopago/);
  assert.match(ui, /sync_all_plans/);
  assert.match(ui, /Sincronizar Mercado Pago/);
  assert.match(ui, /Não é necessário copiar IDs manualmente/);
});
