import { clampInteger, fail, queryValue, requireAdmin, reply } from '../_lib/admin.js';
import { buildCustomerDataset, customerSummary, filterCustomers } from '../_lib/customers.js';

const allowedStatuses = new Set(['all', 'active', 'trialing', 'past_due', 'canceled', 'unpaid', 'none']);

export default async function handler(req, res) {
  const context = await requireAdmin(req, res, 'GET, OPTIONS');
  if (!context) return;
  if (req.method !== 'GET') return reply(res, 405, { error: 'Método não permitido.' });

  try {
    const page = clampInteger(queryValue(req, 'page', 1), 1, 1, 100000);
    const pageSize = clampInteger(queryValue(req, 'pageSize', 100), 100, 10, 500);
    const query = String(queryValue(req, 'query', '')).trim().slice(0, 120);
    const requestedStatus = String(queryValue(req, 'status', 'all'));
    const status = allowedStatuses.has(requestedStatus) ? requestedStatus : 'all';
    const allCustomers = await buildCustomerDataset();
    const filtered = filterCustomers(allCustomers, { query, status });
    const start = (page - 1) * pageSize;
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const data = filtered.slice(start, start + pageSize);

    return reply(res, 200, {
      data,
      summary: customerSummary(allCustomers),
      meta: {
        page,
        pageSize,
        pages,
        total: filtered.length,
        globalTotal: allCustomers.length,
        returned: data.length,
        hasPrevious: page > 1,
        hasNext: page < pages
      }
    });
  } catch (error) {
    return fail(res, error);
  }
}
