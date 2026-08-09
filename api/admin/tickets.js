import { assert, bodyOf, fail, requireAdmin, reply, supabase } from '../_lib/admin.js';

export default async function handler(req, res) {
  const context = await requireAdmin(req, res, 'GET, POST, PUT, OPTIONS');
  if (!context) return;
  try {
    if (req.method === 'GET') {
      const tickets = await supabase('/rest/v1/support_tickets?select=*,messages:support_ticket_messages(*)&order=created_at.desc');
      const clientIds = [...new Set((tickets.data || []).map((ticket) => ticket.client_id).filter(Boolean))];
      let profiles = [];
      if (clientIds.length) {
        profiles = (await supabase(`/rest/v1/profiles?select=id,full_name&${'id'}=in.(${clientIds.map(encodeURIComponent).join(',')})`)).data || [];
      }
      const names = new Map(profiles.map((profile) => [profile.id, profile.full_name]));
      const data = (tickets.data || []).map((ticket) => ({
        ...ticket,
        client_name: names.get(ticket.client_id) || ticket.store_name || 'Cliente',
        messages: (ticket.messages || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      }));
      return reply(res, 200, { data });
    }
    const payload = await bodyOf(req);
    if (req.method === 'POST') {
      assert(payload.client_id && payload.subject, 'Cliente e assunto são obrigatórios.');
      const created = await supabase('/rest/v1/support_tickets', {
        method: 'POST', headers: { Prefer: 'return=representation' },
        body: { client_id: payload.client_id, store_name: payload.store_name || 'Geral', subject: payload.subject, priority: payload.priority || 'Média', status: 'open' }
      });
      return reply(res, 201, { data: created.data?.[0] || null });
    }
    if (req.method === 'PUT') {
      assert(payload.id && payload.updates, 'id e atualizações são obrigatórios.');
      const updated = await supabase(`/rest/v1/support_tickets?id=eq.${encodeURIComponent(payload.id)}`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' }, body: { ...payload.updates, updated_at: new Date().toISOString() }
      });
      return reply(res, 200, { data: updated.data?.[0] || null });
    }
    return reply(res, 405, { error: 'Método não permitido.' });
  } catch (error) {
    if (error?.details?.code === '42P01') return reply(res, 200, { data: [] });
    return fail(res, error);
  }
}

