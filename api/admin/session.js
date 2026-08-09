import { fail, requireAdmin, reply } from '../_lib/admin.js';

export default async function handler(req, res) {
  const context = await requireAdmin(req, res, 'GET, OPTIONS');
  if (!context) return;
  if (req.method !== 'GET') return reply(res, 405, { error: 'Método não permitido.' });
  try {
    return reply(res, 200, { data: { id: context.user.id, email: context.user.email } });
  } catch (error) {
    return fail(res, error);
  }
}

