import { countFromRange, fail, requireAdmin, reply, supabase } from '../_lib/admin.js';

export default async function handler(req, res) {
  const context = await requireAdmin(req, res, 'GET, OPTIONS');
  if (!context) return;
  if (req.method !== 'GET') return reply(res, 405, { error: 'Método não permitido.' });
  try {
    const [profiles, stores, subscriptions, plans, tickets] = await Promise.all([
      supabase('/rest/v1/profiles?select=id', { headers: { Prefer: 'count=exact' } }),
      supabase('/rest/v1/stores?select=id', { headers: { Prefer: 'count=exact' } }),
      supabase('/rest/v1/subscriptions?select=status,plan_id,current_period_end'),
      supabase('/rest/v1/plans?select=id,name,price&order=price.asc'),
      supabase('/rest/v1/support_tickets?select=id,status,priority,created_at,updated_at&order=created_at.desc', { headers: { Prefer: 'count=exact' } }).catch(() => ({ data: [] }))
    ]);
    const planById = new Map((plans.data || []).map((plan) => [plan.id, plan]));
    const allSubscriptions = subscriptions.data || [];
    const active = allSubscriptions.filter((item) => item.status === 'active');
    const byStatus = allSubscriptions.reduce((acc, item) => {
      acc[item.status || 'unknown'] = (acc[item.status || 'unknown'] || 0) + 1;
      return acc;
    }, {});
    const mrr = active.reduce((total, item) => total + Number(planById.get(item.plan_id)?.price || 0), 0);
    const now = Date.now();
    const inSevenDays = now + (7 * 86400000);
    const renewalsNext7Days = active.filter((item) => {
      const renewal = new Date(item.current_period_end).getTime();
      return Number.isFinite(renewal) && renewal >= now && renewal <= inSevenDays;
    }).length;
    const atRiskSubscriptions = allSubscriptions.filter((item) => item.status === 'past_due').length;
    const allTickets = tickets.data || [];
    const ticketBreakdown = allTickets.reduce((acc, ticket) => {
      acc[ticket.status || 'unknown'] = (acc[ticket.status || 'unknown'] || 0) + 1;
      return acc;
    }, {});
    const urgentTickets = allTickets.filter((ticket) => {
      const priority = String(ticket.priority || '').toLowerCase();
      return ticket.status !== 'resolved' && ['urgent', 'high', 'urgente', 'alta'].includes(priority);
    }).length;
    return reply(res, 200, {
      data: {
        tenants: countFromRange(profiles.count),
        stores: countFromRange(stores.count),
        subscriptions: byStatus,
        activeSubscriptions: active.length,
        mrr,
        arr: mrr * 12,
        renewalsNext7Days,
        atRiskSubscriptions,
        openTickets: allTickets.filter((ticket) => ticket.status === 'open').length,
        inProgressTickets: allTickets.filter((ticket) => ticket.status === 'in_progress').length,
        urgentTickets,
        ticketBreakdown
      }
    });
  } catch (error) {
    return fail(res, error);
  }
}
