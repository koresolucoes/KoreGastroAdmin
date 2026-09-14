import baseHealthHandler from './health.js';
import { fiscalHealthSnapshot } from '../_lib/fiscal-health.js';

function statusRank(status) {
  return ({ healthy: 0, attention: 1, degraded: 2, critical: 3 }[status] ?? 1);
}

function combineStatus(base, fiscal) {
  const rank = Math.max(statusRank(base), statusRank(fiscal));
  return ['healthy', 'attention', 'degraded', 'critical'][rank] || 'attention';
}

function recomputeSummary(groups) {
  const rows = Object.values(groups || {}).flat();
  return {
    operational: rows.filter((item) => item.status === 'ok').length,
    attention: rows.filter((item) => ['attention', 'unknown'].includes(item.status)).length,
    degraded: rows.filter((item) => ['degraded', 'critical'].includes(item.status)).length,
    total: rows.length,
  };
}

function captureResponse() {
  const state = { status: 200, headers: new Map(), body: null, ended: false };
  const response = {
    status(code) { state.status = code; return this; },
    setHeader(name, value) { state.headers.set(String(name).toLowerCase(), value); return this; },
    getHeader(name) { return state.headers.get(String(name).toLowerCase()); },
    json(body) { state.body = body; state.ended = true; return this; },
    end(body) { state.body = body ?? state.body; state.ended = true; return this; },
  };
  return { state, response };
}

export default async function handler(req, res) {
  const { state, response } = captureResponse();
  await baseHealthHandler(req, response);

  for (const [name, value] of state.headers.entries()) res.setHeader(name, value);
  if (req.method === 'OPTIONS' || state.status >= 400 || !state.body || typeof state.body !== 'object') {
    if (state.ended && state.body !== null && typeof state.body !== 'object') return res.status(state.status).end(state.body);
    return res.status(state.status).json(state.body || { error: 'Health check unavailable.' });
  }

  try {
    const fiscal = await fiscalHealthSnapshot();
    const body = { ...state.body };
    const groups = {
      ...(body.groups || {}),
      business: [...(body.groups?.business || []), ...(fiscal.checks || [])],
    };
    body.groups = groups;
    body.checks = {
      ...(body.checks || {}),
      ...Object.fromEntries((fiscal.checks || []).map((item) => [item.id, item])),
    };
    body.metrics = { ...(body.metrics || {}), fiscal: fiscal.metrics };
    body.fiscal = {
      schemaReady: fiscal.schemaReady,
      status: fiscal.status,
      metrics: fiscal.metrics,
      units: fiscal.units,
    };
    body.status = combineStatus(body.status, fiscal.status);
    body.summary = recomputeSummary(groups);

    const httpStatus = body.status === 'healthy' ? 200 : 207;
    return res.status(httpStatus).json(body);
  } catch (error) {
    console.error('[admin-health] fiscal extension failed', error);
    const body = { ...state.body };
    body.groups = {
      ...(body.groups || {}),
      business: [
        ...(body.groups?.business || []),
        {
          id: 'fiscal_health_probe',
          label: 'Observabilidade fiscal',
          group: 'business',
          status: 'unknown',
          message: 'Não foi possível carregar a telemetria fiscal nesta verificação.',
        },
      ],
    };
    body.status = combineStatus(body.status, 'attention');
    body.summary = recomputeSummary(body.groups);
    return res.status(207).json(body);
  }
}
