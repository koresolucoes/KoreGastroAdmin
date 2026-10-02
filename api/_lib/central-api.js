const API_BASE = (process.env.CHEFOS_API_URL || 'https://api.chefos.online').replace(/\/$/, '');

export async function centralRequest(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload.error;
    const message = typeof detail === 'string' ? detail : detail?.message || payload.message || 'Não foi possível consultar a integração.';
    throw Object.assign(new Error(message), { status: response.status });
  }
  return payload;
}
