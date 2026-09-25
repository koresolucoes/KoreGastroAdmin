import {
  auditAdminAction,
  bodyOf,
  fail,
  requireAdmin,
  reply,
  assert,
  assertUuid,
  cleanText
} from '../_lib/admin.js';

const API_BASE = (process.env.CHEFOS_API_URL || 'https://api.chefos.online').replace(/\/$/, '');
const ALLOWED_STATUSES = new Set([
  'ACCESS_REQUESTED',
  'WAITING_MERCHANT_APPROVAL',
  'APPROVED_PENDING_VERIFICATION',
  'NEEDS_INFORMATION',
  'REJECTED'
]);

async function centralRequest(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${options.token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || 'A API central recusou a operação.');
    error.status = response.status;
    throw error;
  }
  return payload;
}

export default async function handler(req, res) {
  const context = await requireAdmin(req, res, 'GET, POST, OPTIONS');
  if (!context) return;

  try {
    if (req.method === 'GET') {
      const result = await centralRequest('/api/ifood-integration-requests?action=adminList', { token: context.token });
      return reply(res, 200, result);
    }
    if (req.method !== 'POST') return reply(res, 405, { error: 'Método não permitido.' });

    const payload = await bodyOf(req);
    const action = cleanText(payload.action, 40);
    const requestId = cleanText(payload.requestId, 64);
    assertUuid(requestId, 'Solicitação');

    let forwarded;
    if (action === 'adminUpdate') {
      const status = cleanText(payload.status, 48);
      assert(ALLOWED_STATUSES.has(status), 'Status inválido.');
      forwarded = { action, requestId, status };
    } else if (action === 'adminConnect') {
      const merchantId = cleanText(payload.merchantId, 180);
      assert(merchantId.length >= 3, 'Informe o merchantId validado no portal do iFood.');
      forwarded = { action, requestId, merchantId };
    } else {
      assert(false, 'Ação administrativa inválida.');
    }

    const result = await centralRequest('/api/ifood-integration-requests', {
      method: 'POST',
      token: context.token,
      body: forwarded
    });
    await auditAdminAction(context, action === 'adminConnect' ? 'IFOOD_REQUEST_CONNECTED' : 'IFOOD_REQUEST_UPDATED', {
      targetType: 'ifood_integration_request',
      targetId: requestId,
      requestId,
      status: forwarded.status || 'CONNECTED',
      merchantId: forwarded.merchantId || undefined
    });
    return reply(res, 200, result);
  } catch (error) {
    return fail(res, error);
  }
}
