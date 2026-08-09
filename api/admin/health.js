import { fail, requireAdmin, reply, supabase } from '../_lib/admin.js';

export default async function handler(req, res) {
  const context = await requireAdmin(req, res, 'GET, OPTIONS');
  if (!context) return;
  if (req.method !== 'GET') return reply(res, 405, { error: 'Método não permitido.' });
  const startedAt = Date.now();
  try {
    const databaseStartedAt = Date.now();
    await supabase('/rest/v1/plans?select=id&limit=1');
    const databaseLatency = Date.now() - databaseStartedAt;
    const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter((name) => !process.env[name]);
    const totalLatency = Date.now() - startedAt;
    const degraded = databaseLatency > 1200 || missing.length > 0;
    return reply(res, degraded ? 207 : 200, {
      status: degraded ? 'degraded' : 'healthy',
      app: 'KoreGastro Admin',
      timestamp: new Date().toISOString(),
      latencyMs: totalLatency,
      checks: {
        database: { status: databaseLatency > 1200 ? 'degraded' : 'ok', latencyMs: databaseLatency, message: 'Banco operacional' },
        environment: { status: missing.length ? 'error' : 'ok', message: missing.length ? `Variáveis ausentes: ${missing.join(', ')}` : 'Configuração principal presente' }
      },
      system: { nodeVersion: process.version, uptimeSeconds: Math.floor(process.uptime()), memoryUsageMB: Math.round(process.memoryUsage().rss / 1024 / 1024) }
    });
  } catch (error) {
    return fail(res, error);
  }
}
