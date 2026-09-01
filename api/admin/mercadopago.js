import { auditAdminAction, bodyOf, fail, hasCapability, requireAdmin, reply } from '../_lib/admin.js';
import { portalBilling } from '../_lib/portal-billing.js';

function requireCapability(context, capability) {
  if (!hasCapability(context, capability)) {
    const error = new Error('Você não possui permissão para executar esta ação de cobrança.');
    error.status = 403;
    throw error;
  }
}

export default async function handler(req, res) {
  const context = await requireAdmin(req, res, 'GET, POST, OPTIONS');
  if (!context) return;
  try {
    if (req.method === 'GET') {
      requireCapability(context, 'health.read');
      const data = await portalBilling(req);
      return reply(res, 200, data);
    }

    if (req.method !== 'POST') return reply(res, 405, { error: 'Método não permitido.' });
    const payload = await bodyOf(req);
    const action = String(payload.action || '');
    if (['sync_all_plans', 'sync_plan'].includes(action)) requireCapability(context, 'plans.manage');
    else if (['sync_subscription', 'cancel_subscription'].includes(action)) requireCapability(context, 'subscriptions.manage');
    else {
      const error = new Error('Ação de cobrança inválida.');
      error.status = 400;
      throw error;
    }

    const data = await portalBilling(req, { method: 'POST', body: payload });
    await auditAdminAction(context, 'ADMIN_MERCADOPAGO_ACTION', {
      action,
      planId: payload.planId || null,
      storeId: payload.storeId || null,
      outcome: 'success',
      provider: 'mercadopago'
    });
    return reply(res, 200, data);
  } catch (error) {
    return fail(res, error);
  }
}
