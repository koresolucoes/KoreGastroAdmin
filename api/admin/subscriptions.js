import {
  assert,
  assertEnum,
  assertUuid,
  auditAdminAction,
  bodyOf,
  cleanText,
  fail,
  queryValue,
  requireAdmin,
  reply,
  supabase,
  supabaseAll,
  validIsoDate
} from '../_lib/admin.js';

const STATUSES = ['active', 'trialing', 'past_due', 'canceled', 'unpaid'];

async function resolveStoreId({ storeId, accountId }) {
  if (storeId) {
    assertUuid(storeId, 'storeId');
    const store = await supabase(`/rest/v1/stores?select=id,owner_id,name&id=eq.${encodeURIComponent(storeId)}&limit=1`);
    assert(store.data?.[0], 'Loja não encontrada.');
    return store.data[0];
  }

  assertUuid(accountId, 'accountId');
  const stores = await supabase(`/rest/v1/stores?select=id,owner_id,name&owner_id=eq.${encodeURIComponent(accountId)}&order=created_at.asc&limit=2`);
  assert(stores.data?.length, 'Nenhuma loja encontrada para esta conta.');
  assert(stores.data.length === 1, 'Esta conta possui mais de uma loja. Informe storeId explicitamente.');
  return stores.data[0];
}

export default async function handler(req, res) {
  const context = await requireAdmin(req, res, 'GET, POST, OPTIONS');
  if (!context) return;

  try {
    if (req.method === 'GET') {
      const requestedStoreId = queryValue(req, 'storeId', '');
      const accountId = queryValue(req, 'accountId', '');
      let filter = '';
      if (requestedStoreId || accountId) {
        const store = await resolveStoreId({ storeId: requestedStoreId, accountId });
        filter = `&user_id=eq.${encodeURIComponent(store.id)}`;
      }
      const rows = await supabaseAll(`/rest/v1/subscriptions?select=id,user_id,plan_id,status,current_period_end,created_at,updated_at,mercado_pago_subscription_id,cancel_at_period_end,canceled_at,payment_method_id&order=updated_at.desc${filter}`);
      return reply(res, 200, { data: rows.map((item) => ({ ...item, storeId: item.user_id })) });
    }

    if (req.method !== 'POST') return reply(res, 405, { error: 'Método não permitido.' });
    const payload = await bodyOf(req);
    const requestedStoreId = cleanText(payload.storeId, 80);
    const accountId = cleanText(payload.accountId || payload.userId, 80);
    const status = cleanText(payload.status, 30);
    const planId = cleanText(payload.planId, 80);
    const reason = cleanText(payload.reason, 500);
    const currentPeriodEnd = validIsoDate(payload.currentPeriodEnd);

    const store = await resolveStoreId({ storeId: requestedStoreId, accountId });
    assertEnum(status, STATUSES, 'status');
    assert(reason.length >= 5, 'Informe o motivo da alteração para a auditoria.');
    if (planId) assertUuid(planId, 'planId');

    const [existingResult, planResult] = await Promise.all([
      supabase(`/rest/v1/subscriptions?select=*&user_id=eq.${encodeURIComponent(store.id)}&limit=1`),
      planId ? supabase(`/rest/v1/plans?select=id,name,trial_period_days&id=eq.${encodeURIComponent(planId)}&limit=1`) : Promise.resolve({ data: [] })
    ]);
    const existing = existingResult.data?.[0] || null;
    if (planId) assert(planResult.data?.[0], 'Plano não encontrado.');

    if (!existing) {
      assert(planId, 'planId é obrigatório para criar uma assinatura.');
      assert(currentPeriodEnd, 'Informe o vencimento para criar uma assinatura.');
      const created = await supabase('/rest/v1/subscriptions', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: {
          // Legacy schema name: subscriptions.user_id references stores.id.
          user_id: store.id,
          plan_id: planId,
          status,
          current_period_end: currentPeriodEnd,
          canceled_at: status === 'canceled' ? new Date().toISOString() : null,
          cancel_at_period_end: false
        }
      });
      await auditAdminAction(context, 'ADMIN_SUBSCRIPTION_CREATED', {
        accountId: store.owner_id,
        storeId: store.id,
        reason,
        after: created.data?.[0] || { plan_id: planId, status, current_period_end: currentPeriodEnd }
      });
      return reply(res, 201, {
        data: created.data?.[0] ? { ...created.data[0], storeId: store.id } : null,
        providerSync: 'not_configured',
        warning: 'A alteração foi aplicada internamente e ainda não sincroniza o ciclo recorrente do Mercado Pago.'
      });
    }

    const updates = {
      status,
      updated_at: new Date().toISOString(),
      canceled_at: status === 'canceled' ? (existing.canceled_at || new Date().toISOString()) : null
    };
    if (planId) updates.plan_id = planId;
    if (currentPeriodEnd) updates.current_period_end = currentPeriodEnd;
    if (payload.cancelAtPeriodEnd !== undefined) updates.cancel_at_period_end = Boolean(payload.cancelAtPeriodEnd);
    if (status !== 'canceled' && payload.cancelAtPeriodEnd === undefined) updates.cancel_at_period_end = false;

    const updated = await supabase(`/rest/v1/subscriptions?id=eq.${encodeURIComponent(existing.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: updates
    });
    await auditAdminAction(context, 'ADMIN_SUBSCRIPTION_UPDATED', {
      accountId: store.owner_id,
      storeId: store.id,
      subscriptionId: existing.id,
      reason,
      before: existing,
      after: updated.data?.[0] || updates
    });
    return reply(res, 200, {
      data: updated.data?.[0] ? { ...updated.data[0], storeId: store.id } : null,
      providerSync: 'not_configured',
      warning: 'A alteração foi aplicada internamente e ainda não sincroniza o ciclo recorrente do Mercado Pago.'
    });
  } catch (error) {
    return fail(res, error);
  }
}
