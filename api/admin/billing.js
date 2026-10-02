import { assert, assertUuid, auditAdminAction, bodyOf, cleanText, fail, requireAdmin, reply } from '../_lib/admin.js';
import { centralRequest } from '../_lib/central-api.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const context = await requireAdmin(req, res, 'GET, POST, OPTIONS', req.method === 'POST' ? 'subscriptions.manage' : 'subscriptions.read');
  if (!context) return;
  try {
    if (req.method === 'GET') return reply(res, 200, await centralRequest('/api/mercadopago-billing-admin', { token: context.token }));
    if (req.method !== 'POST') return reply(res, 405, { error: 'Método não permitido.' });
    const payload = await bodyOf(req);
    // This bridge refreshes provider state only; it cannot create charges or cancel a recurring contract.
    assert(payload.action === 'sync_subscription', 'Ação não disponível neste painel.');
    assertUuid(payload.storeId, 'storeId');
    const reason = cleanText(payload.reason, 500);
    assert(reason.length >= 5, 'Informe o motivo para a auditoria.');
    const result = await centralRequest('/api/mercadopago-billing-admin', { token: context.token, method: 'POST', body: { action: 'sync_subscription', storeId: payload.storeId, reason } });
    await auditAdminAction(context, 'ADMIN_BILLING_SUBSCRIPTION_SYNCED', { storeId: payload.storeId, reason, after: result.data });
    return reply(res, 200, result);
  } catch (error) { return fail(res, error); }
}
