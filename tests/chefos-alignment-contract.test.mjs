import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ENTITLED_SUBSCRIPTION_STATUSES,
  isCurrentPeriodEntitled,
  isSubscriptionEntitled
} from '../api/_lib/subscription-entitlements.js';

const [provision, subscriptions, customers, dashboard, health, permissionCatalog] = await Promise.all([
  readFile(new URL('../api/admin/provision-tenant.js', import.meta.url), 'utf8'),
  readFile(new URL('../api/admin/subscriptions.js', import.meta.url), 'utf8'),
  readFile(new URL('../api/_lib/customers.js', import.meta.url), 'utf8'),
  readFile(new URL('../api/admin/dashboard.js', import.meta.url), 'utf8'),
  readFile(new URL('../api/admin/health.js', import.meta.url), 'utf8'),
  readFile(new URL('../api/_lib/plan-permissions.js', import.meta.url), 'utf8')
]);

test('entitlement canônico aceita active, trialing e past_due com período vigente', () => {
  assert.deepEqual(ENTITLED_SUBSCRIPTION_STATUSES, ['active', 'trialing', 'past_due']);
  const future = new Date(Date.now() + 60_000).toISOString();
  for (const status of ENTITLED_SUBSCRIPTION_STATUSES) {
    assert.equal(isSubscriptionEntitled({ status, current_period_end: future }), true, status);
  }
  assert.equal(isSubscriptionEntitled({ status: 'canceled', current_period_end: future }), false);
  assert.equal(isSubscriptionEntitled({ status: 'unpaid', current_period_end: future }), false);
});

test('período expirado ou inválido não concede entitlement', () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  assert.equal(isCurrentPeriodEntitled(null), true);
  assert.equal(isCurrentPeriodEntitled(past), false);
  assert.equal(isCurrentPeriodEntitled('data-invalida'), false);
  assert.equal(isSubscriptionEntitled({ status: 'active', current_period_end: past }), false);
});

test('provisionamento garante OWNER membership e preserva dual-write legado', () => {
  assert.match(provision, /store_memberships/);
  assert.match(provision, /access_level:\s*'OWNER'/);
  assert.match(provision, /status:\s*'ACTIVE'/);
  assert.match(provision, /accepted_at/);
  assert.match(provision, /ensureLegacyStoreAccess/);
  assert.match(provision, /unit_permissions/);
  assert.match(provision, /ensureSubscription\(store\.id, plan\)/);
});

test('assinaturas administrativas usam storeId como semântica canônica com fallback de accountId', () => {
  assert.match(subscriptions, /resolveStoreId/);
  assert.match(subscriptions, /requestedStoreId/);
  assert.match(subscriptions, /owner_id=eq/);
  assert.match(subscriptions, /user_id:\s*store\.id/);
  assert.match(customers, /subscriptionsByStore/);
  assert.match(customers, /storeId:\s*item\.user_id/);
});

test('observabilidade administrativa verifica entitlement e OWNER membership', () => {
  assert.match(dashboard, /pastDueWithAccess/);
  assert.match(dashboard, /membershipIssues/);
  assert.match(health, /past_due_access/);
  assert.match(health, /owner_memberships/);
  assert.match(health, /ENTITLED_SUBSCRIPTION_STATUSES/);
});

test('catálogo comercial preserva chaves de rota atualmente usadas pelos planos', () => {
  for (const key of ['/pos', '/cashier', '/kds', '/delivery-tracking', '/whatsapp', '/whatsapp-chats', '/inventory', '/payroll']) {
    assert.ok(permissionCatalog.includes(`key: '${key}'`), `Permissão ausente: ${key}`);
  }
});
