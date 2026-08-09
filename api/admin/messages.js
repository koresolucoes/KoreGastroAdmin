import { assert, bodyOf, fail, requireAdmin, reply, supabase } from '../_lib/admin.js';

export default async function handler(req, res) {
  const context = await requireAdmin(req, res, 'POST, OPTIONS');
  if (!context) return;
  if (req.method !== 'POST') return reply(res, 405, { error: 'Método não permitido.' });
  try {
    const { ticket_id, text, status_update } = await bodyOf(req);
    assert(ticket_id && text, 'ticket_id e texto são obrigatórios.');
    const created = await supabase('/rest/v1/support_ticket_messages', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: { ticket_id, sender_id: context.user.id, sender_type: 'admin', text }
    });
    if (status_update) {
      await supabase(`/rest/v1/support_tickets?id=eq.${encodeURIComponent(ticket_id)}`, {
        method: 'PATCH', body: { status: status_update, updated_at: new Date().toISOString() }
      });
    }
    return reply(res, 201, { data: created.data?.[0] || null });
  } catch (error) {
    return fail(res, error);
  }
}
