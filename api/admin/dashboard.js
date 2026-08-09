import { countFromRange, fail, requireAdmin, reply, supabase } from '../_lib/admin.js';

export default async function handler(req, res) {
  const context = await requireAdmin(req, res, 'GET, OPTIONS');
  if (!context) return;
  if (req.method !== 'GET') return reply(res, 405, { error: 'Método não permitido.' });
  try {
    const [profiles, subscriptions, plans, tickets] = await Promise.all([
      supabase('/rest/v1/profiles?select=id', { headers: { Prefer: 'count=exact' } }),
      supabase('/rest/v1/subscriptions?select=status,plan_id'),
      supabase('/rest/v1/plans?select=id,name,price&order=price.asc'),
      supabase('/rest/v1/support_tickets?select=status', { headers: { Prefer: 'count=exact' } }).catch(() => ({ data: [] }))
    ]);
    const planById = new Map((plans.data || []).map((plan) => [plan.id, plan]));
    const allSubscriptions = subscriptions.data || [];
    const active = allSubscriptions.filter((item) => item.status === 'active');
    const byStatus = allSubscriptions.reduce((acc, item) => {
      acc[item.status || 'unknown'] = (acc[item.status || 'unknown'] || 0) + 1;
      return acc;
    }, {});
    const mrr = active.reduce((total, item) => total + Number(planById.get(item.plan_id)?.price || 0), 0);
    return reply(res, 200, {
      data: {
        tenants: countFromRange(profiles.count),
        subscriptions: byStatus,
        activeSubscriptions: active.length,
        mrr,
        openTickets: (tickets.data || []).filter((ticket) => ticket.status === 'open').length
      }
    });
  } catch (error) {
    return fail(res, error);
  }
}
