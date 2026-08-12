import { randomUUID } from 'node:crypto';

const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };

export const ROLE_DEFINITIONS = Object.freeze({
  owner: {
    label: 'Proprietário',
    description: 'Controle completo, segurança e gestão de proprietários.',
    capabilities: ['*']
  },
  platform_admin: {
    label: 'Administrador',
    description: 'Opera toda a plataforma, exceto o limite de segurança do proprietário.',
    capabilities: [
      'dashboard.read', 'customers.read', 'subscriptions.read', 'subscriptions.manage',
      'support.read', 'support.manage', 'plans.read', 'plans.manage', 'catalog.read',
      'catalog.manage', 'onboarding.manage', 'health.read', 'health.run', 'audit.read',
      'audit.export', 'access.read', 'access.manage', 'beta.read', 'beta.manage'
    ]
  },
  finance: {
    label: 'Financeiro',
    description: 'Clientes, planos, assinaturas e cobrança.',
    capabilities: ['dashboard.read', 'customers.read', 'subscriptions.read', 'subscriptions.manage', 'plans.read', 'health.read', 'audit.read']
  },
  support: {
    label: 'Suporte',
    description: 'Clientes, chamados e contexto de assinaturas.',
    capabilities: ['dashboard.read', 'customers.read', 'subscriptions.read', 'support.read', 'support.manage', 'health.read', 'audit.read', 'beta.read', 'beta.manage']
  },
  auditor: {
    label: 'Auditor',
    description: 'Acesso somente leitura à operação, saúde e trilhas.',
    capabilities: ['dashboard.read', 'customers.read', 'subscriptions.read', 'support.read', 'plans.read', 'catalog.read', 'health.read', 'audit.read', 'audit.export', 'access.read']
  }
});

const ROUTE_CAPABILITIES = Object.freeze({
  dashboard: { GET: 'dashboard.read' },
  customers: { GET: 'customers.read' },
  restaurants: { GET: 'customers.read' },
  subscriptions: { GET: 'subscriptions.read', POST: 'subscriptions.manage', PUT: 'subscriptions.manage', DELETE: 'subscriptions.manage' },
  tickets: { GET: 'support.read', POST: 'support.manage', PUT: 'support.manage' },
  messages: { POST: 'support.manage' },
  plans: { GET: 'plans.read', POST: 'plans.manage', PUT: 'plans.manage', DELETE: 'plans.manage' },
  'tenant-menu': { GET: 'catalog.read', POST: 'catalog.manage', PUT: 'catalog.manage', DELETE: 'catalog.manage' },
  'provision-tenant': { POST: 'onboarding.manage' },
  health: { GET: 'health.read', POST: 'health.run' },
  logs: { GET: 'audit.read' },
  administrators: { GET: 'access.read', POST: 'access.manage', PUT: 'access.manage', PATCH: 'access.manage', DELETE: 'access.manage' },
  'beta-applications': { GET: 'beta.read', PATCH: 'beta.manage', POST: 'beta.manage' }
});

function config() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceKey) {
    const error = new Error('Configuração do Supabase ausente no servidor.');
    error.status = 500;
    throw error;
  }
  return { url: url.replace(/\/$/, ''), serviceKey };
}

export function applyCors(req, res, methods = 'GET, POST, PUT, PATCH, DELETE, OPTIONS') {
  const origin = req.headers.origin;
  const allowed = (process.env.ADMIN_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-Id');
}

export function reply(res, status, body) {
  res.status(status).setHeader('Content-Type', jsonHeaders['Content-Type']).json(body);
}

export function methodNotAllowed(res) {
  return reply(res, 405, { error: 'Método não permitido.' });
}

export async function bodyOf(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      const error = new Error('JSON inválido.');
      error.status = 400;
      throw error;
    }
  }
  return req.body;
}

export function fail(res, error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  if (status >= 500) console.error(error);
  return reply(res, status, {
    error: error?.message || 'Erro interno.',
    ...(error?.code ? { code: error.code } : {})
  });
}

async function remote(path, options = {}) {
  const { url, serviceKey } = config();
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    ...(options.headers || {})
  };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${url}${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!response.ok) {
    const error = new Error(data?.message || data?.msg || data?.error_description || data?.hint || 'Falha ao consultar o Supabase.');
    error.status = response.status >= 400 && response.status < 500 ? response.status : 502;
    error.details = data;
    throw error;
  }
  return { data, count: response.headers.get('content-range'), status: response.status };
}

export function supabase(path, options = {}) {
  return remote(path, options);
}

export function supabaseAuthAdmin(path, options = {}) {
  return remote(path.startsWith('/auth/v1') ? path : `/auth/v1${path}`, options);
}

export function capabilitiesForRole(role) {
  return [...(ROLE_DEFINITIONS[role]?.capabilities || [])];
}

export function hasCapability(context, capability) {
  if (!capability) return true;
  const capabilities = context?.capabilities || [];
  return capabilities.includes('*') || capabilities.includes(capability);
}

function decodeJwtClaims(token) {
  try {
    const payload = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/');
    if (!payload) return {};
    return JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  } catch {
    return {};
  }
}

function routeCapability(req) {
  const path = String(req.url || '').split('?')[0].split('/').filter(Boolean);
  const route = path[path.length - 1];
  return ROUTE_CAPABILITIES[route]?.[req.method] || null;
}

export function isSchemaCompatibilityError(error) {
  const code = error?.details?.code;
  return ['42703', '42P01', 'PGRST204', 'PGRST205'].includes(code)
    || /column|relation|schema cache/i.test(String(error?.message || ''));
}

async function membershipForEmail(email) {
  const filter = encodeURIComponent(`eq.${email}`);
  try {
    const result = await supabase(`/rest/v1/system_admins?select=email,auth_user_id,display_name,role,status,mfa_required,last_seen_at,created_at,updated_at&email=${filter}&limit=1`);
    return { member: result.data?.[0] || null, legacy: false };
  } catch (error) {
    if (!isSchemaCompatibilityError(error)) throw error;
    const legacy = await supabase(`/rest/v1/system_admins?select=email,created_at&email=${filter}&limit=1`);
    return { member: legacy.data?.[0] || null, legacy: true };
  }
}

export async function requireAdmin(req, res, methods, requiredCapability = null) {
  applyCors(req, res, methods);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return null;
  }
  const authorization = req.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    reply(res, 401, { error: 'Sessão ausente.' });
    return null;
  }

  try {
    const { url, serviceKey } = config();
    const response = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${match[1]}` }
    });
    const user = await response.json();
    if (!response.ok || !user?.email) {
      reply(res, 401, { error: 'Sessão inválida ou expirada.' });
      return null;
    }

    const email = user.email.trim().toLowerCase();
    const { member, legacy } = await membershipForEmail(email);
    if (!member) {
      reply(res, 403, { error: 'Acesso restrito a administradores do sistema.' });
      return null;
    }

    const protectedEmail = protectedAdminEmails().has(email);
    const role = protectedEmail ? 'owner' : (member.role || 'platform_admin');
    let status = member.status || 'active';
    let activatedFromInvite = false;
    if (status === 'invited' && !legacy && (user.email_confirmed_at || user.confirmed_at)) {
      await supabase(`/rest/v1/system_admins?email=eq.${encodeURIComponent(email)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: { status: 'active', auth_user_id: user.id, access_reason: 'Convite aceito e e-mail confirmado' }
      });
      status = 'active';
      activatedFromInvite = true;
    }
    if (status !== 'active') {
      reply(res, 403, { error: `Acesso administrativo ${status === 'suspended' ? 'suspenso' : 'inativo'}.`, code: 'ADMIN_INACTIVE' });
      return null;
    }

    const claims = decodeJwtClaims(match[1]);
    const context = {
      user,
      token: match[1],
      claims,
      requestId: cleanText(req.headers['x-request-id'] || req.headers['x-vercel-id'] || randomUUID(), 160),
      admin: { ...member, email, role, status, protected: protectedEmail, legacy },
      capabilities: capabilitiesForRole(role),
      mfaVerified: claims.aal === 'aal2'
    };

    if (activatedFromInvite) {
      await auditAdminAction(context, 'ADMIN_ACCESS_ACTIVATED', {
        email,
        reason: 'Convite aceito e e-mail confirmado',
        before: { status: 'invited' },
        after: { status: 'active', auth_user_id: user.id },
        severity: 'high'
      });
    }

    const capability = requiredCapability || routeCapability(req);
    if (!hasCapability(context, capability)) {
      reply(res, 403, { error: 'Seu perfil não possui permissão para esta operação.', code: 'CAPABILITY_REQUIRED', capability });
      return null;
    }

    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const enforceMfa = process.env.ADMIN_ENFORCE_MFA === 'true';
    if (mutating && enforceMfa && context.admin.mfa_required && !context.mfaVerified) {
      reply(res, 403, { error: 'Confirme o segundo fator para executar esta ação.', code: 'MFA_REQUIRED' });
      return null;
    }
    return context;
  } catch (error) {
    fail(res, error);
    return null;
  }
}

export function protectedAdminEmails() {
  return new Set((process.env.ROOT_ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean));
}

export function countFromRange(range) {
  const match = /\/(\d+)$/.exec(range || '');
  return match ? Number(match[1]) : 0;
}

export function assert(condition, message, status = 400) {
  if (!condition) {
    const error = new Error(message);
    error.status = status;
    throw error;
  }
}

export function queryValue(req, name, fallback = '') {
  const value = req?.query?.[name];
  if (Array.isArray(value)) return value[0] ?? fallback;
  return value ?? fallback;
}

export function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

export function assertUuid(value, label = 'id') {
  assert(isUuid(value), `${label} inválido.`);
}

export function assertEnum(value, allowed, label) {
  assert(allowed.includes(value), `${label} inválido.`);
}

export function cleanText(value, maxLength = 500) {
  return String(value ?? '').trim().slice(0, maxLength);
}

export function validIsoDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  assert(Number.isFinite(parsed.getTime()), 'Data inválida.');
  return parsed.toISOString();
}

export async function supabaseAll(path, options = {}) {
  const pageSize = clampInteger(options.pageSize, 1000, 1, 1000);
  const maxRows = clampInteger(options.maxRows, 10000, pageSize, 50000);
  const rows = [];

  while (rows.length < maxRows) {
    const end = Math.min(rows.length + pageSize, maxRows) - 1;
    const result = await supabase(path, {
      headers: {
        Range: `${rows.length}-${end}`,
        'Range-Unit': 'items',
        ...(options.headers || {})
      }
    });
    const batch = Array.isArray(result.data) ? result.data : [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }

  return rows;
}

function auditCategory(action) {
  if (/ACCESS|ADMINISTRATOR|SESSION|MFA/.test(action)) return 'access';
  if (/SUBSCRIPTION|INVOICE|PAYMENT/.test(action)) return 'billing';
  if (/SUPPORT|TICKET|MESSAGE/.test(action)) return 'support';
  if (/PLAN|MENU|CATALOG/.test(action)) return 'product';
  if (/TENANT|CUSTOMER|PROVISION/.test(action)) return 'customer';
  return 'system';
}

function auditSeverity(action) {
  if (/REVOKED|SUSPENDED|OWNER|MFA_DISABLED/.test(action)) return 'critical';
  if (/ACCESS|ADMINISTRATOR|SUBSCRIPTION|DELETED/.test(action)) return 'high';
  if (/UPDATED|CREATED|PROVISION/.test(action)) return 'medium';
  return 'low';
}

function redactAuditValue(value, depth = 0) {
  if (depth > 8) return '[limite de profundidade]';
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactAuditValue(item, depth + 1));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (/password|secret|token|authorization|service.?role|api.?key|raw.?payload/i.test(key)) return [key, '[redigido]'];
    return [key, redactAuditValue(item, depth + 1)];
  }));
}

function auditTarget(details) {
  const pairs = [
    ['administrator', details.email || details.adminEmail],
    ['subscription', details.subscriptionId || details.accountId],
    ['ticket', details.ticketId || details.ticket?.id],
    ['plan', details.planId || details.plan?.id],
    ['menu_item', details.itemId || details.item?.id],
    ['tenant', details.tenantId || details.userId]
  ];
  return pairs.find(([, value]) => value) || [details.targetType || null, details.targetId || null];
}

export async function auditAdminAction(context, action, details = {}) {
  if (!context?.user?.id || !context?.user?.email) return;
  const safeDetails = redactAuditValue(details);
  const [targetType, targetId] = auditTarget(safeDetails);
  const { before, after, reason, outcome, severity, category, ...metadata } = safeDetails;
  const event = {
    actor_user_id: context.user.id,
    actor_email: context.user.email.toLowerCase(),
    action: cleanText(action, 120),
    category: cleanText(category || auditCategory(action), 60),
    severity: cleanText(severity || auditSeverity(action), 20),
    target_type: cleanText(targetType, 80) || null,
    target_id: cleanText(targetId, 180) || null,
    tenant_id: isUuid(safeDetails.tenantId || safeDetails.userId) ? (safeDetails.tenantId || safeDetails.userId) : null,
    store_id: isUuid(safeDetails.storeId) ? safeDetails.storeId : null,
    outcome: ['success', 'failure', 'blocked'].includes(outcome) ? outcome : 'success',
    reason: cleanText(reason, 500) || null,
    before_state: before && typeof before === 'object' ? before : null,
    after_state: after && typeof after === 'object' ? after : null,
    metadata,
    request_id: context.requestId || null
  };

  try {
    await supabase('/rest/v1/admin_audit_events', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: event
    });
  } catch (error) {
    if (!isSchemaCompatibilityError(error)) console.warn('[Admin audit] Falha na trilha estruturada.', error?.message || error);
  }

  try {
    await supabase('/rest/v1/system_logs', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: {
        user_id: context.user.id,
        action: event.action,
        details: JSON.stringify({ actorEmail: event.actor_email, source: 'koregastro-admin', requestId: event.request_id, ...safeDetails })
      }
    });
  } catch (error) {
    console.warn('[Admin audit] Não foi possível registrar o evento legado.', error?.message || error);
  }
}
