import {
  assert,
  assertEnum,
  assertUuid,
  auditAdminAction,
  bodyOf,
  cleanText,
  fail,
  queryValue,
  requireAdmin,
  reply,
  supabase
} from '../_lib/admin.js';

const STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const PRIORITIES = ['Baixa', 'Média', 'Alta', 'Urgente'];

function ticketSummary(tickets) {
  const now = Date.now();
  return tickets.reduce((summary, ticket) => {
    summary.total += 1;
    summary[ticket.status] = (summary[ticket.status] || 0) + 1;
    if (['open', 'in_progress'].includes(ticket.status)) {
      summary.active += 1;
      if (now - new Date(ticket.updated_at || ticket.created_at).getTime() > 86400000) summary.waitingOver24Hours += 1;
    }
    if (['Alta', 'Urgente'].includes(ticket.priority) && !['resolved', 'closed'].includes(ticket.status)) summary.priority += 1;
    return summary;
  }, { total: 0, active: 0, priority: 0, waitingOver24Hours: 0 });
}

export default async function handler(req, res) {
  const context = await requireAdmin(req, res, 'GET, POST, PUT, OPTIONS');
  if (!context) return;

  try {
    if (req.method === 'GET') {
      const ticketId = queryValue(req, 'id', '');
      if (ticketId) assertUuid(ticketId, 'id do chamado');
      const idFilter = ticketId ? `&id=eq.${encodeURIComponent(ticketId)}` : '';
      const tickets = await supabase(`/rest/v1/support_tickets?select=id,client_id,store_name,subject,priority,status,created_at,updated_at,messages:support_ticket_messages(id,sender_id,sender_type,text,created_at)&order=created_at.desc${idFilter}&limit=250`);
      const clientIds = [...new Set((tickets.data || []).map((ticket) => ticket.client_id).filter(Boolean))];
      let profiles = [];
      if (clientIds.length) {
        profiles = (await supabase(`/rest/v1/profiles?select=id,full_name&id=in.(${clientIds.map(encodeURIComponent).join(',')})`)).data || [];
      }
      const names = new Map(profiles.map((profile) => [profile.id, profile.full_name]));
      const now = Date.now();
      const data = (tickets.data || []).map((ticket) => {
        const updated = new Date(ticket.updated_at || ticket.created_at).getTime();
        const waitingHours = Number.isFinite(updated) ? Math.max(0, Math.floor((now - updated) / 3600000)) : 0;
        const messages = [...(ticket.messages || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        return {
          ...ticket,
          client_name: names.get(ticket.client_id) || ticket.store_name || 'Cliente',
          messages,
          messageCount: messages.length,
          waitingHours,
          slaState: ['open', 'in_progress'].includes(ticket.status) && waitingHours >= 24 ? 'overdue' : waitingHours >= 8 ? 'warning' : 'ok'
        };
      });
      return reply(res, 200, { data, summary: ticketSummary(data), meta: { limit: 250, returned: data.length } });
    }

    const payload = await bodyOf(req);
    if (req.method === 'POST') {
      assertUuid(payload.client_id, 'client_id');
      const subject = cleanText(payload.subject, 180);
      const priority = cleanText(payload.priority || 'Média', 20);
      assert(subject, 'Cliente e assunto são obrigatórios.');
      assertEnum(priority, PRIORITIES, 'prioridade');
      const created = await supabase('/rest/v1/support_tickets', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: {
          client_id: payload.client_id,
          store_name: cleanText(payload.store_name || 'Geral', 180),
          subject,
          priority,
          status: 'open'
        }
      });
      await auditAdminAction(context, 'ADMIN_SUPPORT_TICKET_CREATED', { ticket: created.data?.[0] || null });
      return reply(res, 201, { data: created.data?.[0] || null });
    }

    if (req.method === 'PUT') {
      assertUuid(payload.id, 'id do chamado');
      const requested = payload.updates || {};
      const updates = {};
      if (requested.status !== undefined) {
        assertEnum(requested.status, STATUSES, 'status');
        updates.status = requested.status;
      }
      if (requested.priority !== undefined) {
        assertEnum(requested.priority, PRIORITIES, 'prioridade');
        updates.priority = requested.priority;
      }
      if (requested.subject !== undefined) {
        updates.subject = cleanText(requested.subject, 180);
        assert(updates.subject, 'Assunto é obrigatório.');
      }
      assert(Object.keys(updates).length, 'Nenhuma atualização permitida foi informada.');
      updates.updated_at = new Date().toISOString();
      const before = await supabase(`/rest/v1/support_tickets?select=id,status,priority,subject&id=eq.${encodeURIComponent(payload.id)}&limit=1`);
      assert(before.data?.[0], 'Chamado não encontrado.');
      const updated = await supabase(`/rest/v1/support_tickets?id=eq.${encodeURIComponent(payload.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: updates
      });
      await auditAdminAction(context, 'ADMIN_SUPPORT_TICKET_UPDATED', { ticketId: payload.id, before: before.data[0], after: updated.data?.[0] || updates });
      return reply(res, 200, { data: updated.data?.[0] || null });
    }

    return reply(res, 405, { error: 'Método não permitido.' });
  } catch (error) {
    if (error?.details?.code === '42P01') return reply(res, 200, { data: [], summary: ticketSummary([]), meta: { limit: 250, returned: 0 } });
    return fail(res, error);
  }
}
