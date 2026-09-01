const DEFAULT_PORTAL_URL = 'https://portal.chefos.online';

function portalUrl() {
  return String(process.env.CHEFOS_PORTAL_URL || DEFAULT_PORTAL_URL).replace(/\/$/, '');
}

function bearer(req) {
  const authorization = String(req.headers?.authorization || '');
  if (!/^Bearer\s+.+/i.test(authorization)) {
    const error = new Error('Sessão administrativa ausente para consultar o billing do Portal.');
    error.status = 401;
    throw error;
  }
  return authorization;
}

export async function portalBilling(req, { method = 'GET', body } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${portalUrl()}/api/mercadopago-billing-admin`, {
      method,
      signal: controller.signal,
      headers: {
        Authorization: bearer(req),
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = { error: text }; }
    }
    if (!response.ok) {
      const error = new Error(data?.error || `Portal de billing respondeu HTTP ${response.status}.`);
      error.status = response.status >= 400 && response.status < 500 ? response.status : 502;
      error.details = data;
      throw error;
    }
    return data || {};
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('Tempo limite ao consultar o billing do ChefOS Portal.');
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
