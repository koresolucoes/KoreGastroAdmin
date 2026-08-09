import { assert, assertUuid, auditAdminAction, bodyOf, cleanText, fail, requireAdmin, reply, supabase } from '../_lib/admin.js';
import { PLAN_PERMISSION_GROUPS } from '../_lib/plan-permissions.js';

async function replacePermissions(planId, keys) {
  await supabase(`/rest/v1/plan_permissions?plan_id=eq.${encodeURIComponent(planId)}`, { method: 'DELETE' });
  if (keys.length) {
    await supabase('/rest/v1/plan_permissions', { method: 'POST', body: keys.map((permission_key) => ({ plan_id: planId, permission_key })) });
  }
}

async function makePopularExclusive(planId) {
  await supabase(`/rest/v1/plans?id=neq.${encodeURIComponent(planId)}&isMostPopular=eq.true`, {
    method: 'PATCH',
    body: { isMostPopular: false }
  });
}

function normalizePlan(input, partial = false) {
  const plan = input && typeof input === 'object' ? input : {};
  const normalized = {};
  if (!partial || plan.name !== undefined) {
    normalized.name = cleanText(plan.name, 120);
    assert(normalized.name.length >= 2, 'Nome do plano é obrigatório.');
  }
  if (!partial || plan.slug !== undefined) {
    normalized.slug = cleanText(plan.slug, 80).toLowerCase();
    assert(/^[a-z0-9_-]+$/.test(normalized.slug), 'Identificador do plano inválido. Use letras, números, hífen ou underscore.');
  }
  for (const [source, target, minimum, integer] of [
    ['price', 'price', 0, false],
    ['trial_period_days', 'trial_period_days', 0, true],
    ['max_stores', 'max_stores', 1, true]
  ]) {
    if (partial && plan[source] === undefined) continue;
    const value = Number(plan[source] ?? minimum);
    assert(Number.isFinite(value) && value >= minimum && (!integer || Number.isInteger(value)), `${source} inválido.`);
    normalized[target] = value;
  }
  if (!partial || plan.recurring !== undefined) normalized.recurring = plan.recurring !== false;
  if (!partial || plan.description !== undefined) normalized.description = cleanText(plan.description, 500) || null;
  if (!partial || plan.preapproval_plan_id !== undefined) normalized.preapproval_plan_id = cleanText(plan.preapproval_plan_id, 255) || null;
  if (!partial || plan.mp_reason !== undefined) normalized.mp_reason = cleanText(plan.mp_reason, 255) || null;
  if (!partial || plan.isMostPopular !== undefined) normalized.isMostPopular = Boolean(plan.isMostPopular);
  return normalized;
}

export default async function handler(req, res) {
  const context = await requireAdmin(req, res, 'GET, POST, PUT, DELETE, OPTIONS');
  if (!context) return;
  try {
    if (req.method === 'GET') {
      const result = await supabase('/rest/v1/plans?select=*,plan_permissions(*)&order=price.asc');
      return reply(res, 200, { data: result.data || [], permissionCatalog: PLAN_PERMISSION_GROUPS });
    }
    const payload = await bodyOf(req);
    const { id, plan } = payload;
    const permissionsProvided = Object.prototype.hasOwnProperty.call(payload, 'permissions');
    const permissions = permissionsProvided ? payload.permissions : [];
    assert(Array.isArray(permissions), 'permissions deve ser uma lista.');
    if (req.method === 'POST') {
      const normalizedPlan = normalizePlan(plan);
      const created = await supabase('/rest/v1/plans', { method: 'POST', headers: { Prefer: 'return=representation' }, body: normalizedPlan });
      await replacePermissions(created.data[0].id, [...new Set(permissions.map((key) => cleanText(key, 120)).filter(Boolean))]);
      if (normalizedPlan.isMostPopular) await makePopularExclusive(created.data[0].id);
      await auditAdminAction(context, 'ADMIN_PLAN_CREATED', { plan: created.data[0], permissionCount: permissions.length });
      return reply(res, 201, { data: created.data[0] });
    }
    assertUuid(id, 'id do plano');
    if (req.method === 'PUT') {
      const normalizedPlan = plan ? normalizePlan(plan, true) : null;
      assert((normalizedPlan && Object.keys(normalizedPlan).length) || permissionsProvided, 'Nenhuma alteração válida foi informada.');
      if (normalizedPlan && Object.keys(normalizedPlan).length) await supabase(`/rest/v1/plans?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: normalizedPlan });
      if (permissionsProvided) await replacePermissions(id, [...new Set(permissions.map((key) => cleanText(key, 120)).filter(Boolean))]);
      if (normalizedPlan?.isMostPopular) await makePopularExclusive(id);
      await auditAdminAction(context, 'ADMIN_PLAN_UPDATED', { planId: id, changes: normalizedPlan || {}, permissionCount: permissionsProvided ? permissions.length : null });
      return reply(res, 200, { success: true });
    }
    if (req.method === 'DELETE') {
      const linked = await supabase(`/rest/v1/subscriptions?select=id&plan_id=eq.${encodeURIComponent(id)}&limit=1`);
      assert(!linked.data?.length, 'Este plano possui assinaturas vinculadas e não pode ser excluído.');
      await supabase(`/rest/v1/plans?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
      await auditAdminAction(context, 'ADMIN_PLAN_DELETED', { planId: id });
      return reply(res, 200, { success: true });
    }
    return reply(res, 405, { error: 'Método não permitido.' });
  } catch (error) {
    return fail(res, error);
  }
}
