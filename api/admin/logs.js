import {
  assert,
  clampInteger,
  cleanText,
  countFromRange,
  fail,
  hasCapability,
  isSchemaCompatibilityError,
  queryValue,
  requireAdmin,
  reply,
  supabase
} from '../_lib/admin.js';

const ACTION_LABELS = {
  ADMIN_ACCESS_INVITED: 'Acesso administrativo convidado',
  ADMIN_ACCESS_ACTIVATED: 'Convite administrativo aceito',
  ADMIN_ACCESS_UPDATED: 'Acesso administrativo atualizado',
  ADMIN_ACCESS_SUSPENDED: 'Acesso administrativo suspenso',
  ADMIN_ACCESS_REVOKED: 'Acesso administrativo revogado',
  ADMIN_SUBSCRIPTION_CREATED: 'Assinatura criada',
  ADMIN_SUBSCRIPTION_UPDATED: 'Assinatura atualizada',
  ADMIN_SUPPORT_REPLY_SENT: 'Resposta de suporte enviada',
  ADMIN_SUPPORT_TICKET_CREATED: 'Chamado criado',
  ADMIN_SUPPORT_TICKET_UPDATED: 'Chamado atualizado',
  ADMIN_SUPPORT_WORK_ITEM_UPDATED: 'Card de suporte organizado',
  ADMIN_BETA_APPLICATION_UPDATED: 'Candidatura do beta atualizada',
  ADMIN_BETA_WORK_ITEM_UPDATED: 'Card do programa beta organizado',
  ADMIN_PLAN_CREATED: 'Plano criado',
  ADMIN_PLAN_UPDATED: 'Plano atualizado',
  ADMIN_PLAN_DELETED: 'Plano excluído',
  ADMIN_MENU_ITEM_CREATED: 'Item de cardápio criado',
  ADMIN_MENU_ITEM_UPDATED: 'Item de cardápio atualizado',
  ADMIN_TENANT_PROVISIONED: 'Cliente provisionado',
  ADMIN_HEALTH_CHECK_RUN: 'Verificação de saúde executada'
};

const CATEGORY_LABELS = {
  access: 'Acessos e segurança',
  billing: 'Financeiro e assinaturas',
  support: 'Suporte',
  beta: 'Programa beta',
  product: 'Produto e cardápio',
  customer: 'Clientes e onboarding',
  system: 'Sistema'
};

function categoryFromAction(action = '') {
  if (/ACCESS|ADMINISTRATOR|SESSION|MFA/.test(action)) return 'access';
  if (/SUBSCRIPTION|INVOICE|PAYMENT/.test(action)) return 'billing';
  if (/SUPPORT|TICKET|MESSAGE/.test(action)) return 'support';
  if (/BETA/.test(action)) return 'beta';
  if (/PLAN|MENU|CATALOG/.test(action)) return 'product';
  if (/TENANT|CUSTOMER|PROVISION/.test(action)) return 'customer';
  return 'system';
}

function safeJson(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return value ? { description: value } : {}; }
}

function legacyEvent(log) {
  const details = safeJson(log.details);
  const category = categoryFromAction(log.action);
  return {
    id: log.id,
    actor_user_id: log.user_id,
    actor_email: details.actorEmail || 'Não identificado',
    action: log.action,
    actionLabel: ACTION_LABELS[log.action] || log.action || 'Evento operacional',
    category,
    categoryLabel: CATEGORY_LABELS[category],
    severity: /DELETE|REVOKE|SUSPEND/.test(log.action || '') ? 'high' : 'low',
    target_type: null,
    target_id: null,
    outcome: 'success',
    reason: details.reason || null,
    before_state: details.before || null,
    after_state: details.after || null,
    metadata: details,
    request_id: details.requestId || null,
    created_at: log.created_at,
    legacy: true
  };
}

function presentEvent(event) {
  return {
    ...event,
    actionLabel: ACTION_LABELS[event.action] || event.action,
    categoryLabel: CATEGORY_LABELS[event.category] || event.category
  };
}

function summaryOf(data, total) {
  return {
    total,
    visible: data.length,
    highRisk: data.filter((item) => ['high', 'critical'].includes(item.severity)).length,
    failures: data.filter((item) => item.outcome !== 'success').length,
    actors: new Set(data.map((item) => item.actor_email).filter(Boolean)).size
  };
}

function textFilter(value) {
  return cleanText(value, 120).replace(/[,*()]/g, ' ');
}

export default async function handler(req, res) {
  const context = await requireAdmin(req, res, 'GET, OPTIONS');
  if (!context) return;
  if (req.method !== 'GET') return reply(res, 405, { error: 'Método não permitido.' });
  try {
    const page = clampInteger(queryValue(req, 'page'), 1, 1, 100000);
    const exporting = queryValue(req, 'export') === '1';
    assert(!exporting || hasCapability(context, 'audit.export'), 'Seu perfil não pode exportar a auditoria.', 403);
    const pageSize = exporting ? 1000 : clampInteger(queryValue(req, 'pageSize'), 40, 10, 100);
    const category = cleanText(queryValue(req, 'category'), 40);
    const outcome = cleanText(queryValue(req, 'outcome'), 20);
    const actor = textFilter(queryValue(req, 'actor'));
    const query = textFilter(queryValue(req, 'q'));
    const from = cleanText(queryValue(req, 'from'), 40);
    const to = cleanText(queryValue(req, 'to'), 40);
    const filters = [];
    if (category && category !== 'all') filters.push(`category=eq.${encodeURIComponent(category)}`);
    if (outcome && outcome !== 'all') filters.push(`outcome=eq.${encodeURIComponent(outcome)}`);
    if (actor) filters.push(`actor_email=ilike.${encodeURIComponent(`*${actor}*`)}`);
    if (from && Number.isFinite(new Date(from).getTime())) filters.push(`created_at=gte.${encodeURIComponent(new Date(from).toISOString())}`);
    if (to && Number.isFinite(new Date(to).getTime())) filters.push(`created_at=lte.${encodeURIComponent(new Date(`${to}T23:59:59`).toISOString())}`);
    if (query) {
      const pattern = `*${query}*`;
      filters.push(`or=${encodeURIComponent(`(action.ilike.${pattern},actor_email.ilike.${pattern},target_type.ilike.${pattern},target_id.ilike.${pattern})`)}`);
    }
    const start = exporting ? 0 : (page - 1) * pageSize;
    const end = start + pageSize - 1;

    try {
      const events = await supabase(`/rest/v1/admin_audit_events?select=*&order=created_at.desc${filters.length ? `&${filters.join('&')}` : ''}`, {
        headers: { Range: `${start}-${end}`, 'Range-Unit': 'items', Prefer: 'count=exact' }
      });
      const data = (events.data || []).map(presentEvent);
      const total = countFromRange(events.count) || data.length;
      return reply(res, 200, {
        data,
        summary: summaryOf(data, total),
        meta: { page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)), legacy: false },
        catalogs: {
          categories: Object.entries(CATEGORY_LABELS).map(([key, label]) => ({ key, label })),
          outcomes: [{ key: 'success', label: 'Sucesso' }, { key: 'failure', label: 'Falha' }, { key: 'blocked', label: 'Bloqueado' }]
        }
      });
    } catch (error) {
      if (!isSchemaCompatibilityError(error)) throw error;
      const logs = await supabase('/rest/v1/system_logs?select=*&order=created_at.desc&limit=150');
      let data = (logs.data || []).map(legacyEvent);
      if (category && category !== 'all') data = data.filter((item) => item.category === category);
      if (outcome && outcome !== 'all') data = data.filter((item) => item.outcome === outcome);
      if (actor) data = data.filter((item) => item.actor_email.toLowerCase().includes(actor.toLowerCase()));
      if (query) data = data.filter((item) => JSON.stringify(item).toLowerCase().includes(query.toLowerCase()));
      const total = data.length;
      data = exporting ? data : data.slice(start, end + 1);
      return reply(res, 200, {
        data,
        summary: summaryOf(data, total),
        meta: { page, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)), legacy: true },
        catalogs: { categories: Object.entries(CATEGORY_LABELS).map(([key, label]) => ({ key, label })), outcomes: [] }
      });
    }
  } catch (error) {
    if (error?.details?.code === '42P01') return reply(res, 200, { data: [], summary: summaryOf([], 0), meta: { page: 1, pages: 1, total: 0, legacy: true } });
    return fail(res, error);
  }
}
