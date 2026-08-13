import { assert, assertEnum, assertUuid, auditAdminAction, bodyOf, cleanText, fail, queryValue, requireAdmin, reply, supabase } from '../_lib/admin.js';
import { BETA_STATUSES, updateBetaApplication } from '../_lib/beta-operations.js';

const STATUSES = BETA_STATUSES;
const BETA_DURATION_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(date, days) {
  return new Date(new Date(date).getTime() + days * DAY_MS).toISOString();
}

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
    if (req.method === 'PATCH') {
      const updated = await updateBetaApplication(context, payload, { requireNote: true });
      return reply(res, 200, { data: updated.data });
    }

    assertUuid(payload.id, 'candidatura');
    const before = await supabase(`/rest/v1/beta_applications?select=*,participant:beta_participants(id,status,cohort,activated_at,beta_ends_at)&id=eq.${encodeURIComponent(payload.id)}&limit=1`);
    assert(before.data?.[0], 'Candidatura não encontrada.', 404);
    const current = before.data[0];
    const now = new Date().toISOString();

    if (req.method === 'POST') {
      assert(['approved','onboarding'].includes(current.status), 'A candidatura deve estar aprovada antes da conversão.');
      const existing = await supabase(`/rest/v1/beta_participants?select=*&application_id=eq.${encodeURIComponent(payload.id)}&limit=1`);
      let participant = existing.data?.[0];
      if (!participant) {
        participant = (await supabase('/rest/v1/beta_participants', { method: 'POST', headers: { Prefer: 'return=representation' }, body: { application_id: payload.id, cohort: cleanText(payload.cohort || 'founders-2026', 80), status: 'onboarding', updated_at: now } })).data?.[0];
      } else {
        const participantPatch = {
          cohort: cleanText(payload.cohort || participant.cohort || 'founders-2026', 80),
          status: participant.status || 'onboarding',
          updated_at: now
        };
        if (participant.status === 'active' || ['completed', 'converted', 'closed'].includes(participant.status)) {
          participantPatch.activated_at = participant.activated_at || now;
          participantPatch.beta_ends_at = participant.beta_ends_at || addDays(participantPatch.activated_at, BETA_DURATION_DAYS);
        }
        participant = (await supabase(`/rest/v1/beta_participants?id=eq.${encodeURIComponent(participant.id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: participantPatch })).data?.[0] || participant;
      }
      await supabase(`/rest/v1/beta_applications?id=eq.${encodeURIComponent(payload.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: { status: 'onboarding', assigned_to: context.user.email, updated_at: new Date().toISOString() } });
      await supabase('/rest/v1/beta_application_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { application_id: payload.id, event_type: 'participant_created', from_status: current.status, to_status: 'onboarding', actor_email: context.user.email } });
      await auditAdminAction(context, 'ADMIN_BETA_PARTICIPANT_CREATED', { targetType: 'beta_application', targetId: payload.id, participantId: participant.id });
      return reply(res, 201, { data: participant });
    }
    return reply(res, 405, { error: 'Método não permitido.' });
  } catch (error) { return fail(res, error); }
}
