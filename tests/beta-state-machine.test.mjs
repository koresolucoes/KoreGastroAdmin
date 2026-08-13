import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BETA_TRANSITIONS,
  allowedBetaTransitions,
  assertBetaExpectedUpdatedAt,
  assertBetaTransition,
  assertBetaTransitionNote,
  buildBetaParticipantChange
} from '../api/_lib/beta-operations.js';

function captureError(action) {
  try {
    action();
  } catch (error) {
    return error;
  }
  assert.fail('Era esperado que a operação fosse bloqueada.');
}

test('expõe uma matriz de estados explícita e terminal', () => {
  assert.deepEqual(BETA_TRANSITIONS, {
    new: ['review', 'closed'],
    review: ['new', 'contact', 'closed'],
    contact: ['review', 'interview', 'closed'],
    interview: ['contact', 'approved', 'closed'],
    approved: ['interview', 'onboarding', 'closed'],
    onboarding: ['active', 'closed'],
    active: ['completed', 'closed'],
    completed: ['converted', 'closed'],
    converted: [],
    closed: []
  });
  assert.deepEqual(allowedBetaTransitions('approved'), ['interview', 'onboarding', 'closed']);
});

test('permite avanço adjacente, correção adjacente da seleção e encerramento explícito', () => {
  for (const [from, targets] of Object.entries(BETA_TRANSITIONS)) {
    assert.doesNotThrow(() => assertBetaTransition(from, from));
    for (const to of targets) assert.doesNotThrow(() => assertBetaTransition(from, to));
  }
});

test('bloqueia saltos que contornariam análise, onboarding, ativação ou conclusão', () => {
  const blocked = [
    ['new', 'contact'], ['new', 'approved'], ['new', 'active'],
    ['review', 'approved'], ['contact', 'onboarding'], ['interview', 'active'],
    ['approved', 'active'], ['approved', 'converted'],
    ['onboarding', 'completed'], ['onboarding', 'converted'],
    ['active', 'converted'], ['completed', 'active'],
    ['converted', 'active'], ['converted', 'closed'], ['closed', 'new']
  ];
  for (const [from, to] of blocked) {
    const error = captureError(() => assertBetaTransition(from, to));
    assert.equal(error.status, 409, `${from} -> ${to}`);
    assert.match(error.message, /Não é possível mover/);
  }
});

test('exige observação em toda mudança de etapa e quando o fluxo solicitar explicitamente', () => {
  const changed = captureError(() => assertBetaTransitionNote('review', 'contact', ''));
  assert.equal(changed.status, 400);
  assert.match(changed.message, /Registre uma observação/);

  assert.doesNotThrow(() => assertBetaTransitionNote('review', 'contact', 'Contato confirmado.'));
  assert.doesNotThrow(() => assertBetaTransitionNote('review', 'review', ''));

  const required = captureError(() => assertBetaTransitionNote('review', 'review', '', { requireNote: true }));
  assert.equal(required.status, 400);
});

test('detecta edição concorrente com HTTP 409 e aceita instantes ISO equivalentes', () => {
  assert.doesNotThrow(() => assertBetaExpectedUpdatedAt('2026-08-13T12:00:00.000Z', undefined));
  assert.doesNotThrow(() => assertBetaExpectedUpdatedAt('2026-08-13T12:00:00.000Z', '2026-08-13T09:00:00-03:00'));

  const conflict = captureError(() => assertBetaExpectedUpdatedAt('2026-08-13T12:00:01.000Z', '2026-08-13T12:00:00.000Z'));
  assert.equal(conflict.status, 409);
  assert.match(conflict.message, /outra sessão/);

  const invalid = captureError(() => assertBetaExpectedUpdatedAt('2026-08-13T12:00:00.000Z', 'ontem'));
  assert.equal(invalid.status, 400);
});

test('cria participante em onboarding sem iniciar o relógio do beta', () => {
  const change = buildBetaParticipantChange({
    currentStatus: 'approved',
    nextStatus: 'onboarding',
    participant: null,
    cohort: 'founders-2026',
    now: '2026-08-13T12:00:00.000Z'
  });
  assert.equal(change.create, true);
  assert.equal(change.body.status, 'onboarding');
  assert.equal(change.body.activated_at, undefined);
  assert.equal(change.body.beta_ends_at, undefined);

  const recovery = buildBetaParticipantChange({
    currentStatus: 'onboarding',
    nextStatus: 'onboarding',
    participant: null,
    cohort: 'founders-2026',
    now: '2026-08-13T12:00:00.000Z'
  });
  assert.equal(recovery.create, true);
  assert.equal(recovery.body.activated_at, undefined);

  const invalidDowngrade = captureError(() => buildBetaParticipantChange({
    currentStatus: 'onboarding',
    nextStatus: 'onboarding',
    participant: { id: 'participant-1', status: 'active', activated_at: '2026-08-13T12:00:00.000Z' },
    now: '2026-08-13T12:00:00.000Z'
  }));
  assert.equal(invalidDowngrade.status, 409);
});

test('somente onboarding -> active inicia uma vez o ciclo de 90 dias', () => {
  const missingParticipant = captureError(() => buildBetaParticipantChange({
    currentStatus: 'onboarding', nextStatus: 'active', participant: null, now: '2026-08-13T12:00:00.000Z'
  }));
  assert.equal(missingParticipant.status, 409);

  const change = buildBetaParticipantChange({
    currentStatus: 'onboarding',
    nextStatus: 'active',
    participant: { id: 'participant-1', status: 'onboarding', cohort: 'founders-2026' },
    now: '2026-08-13T12:00:00.000Z'
  });
  assert.equal(change.create, false);
  assert.equal(change.body.status, 'active');
  assert.equal(change.body.activated_at, '2026-08-13T12:00:00.000Z');
  assert.equal(change.body.beta_ends_at, '2026-11-11T12:00:00.000Z');

  const staleDatesAreRestartedOnTheRealActivation = buildBetaParticipantChange({
    currentStatus: 'onboarding',
    nextStatus: 'active',
    participant: {
      id: 'participant-1', status: 'onboarding', cohort: 'founders-2026',
      activated_at: '2026-08-01T12:00:00.000Z', beta_ends_at: '2026-10-30T12:00:00.000Z'
    },
    now: '2026-08-13T12:00:00.000Z'
  });
  assert.equal(staleDatesAreRestartedOnTheRealActivation.body.activated_at, '2026-08-13T12:00:00.000Z');
  assert.equal(staleDatesAreRestartedOnTheRealActivation.body.beta_ends_at, '2026-11-11T12:00:00.000Z');

  const recovery = buildBetaParticipantChange({
    currentStatus: 'active',
    nextStatus: 'active',
    participant: { id: 'participant-1', status: 'onboarding', cohort: 'founders-2026' },
    now: '2026-08-13T12:00:00.000Z'
  });
  assert.equal(recovery.body.status, 'active');
  assert.equal(recovery.body.beta_ends_at, '2026-11-11T12:00:00.000Z');
});

test('conclusão e conversão preservam as datas reais; encerramento não inventa ativação', () => {
  const participant = {
    id: 'participant-1', status: 'active', cohort: 'founders-2026',
    activated_at: '2026-08-13T12:00:00.000Z', beta_ends_at: '2026-11-11T12:00:00.000Z'
  };
  const completed = buildBetaParticipantChange({
    currentStatus: 'active', nextStatus: 'completed', participant, now: '2026-11-11T12:00:00.000Z'
  });
  assert.equal(completed.body.status, 'completed');
  assert.equal(completed.body.activated_at, participant.activated_at);
  assert.equal(completed.body.beta_ends_at, participant.beta_ends_at);

  const converted = buildBetaParticipantChange({
    currentStatus: 'completed', nextStatus: 'converted', participant: { ...participant, status: 'completed' }, now: '2026-11-12T12:00:00.000Z'
  });
  assert.equal(converted.body.status, 'converted');
  assert.equal(converted.body.activated_at, participant.activated_at);

  assert.equal(buildBetaParticipantChange({ currentStatus: 'review', nextStatus: 'closed', participant: null, now: '2026-08-13T12:00:00.000Z' }), null);
  const closedOnboarding = buildBetaParticipantChange({
    currentStatus: 'onboarding', nextStatus: 'closed',
    participant: { id: 'participant-2', status: 'onboarding', cohort: 'founders-2026' },
    now: '2026-08-13T12:00:00.000Z'
  });
  assert.equal(closedOnboarding.body.status, 'closed');
  assert.equal(closedOnboarding.body.activated_at, undefined);
  assert.equal(closedOnboarding.body.beta_ends_at, undefined);
});

test('permite atualizar a coorte sem reiniciar o ciclo nem alterar a etapa', () => {
  const active = buildBetaParticipantChange({
    currentStatus: 'active',
    nextStatus: 'active',
    participant: {
      id: 'participant-1', status: 'active', cohort: 'founders-2026',
      activated_at: '2026-08-13T12:00:00.000Z', beta_ends_at: '2026-11-11T12:00:00.000Z'
    },
    cohort: 'founders-2026-b',
    now: '2026-08-14T12:00:00.000Z'
  });
  assert.equal(active.body.cohort, 'founders-2026-b');
  assert.equal(active.body.activated_at, '2026-08-13T12:00:00.000Z');
  assert.equal(active.body.beta_ends_at, '2026-11-11T12:00:00.000Z');
});
