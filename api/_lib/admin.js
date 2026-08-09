const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8' };

function config() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    const error = new Error('Configuração do Supabase ausente no servidor.');
    error.status = 500;
    throw error;
  }
  return { url: url.replace(/\/$/, ''), serviceKey };
}

export function applyCors(req, res, methods = 'GET, POST, PUT, DELETE, OPTIONS') {
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
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
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
  return reply(res, status, { error: error?.message || 'Erro interno.' });
}

export async function supabase(path, options = {}) {
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
    const error = new Error(data?.message || data?.error_description || data?.hint || 'Falha ao consultar o Supabase.');
    error.status = response.status >= 400 && response.status < 500 ? response.status : 502;
    error.details = data;
    throw error;
  }
  return { data, count: response.headers.get('content-range') };
}

export async function requireAdmin(req, res, methods) {
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
    const filter = encodeURIComponent(`eq.${user.email.toLowerCase()}`);
    const admin = await supabase(`/rest/v1/system_admins?select=email&email=${filter}&limit=1`);
    if (!Array.isArray(admin.data) || admin.data.length === 0) {
      reply(res, 403, { error: 'Acesso restrito a administradores do sistema.' });
      return null;
    }
    return { user, token: match[1] };
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

export function assert(condition, message) {
  if (!condition) {
    const error = new Error(message);
    error.status = 400;
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

export async function auditAdminAction(context, action, details = {}) {
  if (!context?.user?.id) return;
  try {
    await supabase('/rest/v1/system_logs', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: {
        user_id: context.user.id,
        action: cleanText(action, 120),
        details: JSON.stringify({
          actorEmail: context.user.email || null,
          source: 'koregastro-admin',
          ...details
        })
      }
    });
  } catch (error) {
    console.warn('[Admin audit] Não foi possível registrar o evento.', error?.message || error);
  }
}
