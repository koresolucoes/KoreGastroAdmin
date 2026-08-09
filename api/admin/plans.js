import { assert, bodyOf, fail, requireAdmin, reply, supabase } from '../_lib/admin.js';

async function replacePermissions(planId, keys) {
  await supabase(`/rest/v1/plan_permissions?plan_id=eq.${planId}`, { method: 'DELETE' });
  if (keys.length) {
    await supabase('/rest/v1/plan_permissions', { method: 'POST', body: keys.map((permission_key) => ({ plan_id: planId, permission_key })) });
  }
}

export default async function handler(req, res) {
  const context = await requireAdmin(req, res, 'GET, POST, PUT, DELETE, OPTIONS');
  if (!context) return;
  try {
    if (req.method === 'GET') {
      const result = await supabase('/rest/v1/plans?select=*,plan_permissions(*)&order=price.asc');
      return reply(res, 200, { data: result.data || [] });
    }
    const { id, plan, permissions = [] } = await bodyOf(req);
    if (req.method === 'POST') {
      assert(plan?.name && plan?.slug, 'Nome e identificador do plano são obrigatórios.');
      const created = await supabase('/rest/v1/plans', { method: 'POST', headers: { Prefer: 'return=representation' }, body: plan });
      await replacePermissions(created.data[0].id, permissions);
      return reply(res, 201, { data: created.data[0] });
    }
    assert(id, 'id do plano é obrigatório.');
    if (req.method === 'PUT') {
      if (plan) await supabase(`/rest/v1/plans?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: plan });
      await replacePermissions(id, permissions);
      return reply(res, 200, { success: true });
    }
    if (req.method === 'DELETE') {
      await supabase(`/rest/v1/plans?id=eq.${id}`, { method: 'DELETE' });
      return reply(res, 200, { success: true });
    }
    return reply(res, 405, { error: 'Método não permitido.' });
  } catch (error) {
    return fail(res, error);
  }
}
