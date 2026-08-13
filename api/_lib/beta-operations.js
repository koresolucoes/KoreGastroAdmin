import { assert, assertEnum, assertUuid, auditAdminAction, cleanText, supabase } from './admin.js';

export const BETA_STATUSES = ['new','review','contact','interview','approved','onboarding','active','completed','converted','closed'];
export const BETA_PARTICIPANT_STATUSES = new Set(['onboarding', 'active', 'completed', 'converted', 'closed']);
export const BETA_DURATION_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(date, days) {
  return new Date(new Date(date).getTime() + days * DAY_MS).toISOString();
}

export async function updateBetaApplication(context, payload, options = {}) {
  assertUuid(payload.id, 'candidatura');
  const before = await supabase(`/rest/v1/beta_applications?select=*,participant:beta_participants(id,status,cohort,activated_at,beta_ends_at)&id=eq.${encodeURIComponent(payload.id)}&limit=1`);
  assert(before.data?.[0], 'Candidatura não encontrada.', 404);
  const current = before.data[0];
  const nextStatus = cleanText(payload.status ?? current.status, 30);
  assertEnum(nextStatus, BETA_STATUSES, 'status');
  const note = cleanText(payload.note, 1000) || null;
  const statusChanged = nextStatus !== current.status;
  const assignmentProvided = Object.hasOwn(payload, 'assignedTo');
  const nextAssignedTo = assignmentProvided
    ? (cleanText(payload.assignedTo, 254) || null)
    : (current.assigned_to || context.user.email);
  const assignmentChanged = nextAssignedTo !== (current.assigned_to || null);
  if (options.requireNote || statusChanged) assert(note, 'Registre uma observação sobre o contato ou a decisão.', 400);

  const now = new Date().toISOString();
  let updatedApplication = current;
  if (statusChanged || note || assignmentChanged) {
    const updated = await supabase(`/rest/v1/beta_applications?id=eq.${encodeURIComponent(payload.id)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: { status: nextStatus, notes: note ?? current.notes, assigned_to: nextAssignedTo, updated_at: now }
    });
    updatedApplication = updated.data?.[0] || { ...current, status: nextStatus, notes: note ?? current.notes, assigned_to: nextAssignedTo, updated_at: now };
    if (statusChanged || note) {
      await supabase('/rest/v1/beta_application_events', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: { application_id: payload.id, event_type: statusChanged ? 'status_changed' : 'note_added', from_status: current.status, to_status: nextStatus, actor_email: context.user.email, note }
      });
    }
  }

  const participantStatus = BETA_PARTICIPANT_STATUSES.has(nextStatus) ? nextStatus : null;
  if (participantStatus && (statusChanged || !current.participant)) {
    const participant = current.participant || null;
    const participantBody = {
      cohort: cleanText(payload.cohort || participant?.cohort || 'founders-2026', 80),
      status: participantStatus,
      updated_at: now
    };
    if (participantStatus === 'active' || ['completed', 'converted', 'closed'].includes(participantStatus)) {
      participantBody.activated_at = participant?.activated_at || now;
      participantBody.beta_ends_at = participant?.beta_ends_at || addDays(participantBody.activated_at, BETA_DURATION_DAYS);
    }
    if (participant?.id) {
      await supabase(`/rest/v1/beta_participants?id=eq.${encodeURIComponent(participant.id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: participantBody });
    } else {
      await supabase('/rest/v1/beta_participants', { method: 'POST', headers: { Prefer: 'return=representation' }, body: { application_id: payload.id, ...participantBody } });
      await supabase('/rest/v1/beta_application_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { application_id: payload.id, event_type: 'participant_created', from_status: current.status, to_status: participantStatus, actor_email: context.user.email } });
    }
  }

  if (statusChanged || note || assignmentChanged) {
    await auditAdminAction(context, 'ADMIN_BETA_APPLICATION_UPDATED', {
      targetType: 'beta_application', targetId: payload.id,
      before: { status: current.status, assignedTo: current.assigned_to || null }, after: { status: nextStatus, assignedTo: nextAssignedTo }, reason: note
    });
  }

  return { current, data: updatedApplication, status: nextStatus, statusChanged, assignmentChanged };
}
