import {
  assert,
  assertUuid,
  auditAdminAction,
  bodyOf,
  cleanText,
  fail,
  requireAdmin,
  reply,
  supabase
} from '../_lib/admin.js';

const DAY = 86400000;

async function ensurePrimaryStore(accountId, storeName) {
  const existing = await supabase(`/rest/v1/stores?select=id,name,owner_id,created_at&owner_id=eq.${encodeURIComponent(accountId)}&order=created_at.asc&limit=1`);
  if (existing.data?.[0]) return { store: existing.data[0], created: false };

  const created = await supabase('/rest/v1/stores', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: { id: accountId, owner_id: accountId, name: storeName }
  });
  return { store: created.data?.[0], created: true };
}

async function ensureCompanyProfile(store, values) {
  const existing = await supabase(`/rest/v1/company_profile?select=user_id,external_api_key&user_id=eq.${encodeURIComponent(store.id)}&limit=1`);
  const externalApiKey = existing.data?.[0]?.external_api_key || globalThis.crypto.randomUUID();
  await supabase('/rest/v1/company_profile?on_conflict=user_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: {
      user_id: store.id,
      company_name: values.storeName,
      cnpj: values.cnpj || '00.000.000/0000-00',
      phone: values.phone || null,
      address: values.address || null,
      external_api_key: externalApiKey
    }
  });
  return externalApiKey;
}

async function ensureSubscription(accountId, plan) {
  const existing = await supabase(`/rest/v1/subscriptions?select=*&user_id=eq.${encodeURIComponent(accountId)}&limit=1`);
  if (existing.data?.[0]) return { subscription: existing.data[0], created: false };

  const trialDays = Math.max(1, Number(plan.trial_period_days || 30));
  const created = await supabase('/rest/v1/subscriptions', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: {
      user_id: accountId,
      plan_id: plan.id,
      status: 'trialing',
      current_period_end: new Date(Date.now() + trialDays * DAY).toISOString(),
      cancel_at_period_end: false
    }
  });
  return { subscription: created.data?.[0], created: true };
}

async function ensureStoreAccess(accountId, storeId) {
  await supabase('/rest/v1/unit_permissions?on_conflict=manager_id,store_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: { manager_id: accountId, store_id: storeId, role: 'owner' }
  });
}

async function ensureDiningRoom(storeId) {
  const halls = await supabase(`/rest/v1/halls?select=id,name&user_id=eq.${encodeURIComponent(storeId)}&deleted_at=is.null&order=created_at.asc&limit=1`);
  let hall = halls.data?.[0];
  if (!hall) {
    const createdHall = await supabase('/rest/v1/halls', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: { user_id: storeId, name: 'Salão Principal' }
    });
    hall = createdHall.data?.[0];
  }
  assert(hall?.id, 'Não foi possível criar o salão inicial.');

  const existingTables = await supabase(`/rest/v1/tables?select=id&hall_id=eq.${encodeURIComponent(hall.id)}&deleted_at=is.null&limit=1`);
  if (!existingTables.data?.length) {
    const tables = Array.from({ length: 6 }, (_, index) => ({
      user_id: storeId,
      hall_id: hall.id,
      number: index + 1,
      x: 40 + (index % 3) * 150,
      y: 40 + Math.floor(index / 3) * 130,
      width: 110,
      height: 80
    }));
    await supabase('/rest/v1/tables', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: tables
    });
  }
  return hall;
}

export default async function handler(req, res) {
  const context = await requireAdmin(req, res, 'POST, OPTIONS');
  if (!context) return;
  if (req.method !== 'POST') return reply(res, 405, { error: 'Método não permitido.' });

  try {
    const payload = await bodyOf(req);
    const accountId = payload.accountId || payload.userId;
    const storeName = cleanText(payload.storeName, 180);
    const values = {
      storeName,
      cnpj: cleanText(payload.cnpj, 30),
      phone: cleanText(payload.phone, 40),
      address: cleanText(payload.address, 300)
    };

    assertUuid(accountId, 'accountId');
    assert(storeName.length >= 2, 'Nome da operação é obrigatório.');
    const authUser = await supabase(`/auth/v1/admin/users/${encodeURIComponent(accountId)}`);
    assert(authUser.data?.id, 'Conta não encontrada no Supabase Auth.');

    let planId = cleanText(payload.planId, 80);
    if (planId) assertUuid(planId, 'planId');
    if (!planId) {
      planId = (await supabase('/rest/v1/plans?select=id&order=price.asc&limit=1')).data?.[0]?.id;
    }
    assert(planId, 'Cadastre um plano antes de provisionar o cliente.');
    const planResult = await supabase(`/rest/v1/plans?select=id,name,trial_period_days&id=eq.${encodeURIComponent(planId)}&limit=1`);
    const plan = planResult.data?.[0];
    assert(plan, 'Plano não encontrado.');

    const { store, created: storeCreated } = await ensurePrimaryStore(accountId, storeName);
    assert(store?.id, 'Não foi possível criar ou localizar a loja principal.');
    const externalApiKey = await ensureCompanyProfile(store, values);
    const { subscription, created: subscriptionCreated } = await ensureSubscription(accountId, plan);
    await ensureStoreAccess(accountId, store.id);
    const hall = await ensureDiningRoom(store.id);

    await auditAdminAction(context, 'ADMIN_TENANT_PROVISIONED', {
      accountId,
      storeId: store.id,
      planId: plan.id,
      storeCreated,
      subscriptionCreated
    });

    return reply(res, storeCreated || subscriptionCreated ? 201 : 200, {
      success: true,
      idempotent: !storeCreated && !subscriptionCreated,
      tenant: {
        accountId,
        storeId: store.id,
        storeName: store.name,
        planId: plan.id,
        subscriptionId: subscription?.id || null,
        subscriptionStatus: subscription?.status || null,
        hallId: hall.id,
        apiKey: externalApiKey
      }
    });
  } catch (error) {
    return fail(res, error);
  }
}
