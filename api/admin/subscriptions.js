import { assert, bodyOf, fail, requireAdmin, reply, supabase } from '../_lib/admin.js';

export default async function handler(req, res) {
  const context = await requireAdmin(req, res, 'POST, OPTIONS');
  if (!context) return;
  if (req.method !== 'POST') return reply(res, 405, { error: 'Método não permitido.' });
  try {
    const { userId, status, planId, currentPeriodEnd } = await bodyOf(req);
    assert(userId && status, 'userId e status são obrigatórios.');
    const existing = await supabase(`/rest/v1/subscriptions?select=id&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
    const period = currentPeriodEnd || (status === 'active' ? new Date(Date.now() + 30 * 86400000).toISOString() : undefined);
    if (existing.data?.[0]) {
      const payload = { status, updated_at: new Date().toISOString() };
      if (planId) payload.plan_id = planId;
      if (period) payload.current_period_end = period;
      await supabase(`/rest/v1/subscriptions?id=eq.${existing.data[0].id}`, { method: 'PATCH', body: payload });
    } else {
      let finalPlanId = planId;
      if (!finalPlanId) {
        const plans = await supabase('/rest/v1/plans?select=id&order=price.asc&limit=1');
        finalPlanId = plans.data?.[0]?.id;
      }
      assert(finalPlanId, 'Cadastre um plano antes de criar uma assinatura.');
      await supabase('/rest/v1/subscriptions', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: { user_id: userId, plan_id: finalPlanId, status, current_period_end: period || new Date(Date.now() + 30 * 86400000).toISOString() }
      });
    }
    return reply(res, 200, { success: true });
  } catch (error) {
    return fail(res, error);
  }
}

