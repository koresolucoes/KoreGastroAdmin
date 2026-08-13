import { assert, assertEnum, assertUuid, auditAdminAction, cleanText, supabase } from './admin.js';

export const BETA_STATUSES = ['new','review','contact','interview','approved','onboarding','active','completed','converted','closed'];
export const BETA_PARTICIPANT_STATUSES = new Set(['onboarding', 'active', 'completed', 'converted', 'closed']);
export const BETA_DURATION_DAYS = 90;

export const BETA_STATUS_LABELS = Object.freeze({
  new: 'Nova',
  review: 'Em análise',
  contact: 'Contato',
  interview: 'Entrevista',
  approved: 'Aprovada',
  onboarding: 'Onboarding',
  active: 'Beta ativo',
  completed: 'Concluída',
  converted: 'Convertida',
  closed: 'Encerrada'
});

// Estados anteriores ao onboarding aceitam somente avanço ou correção para a
// etapa adjacente. Depois que o participante é criado, o ciclo é estritamente
// progressivo para não reiniciar datas nem desfazer uma conversão por engano.
export const BETA_TRANSITIONS = Object.freeze({
  new: Object.freeze(['review', 'closed']),
  review: Object.freeze(['new', 'contact', 'closed']),
  contact: Object.freeze(['review', 'interview', 'closed']),
  interview: Object.freeze(['contact', 'approved', 'closed']),
  approved: Object.freeze(['interview', 'onboarding', 'closed']),
  onboarding: Object.freeze(['active', 'closed']),
  active: Object.freeze(['completed', 'closed']),
  completed: Object.freeze(['converted', 'closed']),
  converted: Object.freeze([]),
  closed: Object.freeze([])
});

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(date, days) {
  return new Date(new Date(date).getTime() + days * DAY_MS).toISOString();
}

function statusLabel(status) {
  return BETA_STATUS_LABELS[status] || status;
}

export function allowedBetaTransitions(status) {
  assertEnum(status, BETA_STATUSES, 'status atual');
  return [...BETA_TRANSITIONS[status]];
}

export function assertBetaTransition(currentStatus, nextStatus) {
  assertEnum(currentStatus, BETA_STATUSES, 'status atual');
  assertEnum(nextStatus, BETA_STATUSES, 'novo status');
  if (currentStatus === nextStatus) return;
  const allowed = allowedBetaTransitions(currentStatus);
  const alternatives = allowed.length
    ? allowed.map((status) => `“${statusLabel(status)}”`).join(', ')
    : 'nenhuma outra etapa';
  assert(
    allowed.includes(nextStatus),
    `Não é possível mover a candidatura de “${statusLabel(currentStatus)}” para “${statusLabel(nextStatus)}”. A partir de “${statusLabel(currentStatus)}”, use ${alternatives}.`,
    409
  );
}

export function assertBetaTransitionNote(currentStatus, nextStatus, note, options = {}) {
  const statusChanged = currentStatus !== nextStatus;
  if (options.requireNote || statusChanged) {
    assert(cleanText(note, 1000), 'Registre uma observação sobre o contato ou a decisão antes de mudar a etapa.', 400);
  }
}

export function assertBetaExpectedUpdatedAt(currentUpdatedAt, expectedUpdatedAt) {
  if (expectedUpdatedAt === undefined || expectedUpdatedAt === null || expectedUpdatedAt === '') return;
  const expectedTime = new Date(expectedUpdatedAt).getTime();
  assert(Number.isFinite(expectedTime), 'A versão informada para a candidatura é inválida. Atualize a tela e tente novamente.', 400);
  const currentTime = new Date(currentUpdatedAt).getTime();
  assert(
    Number.isFinite(currentTime) && currentTime === expectedTime,
    'Esta candidatura foi atualizada por outra sessão. Recarregue os dados antes de salvar novamente.',
    409
  );
}

export function buildBetaParticipantChange({ currentStatus, nextStatus, participant, cohort, now }) {
  const timestamp = new Date(now).toISOString();
  const selectedCohort = cleanText(cohort || participant?.cohort || 'founders-2026', 80);

  if (nextStatus === 'onboarding') {
    assert(
      !participant?.id || participant.status === 'onboarding',
      'O participante já avançou além do onboarding. Recarregue a candidatura antes de continuar.',
      409
    );
    if (currentStatus === nextStatus && participant?.id && selectedCohort === participant.cohort) return null;
    return {
      create: !participant?.id,
      body: { cohort: selectedCohort, status: 'onboarding', updated_at: timestamp }
    };
  }

  if (nextStatus === 'active') {
    assert(participant?.id, 'Crie o participante e conclua o onboarding antes de iniciar os 90 dias do beta.', 409);
    if (currentStatus === nextStatus && participant.status === 'active' && participant.activated_at && participant.beta_ends_at && selectedCohort === participant.cohort) return null;
    const recoveringActiveState = currentStatus === 'active';
    const activatedAt = recoveringActiveState ? (participant.activated_at || timestamp) : timestamp;
    return {
      create: false,
      body: {
        cohort: selectedCohort,
        status: 'active',
        activated_at: activatedAt,
        beta_ends_at: recoveringActiveState && participant.beta_ends_at
          ? participant.beta_ends_at
          : addDays(activatedAt, BETA_DURATION_DAYS),
        updated_at: timestamp
      }
    };
  }

  if (['completed', 'converted'].includes(nextStatus)) {
    assert(participant?.id, 'O ciclo do beta não possui um participante vinculado. Corrija o onboarding antes de continuar.', 409);
    assert(participant.activated_at, 'O participante ainda não foi ativado. Inicie o beta antes de concluir ou converter.', 409);
    if (currentStatus === nextStatus && participant.status === nextStatus && participant.beta_ends_at && selectedCohort === participant.cohort) return null;
    return {
      create: false,
      body: {
        cohort: selectedCohort,
        status: nextStatus,
        activated_at: participant.activated_at,
        beta_ends_at: participant.beta_ends_at || addDays(participant.activated_at, BETA_DURATION_DAYS),
        updated_at: timestamp
      }
    };
  }

  // Encerrar uma candidatura antes do onboarding não deve criar um participante.
  // Quando o participante já existe, seu estado acompanha o encerramento sem
  // inventar uma data de ativação.
  if (nextStatus === 'closed' && participant?.id) {
    if (currentStatus === nextStatus && participant.status === 'closed' && selectedCohort === participant.cohort) return null;
    return {
      create: false,
      body: {
        cohort: selectedCohort,
        status: 'closed',
        ...(participant.activated_at ? { activated_at: participant.activated_at } : {}),
        ...(participant.beta_ends_at ? { beta_ends_at: participant.beta_ends_at } : {}),
        updated_at: timestamp
      }
    };
  }

  return null;
}

export async function updateBetaApplication(context, payload, options = {}) {
  assertUuid(payload.id, 'candidatura');
  const before = await supabase(`/rest/v1/beta_applications?select=*,participant:beta_participants(id,status,cohort,activated_at,beta_ends_at)&id=eq.${encodeURIComponent(payload.id)}&limit=1`);
  assert(before.data?.[0], 'Candidatura não encontrada.', 404);
  const current = before.data[0];
  const nextStatus = cleanText(payload.status ?? current.status, 30);
  assertEnum(nextStatus, BETA_STATUSES, 'status');
  assertBetaExpectedUpdatedAt(current.updated_at, options.expectedUpdatedAt ?? payload.expectedUpdatedAt);
  assertBetaTransition(current.status, nextStatus);

  const note = cleanText(payload.note, 1000) || null;
  const statusChanged = nextStatus !== current.status;
  const assignmentProvided = Object.hasOwn(payload, 'assignedTo');
  const nextAssignedTo = assignmentProvided
    ? (cleanText(payload.assignedTo, 254) || null)
    : (current.assigned_to || context.user.email);
  const assignmentChanged = nextAssignedTo !== (current.assigned_to || null);
  assertBetaTransitionNote(current.status, nextStatus, note, options);

  const now = new Date().toISOString();
  // Planejar e validar a sincronização antes de alterar a candidatura evita
  // gravar "active" ou "converted" quando o participante necessário não existe.
  const participantChange = buildBetaParticipantChange({
    currentStatus: current.status,
    nextStatus,
    participant: current.participant || null,
    cohort: payload.cohort,
    now
  });
  let updatedApplication = current;
  if (statusChanged || note || assignmentChanged) {
    const versionFilter = current.updated_at ? `&updated_at=eq.${encodeURIComponent(current.updated_at)}` : '';
    const updated = await supabase(`/rest/v1/beta_applications?id=eq.${encodeURIComponent(payload.id)}${versionFilter}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: { status: nextStatus, notes: note ?? current.notes, assigned_to: nextAssignedTo, updated_at: now }
    });
    assert(updated.data?.[0], 'Esta candidatura foi atualizada por outra sessão. Recarregue os dados antes de salvar novamente.', 409);
    updatedApplication = updated.data[0];
    if (statusChanged || note) {
      await supabase('/rest/v1/beta_application_events', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: { application_id: payload.id, event_type: statusChanged ? 'status_changed' : 'note_added', from_status: current.status, to_status: nextStatus, actor_email: context.user.email, note }
      });
    }
  }

  if (participantChange) {
    const participant = current.participant || null;
    if (participantChange.create) {
      const created = await supabase('/rest/v1/beta_participants', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: { application_id: payload.id, ...participantChange.body }
      });
      const createdParticipant = created.data?.[0];
      assert(createdParticipant, 'Não foi possível criar o participante do beta.', 502);
      await supabase('/rest/v1/beta_application_events', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: { application_id: payload.id, event_type: 'participant_created', from_status: current.status, to_status: nextStatus, actor_email: context.user.email }
      });
      await auditAdminAction(context, 'ADMIN_BETA_PARTICIPANT_CREATED', {
        targetType: 'beta_application', targetId: payload.id, participantId: createdParticipant.id,
        before: { status: current.status }, after: { status: nextStatus }, reason: note
      });
    } else {
      await supabase(`/rest/v1/beta_participants?id=eq.${encodeURIComponent(participant.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: participantChange.body
      });
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
