import { assert, assertEnum, assertUuid, auditAdminAction, bodyOf, cleanText, fail, queryValue, requireAdmin, reply, supabase } from '../_lib/admin.js';

const STATUSES = ['new','review','contact','interview','approved','onboarding','active','completed','converted','closed'];

export default async function handler(req, res) {
  const context = await requireAdmin(req, res, 'GET, PATCH, POST, OPTIONS', req.method === 'GET' ? 'beta.read' : 'beta.manage');
  if (!context) return;
  try {
    if (req.method === 'GET') {
      const status = cleanText(queryValue(req, 'status', ''), 30);
      if (status) assertEnum(status, STATUSES, 'status');
      const filter = status ? `&status=eq.${encodeURIComponent(status)}` : '';
      const result = await supabase(`/rest/v1/beta_applications?select=*,events:beta_application_events(id,event_type,from_status,to_status,actor_email,note,created_at),participant:beta_participants(id,status,cohort,activated_at,beta_ends_at)&order=submitted_at.desc${filter}&limit=250`);
      const data = (result.data || []).map((item) => ({ ...item, events: [...(item.events || [])].sort((a,b) => new Date(b.created_at) - new Date(a.created_at)) }));
      const summary = Object.fromEntries(STATUSES.map((key) => [key, data.filter((item) => item.status === key).length]));
      return reply(res, 200, { data, summary, stages: STATUSES });
    }

    const payload = await bodyOf(req);
    assertUuid(payload.id, 'candidatura');
    const before = await supabase(`/rest/v1/beta_applications?select=*&id=eq.${encodeURIComponent(payload.id)}&limit=1`);
    assert(before.data?.[0], 'Candidatura não encontrada.', 404);
    const current = before.data[0];

    if (req.method === 'PATCH') {
      const nextStatus = cleanText(payload.status, 30);
      assertEnum(nextStatus, STATUSES, 'status');
      const note = cleanText(payload.note, 1000) || null;
      const updated = await supabase(`/rest/v1/beta_applications?id=eq.${encodeURIComponent(payload.id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: { status: nextStatus, notes: note ?? current.notes, assigned_to: context.user.email, updated_at: new Date().toISOString() } });
      await supabase('/rest/v1/beta_application_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { application_id: payload.id, event_type: 'status_changed', from_status: current.status, to_status: nextStatus, actor_email: context.user.email, note } });
      await auditAdminAction(context, 'ADMIN_BETA_APPLICATION_UPDATED', { targetType: 'beta_application', targetId: payload.id, before: { status: current.status }, after: { status: nextStatus }, reason: note });
      return reply(res, 200, { data: updated.data?.[0] });
    }

    if (req.method === 'POST') {
      assert(['approved','onboarding'].includes(current.status), 'A candidatura deve estar aprovada antes da conversão.');
      const existing = await supabase(`/rest/v1/beta_participants?select=*&application_id=eq.${encodeURIComponent(payload.id)}&limit=1`);
      let participant = existing.data?.[0];
      if (!participant) {
        participant = (await supabase('/rest/v1/beta_participants', { method: 'POST', headers: { Prefer: 'return=representation' }, body: { application_id: payload.id, cohort: cleanText(payload.cohort || 'founders-2026', 80), status: 'onboarding' } })).data?.[0];
      }
      await supabase(`/rest/v1/beta_applications?id=eq.${encodeURIComponent(payload.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { status: 'onboarding', assigned_to: context.user.email, updated_at: new Date().toISOString() } });
      await supabase('/rest/v1/beta_application_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { application_id: payload.id, event_type: 'participant_created', from_status: current.status, to_status: 'onboarding', actor_email: context.user.email } });
      await auditAdminAction(context, 'ADMIN_BETA_PARTICIPANT_CREATED', { targetType: 'beta_application', targetId: payload.id, participantId: participant.id });
      return reply(res, 201, { data: participant });
    }
    return reply(res, 405, { error: 'Método não permitido.' });
  } catch (error) { return fail(res, error); }
}
