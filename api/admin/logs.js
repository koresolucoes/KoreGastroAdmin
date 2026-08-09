import { fail, requireAdmin, reply, supabase } from '../_lib/admin.js';

export default async function handler(req, res) {
  const context = await requireAdmin(req, res, 'GET, OPTIONS');
  if (!context) return;
  if (req.method !== 'GET') return reply(res, 405, { error: 'Método não permitido.' });
  try {
    const logs = await supabase('/rest/v1/system_logs?select=*&order=created_at.desc&limit=150');
    return reply(res, 200, { data: logs.data || [] });
  } catch (error) {
    if (error?.details?.code === '42P01') return reply(res, 200, { data: [] });
    return fail(res, error);
  }
}
