import { assert, assertEnum, assertUuid, bodyOf, cleanText, fail, queryValue, requireAdmin, reply, supabase } from '../_lib/admin.js';
import {
  BETA_STATUSES, BETA_TRANSITIONS, assertBetaTransition, updateBetaApplication
} from '../_lib/beta-operations.js';

const STATUSES = BETA_STATUSES;

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
      return reply(res, 200, { data, summary, stages: STATUSES, transitions: BETA_TRANSITIONS });
    }

    const payload = await bodyOf(req);
    if (req.method === 'PATCH') {
      const updated = await updateBetaApplication(context, payload, {
        requireNote: true,
        expectedUpdatedAt: payload.expectedUpdatedAt
      });
      return reply(res, 200, { data: updated.data });
    }

    assertUuid(payload.id, 'candidatura');
    const before = await supabase(`/rest/v1/beta_applications?select=*,participant:beta_participants(id,status,cohort,activated_at,beta_ends_at)&id=eq.${encodeURIComponent(payload.id)}&limit=1`);
    assert(before.data?.[0], 'Candidatura não encontrada.', 404);
    const current = before.data[0];

    if (req.method === 'POST') {
      assert(['approved','onboarding'].includes(current.status), 'A candidatura precisa estar aprovada para iniciar o onboarding.', 409);
      assertBetaTransition(current.status, 'onboarding');
      await updateBetaApplication(context, {
        id: payload.id,
        status: 'onboarding',
        cohort: payload.cohort,
        note: cleanText(payload.note, 1000) || 'Participante preparado para iniciar o onboarding.',
        assignedTo: context.user.email,
        expectedUpdatedAt: payload.expectedUpdatedAt
      });
      const refreshed = await supabase(`/rest/v1/beta_participants?select=*&application_id=eq.${encodeURIComponent(payload.id)}&limit=1`);
      const participant = refreshed.data?.[0];
      assert(participant, 'O onboarding foi registrado, mas o participante não pôde ser carregado. Atualize a tela.', 502);
      return reply(res, 201, { data: participant });
    }
    return reply(res, 405, { error: 'Método não permitido.' });
  } catch (error) { return fail(res, error); }
}
