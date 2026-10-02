import { assert, assertEnum, assertUuid, cleanText, hasCapability, supabase, supabaseAuthAdmin } from './admin.js';

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
  const before = await supabase(`/rest/v1/beta_applications?select=*,participant:beta_participants(id,status,cohort,activated_at,beta_ends_at,store_id,subscription_id)&id=eq.${encodeURIComponent(payload.id)}&limit=1`);
  assert(before.data?.[0], 'Candidatura não encontrada.', 404);
  const current = before.data[0];
  const nextStatus = cleanText(payload.status ?? current.status, 30);
  assertEnum(nextStatus, BETA_STATUSES, 'status');
  assertBetaExpectedUpdatedAt(current.updated_at, options.expectedUpdatedAt ?? payload.expectedUpdatedAt);
  assertBetaTransition(current.status, nextStatus);
  const note = cleanText(payload.note, 1000) || null;
  assertBetaTransitionNote(current.status, nextStatus, note, options);
  const assignmentProvided = Object.hasOwn(payload, 'assignedTo');
  const nextAssignedTo = assignmentProvided ? (cleanText(payload.assignedTo, 254) || null) : (current.assigned_to || context.user.email);
  let storeId = null;
  if (payload.storeId) {
    assert(hasCapability(context, 'onboarding.manage'), 'Você não possui permissão para vincular a operação.', 403);
    assertUuid(payload.storeId, 'operação');
    const store = (await supabase(`/rest/v1/stores?select=id,owner_id&id=eq.${encodeURIComponent(payload.storeId)}&limit=1`)).data?.[0];
    assert(store, 'Operação não encontrada.', 404);
    const owner = (await supabaseAuthAdmin(`/admin/users/${store.owner_id}`)).data;
    assert(String(owner?.email || '').toLowerCase() === String(current.email).toLowerCase(), 'A conta da operação deve usar o e-mail da candidatura.', 409);
    storeId = store.id;
  }
  if (nextStatus === 'active' && current.status !== 'active') {
    const linkedStoreId = storeId || current.participant?.store_id;
    assertUuid(linkedStoreId, 'operação vinculada ao beta');
    const subscription = (await supabase(`/rest/v1/subscriptions?select=id,plan_id,mercado_pago_subscription_id&user_id=eq.${encodeURIComponent(linkedStoreId)}&limit=1`)).data?.[0];
    assert(subscription && !subscription.mercado_pago_subscription_id, 'Prepare uma assinatura sem recorrência para ativar o beta gratuito.', 409);
    const plan = (await supabase(`/rest/v1/plans?select=id,price&id=eq.${encodeURIComponent(subscription.plan_id)}&limit=1`)).data?.[0];
    assert(plan && Number(plan.price) === 0, 'Selecione um plano gratuito antes de ativar o beta.', 409);
  }
  const result = await supabase('/rest/v1/rpc/update_beta_application_atomic', { method: 'POST', body: {
    p_id: current.id, p_expected_updated_at: current.updated_at, p_status: nextStatus, p_note: note,
    p_assigned_to: nextAssignedTo, p_assignment_provided: assignmentProvided, p_cohort: cleanText(payload.cohort, 80) || null,
    p_actor_user_id: context.user.id, p_actor_email: context.user.email, p_store_id: storeId
  } }).catch(error => {
    if (['40001','22023','23505'].includes(error?.details?.code)) error.status = 409;
    throw error;
  });
  return { current, data: result.data, status: nextStatus, statusChanged: nextStatus !== current.status, assignmentChanged: nextAssignedTo !== current.assigned_to };
}
