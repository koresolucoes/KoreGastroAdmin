import {
  assert,
  assertEnum,
  assertUuid,
  auditAdminAction,
  bodyOf,
  cleanText,
  fail,
  requireAdmin,
  reply,
  supabase
} from '../_lib/admin.js';

const STATUSES = ['open', 'in_progress', 'resolved', 'closed'];

export default async function handler(req, res) {
  const context = await requireAdmin(req, res, 'POST, OPTIONS');
  if (!context) return;
  if (req.method !== 'POST') return reply(res, 405, { error: 'Método não permitido.' });

  try {
    const { ticket_id, text, status_update = 'in_progress' } = await bodyOf(req);
    assertUuid(ticket_id, 'ticket_id');
    const messageText = cleanText(text, 10000);
    assert(messageText, 'Escreva uma mensagem antes de enviar.');
    assertEnum(status_update, STATUSES, 'status');
    const ticket = await supabase(`/rest/v1/support_tickets?select=id,status,client_id&id=eq.${encodeURIComponent(ticket_id)}&limit=1`);
    assert(ticket.data?.[0], 'Chamado não encontrado.');

    const created = await supabase('/rest/v1/support_ticket_messages', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: { ticket_id, sender_id: context.user.id, sender_type: 'admin', text: messageText }
    });
    await supabase(`/rest/v1/support_tickets?id=eq.${encodeURIComponent(ticket_id)}`, {
      method: 'PATCH',
      body: { status: status_update, updated_at: new Date().toISOString() }
    });
    await auditAdminAction(context, 'ADMIN_SUPPORT_REPLY_SENT', {
      ticketId: ticket_id,
      previousStatus: ticket.data[0].status,
      status: status_update,
      messageId: created.data?.[0]?.id || null
    });
    return reply(res, 201, { data: created.data?.[0] || null });
  } catch (error) {
    return fail(res, error);
  }
}
