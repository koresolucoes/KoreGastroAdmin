import { fail, requireAdmin, reply, supabaseAll } from '../_lib/admin.js';
import { buildCustomerDataset, customerSummary } from '../_lib/customers.js';

const DAY = 86400000;

export default async function handler(req, res) {
  const context = await requireAdmin(req, res, 'GET, OPTIONS');
  if (!context) return;
  if (req.method !== 'GET') return reply(res, 405, { error: 'Método não permitido.' });

  try {
    const [customers, plans, tickets, invoices] = await Promise.all([
      buildCustomerDataset(),
      supabaseAll('/rest/v1/plans?select=id,name,price,recurring,trial_period_days,max_stores&order=price.asc'),
      supabaseAll('/rest/v1/support_tickets?select=id,status,priority,created_at,updated_at&order=created_at.desc').catch(() => []),
      supabaseAll('/rest/v1/subscription_invoices?select=id,status,amount,created_at,paid_at&order=created_at.desc', { maxRows: 5000 }).catch(() => [])
    ]);

    const now = Date.now();
    const planById = new Map(plans.map((plan) => [plan.id, plan]));
    const subscriptions = customers.map((customer) => customer.subscription).filter(Boolean);
    const validActive = subscriptions.filter((item) => item.status === 'active' && item.entitlementActive);
    const validTrials = subscriptions.filter((item) => item.status === 'trialing' && item.entitlementActive);
    const expiredButEnabled = subscriptions.filter((item) => ['active', 'trialing'].includes(item.status) && item.periodExpired);
    const byStatus = subscriptions.reduce((acc, item) => {
      acc[item.status || 'unknown'] = (acc[item.status || 'unknown'] || 0) + 1;
      return acc;
    }, {});
    const contractedMonthly = validActive.reduce((total, item) => total + Number(planById.get(item.plan_id)?.price || 0), 0);
    const renewalsNext7Days = validActive.filter((item) => {
      const renewal = new Date(item.current_period_end).getTime();
      return Number.isFinite(renewal) && renewal >= now && renewal <= now + (7 * DAY);
    }).length;
    const trialsEnding7Days = validTrials.filter((item) => {
      const end = new Date(item.current_period_end).getTime();
      return Number.isFinite(end) && end >= now && end <= now + (7 * DAY);
    }).length;
    const ticketBreakdown = tickets.reduce((acc, ticket) => {
      acc[ticket.status || 'unknown'] = (acc[ticket.status || 'unknown'] || 0) + 1;
      return acc;
    }, {});
    const urgentTickets = tickets.filter((ticket) => ['Urgente', 'Alta'].includes(ticket.priority) && !['resolved', 'closed'].includes(ticket.status)).length;
    const waitingOver24Hours = tickets.filter((ticket) => {
      if (!['open', 'in_progress'].includes(ticket.status)) return false;
      return now - new Date(ticket.updated_at || ticket.created_at).getTime() > DAY;
    }).length;
    const failedPayments30Days = invoices.filter((invoice) => {
      const created = new Date(invoice.created_at).getTime();
      return created >= now - (30 * DAY) && !['approved', 'authorized', 'paid'].includes(String(invoice.status).toLowerCase());
    }).length;
    const summary = customerSummary(customers);

    return reply(res, 200, {
      data: {
        generatedAt: new Date().toISOString(),
        tenants: summary.total,
        stores: summary.stores,
        incompleteOnboarding: summary.incompleteOnboarding,
        withoutSubscription: summary.withoutSubscription,
        subscriptions: byStatus,
        activeSubscriptions: validActive.length,
        activeTrials: validTrials.length,
        expiredButEnabled: expiredButEnabled.length,
        contractedMonthly,
        mrr: contractedMonthly,
        arr: contractedMonthly * 12,
        renewalsNext7Days,
        trialsEnding7Days,
        atRiskSubscriptions: subscriptions.filter((item) => ['past_due', 'unpaid'].includes(item.status)).length,
        failedPayments30Days,
        openTickets: tickets.filter((ticket) => ticket.status === 'open').length,
        inProgressTickets: tickets.filter((ticket) => ticket.status === 'in_progress').length,
        urgentTickets,
        waitingOver24Hours,
        ticketBreakdown,
        dataQuality: {
          revenueMode: 'contracted_estimate',
          providerReconciliation: false,
          warnings: [
            'Receita calculada pelo preço atual do plano; ainda não reconciliada com recorrência do Mercado Pago.',
            ...(expiredButEnabled.length ? [`${expiredButEnabled.length} assinatura(s) com status ativo/trial e período vencido.`] : [])
          ]
        }
      }
    });
  } catch (error) {
    return fail(res, error);
  }
}
