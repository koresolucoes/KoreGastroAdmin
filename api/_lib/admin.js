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
