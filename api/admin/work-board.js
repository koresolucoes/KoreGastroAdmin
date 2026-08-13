import {
  assert, assertEnum, assertUuid, auditAdminAction, bodyOf, cleanText, fail,
  hasCapability, requireAdmin, reply, supabase
} from '../_lib/admin.js';
import {
  BETA_STATUSES, BETA_TRANSITIONS, assertBetaExpectedUpdatedAt, updateBetaApplication
} from '../_lib/beta-operations.js';

const SUPPORT_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const ACTIVE_SUPPORT = new Set(['open', 'in_progress']);
const ACTIVE_BETA = new Set(['new', 'review', 'contact', 'interview', 'approved', 'onboarding', 'active']);
const DAY_MS = 24 * 60 * 60 * 1000;

function hoursSince(value) {
  const time = new Date(value || 0).getTime();
  return Number.isFinite(time) ? Math.max(0, Math.floor((Date.now() - time) / 3600000)) : 0;
}

function dueSignals(dueAt) {
  if (!dueAt) return { score: 0, reasons: [] };
  const hours = (new Date(dueAt).getTime() - Date.now()) / 3600000;
  if (hours < 0) return { score: 50, reasons: ['Prazo vencido'] };
  if (hours <= 24) return { score: 30, reasons: ['Prazo nas próximas 24 horas'] };
  if (hours <= 168) return { score: 15, reasons: ['Prazo nesta semana'] };
  return { score: 0, reasons: [] };
}

function radarLane(card) {
  if (card.completed) return 'done';
  if (card.attentionScore >= 80) return 'critical';
  if (card.attentionScore >= 50) return 'today';
  if (card.attentionScore >= 25 || card.dueAt) return 'week';
  return 'waiting';
}

function supportCard(ticket, work, names) {
  const updatedAt = ticket.updated_at || ticket.created_at;
  const waitingHours = hoursSince(updatedAt);
  const reasons = [];
  let score = 0;
  if (ticket.priority === 'Urgente') { score += 50; reasons.push('Prioridade urgente'); }
  else if (ticket.priority === 'Alta') { score += 30; reasons.push('Prioridade alta'); }
  if (ACTIVE_SUPPORT.has(ticket.status) && waitingHours >= 24) { score += 40; reasons.push(`Sem atualização há ${waitingHours} horas`); }
  else if (ACTIVE_SUPPORT.has(ticket.status) && waitingHours >= 8) { score += 20; reasons.push(`Aguardando há ${waitingHours} horas`); }
  if (ticket.status === 'open') { score += 10; reasons.push('Ainda não iniciado'); }
  const due = dueSignals(work?.due_at);
  score += due.score; reasons.push(...due.reasons);
  if (!work?.assigned_to && ACTIVE_SUPPORT.has(ticket.status)) { score += 10; reasons.push('Sem responsável'); }
  const messages = [...(ticket.messages || [])].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const card = {
    key: `support:${ticket.id}`, source: 'support', sourceId: ticket.id,
    title: ticket.subject || 'Chamado sem assunto', subtitle: names.get(ticket.client_id) || ticket.store_name || 'Cliente',
    detail: messages.at(-1)?.text || ticket.store_name || 'Aguardando atendimento', status: ticket.status,
    nativeLane: ticket.status, priority: ticket.priority || 'Média', assignedTo: work?.assigned_to || null,
    dueAt: work?.due_at || null, position: Number(work?.board_position || 1024), updatedAt, sourceUpdatedAt: ticket.updated_at, workUpdatedAt: work?.updated_at || null,
    attentionScore: Math.min(100, score), reasons, completed: !ACTIVE_SUPPORT.has(ticket.status),
    metadata: { waitingHours, messageCount: messages.length }
  };
  card.radarLane = radarLane(card);
  return card;
}

function betaLane(status) {
  if (['new', 'review'].includes(status)) return 'intake';
  if (['contact', 'interview'].includes(status)) return 'contact';
  if (status === 'approved') return 'selection';
  if (status === 'onboarding') return 'onboarding';
  if (status === 'active') return 'active';
  return 'done';
}

function betaCard(application, work) {
  const events = [...(application.events || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const updatedAt = events[0]?.created_at || application.updated_at || application.submitted_at;
  const staleHours = hoursSince(updatedAt);
  const reasons = [];
  let score = 0;
  if (['new', 'review'].includes(application.status) && hoursSince(application.submitted_at) >= 24) { score += 25; reasons.push('Candidatura aguardando triagem'); }
  if (ACTIVE_BETA.has(application.status) && staleHours >= 72) { score += 40; reasons.push(`Sem movimentação há ${Math.floor(staleHours / 24)} dias`); }
  if (application.status === 'approved' && !application.participant) { score += 50; reasons.push('Aprovado sem participante criado'); }
  if (application.status === 'onboarding') { score += 20; reasons.push('Onboarding ainda não concluído'); }
  if (application.status === 'active' && application.participant?.beta_ends_at) {
    const remaining = Math.ceil((new Date(application.participant.beta_ends_at).getTime() - Date.now()) / DAY_MS);
    if (remaining <= 7) { score += 50; reasons.push(`${Math.max(0, remaining)} dias para o fim do beta`); }
    else if (remaining <= 21) { score += 30; reasons.push(`${remaining} dias para o fim do beta`); }
  }
  const due = dueSignals(work?.due_at);
  score += due.score; reasons.push(...due.reasons);
  if (!(work?.assigned_to || application.assigned_to) && ACTIVE_BETA.has(application.status)) { score += 10; reasons.push('Sem responsável'); }
  const card = {
    key: `beta:${application.id}`, source: 'beta', sourceId: application.id,
    title: application.restaurant_name, subtitle: application.name,
    detail: events[0]?.note || application.establishment_type || application.restaurant_size || 'Candidatura do programa',
    status: application.status, nativeLane: betaLane(application.status), priority: score >= 80 ? 'Crítica' : score >= 50 ? 'Alta' : 'Normal',
    assignedTo: work?.assigned_to || application.assigned_to || null, dueAt: work?.due_at || null,
    position: Number(work?.board_position || 1024), updatedAt, sourceUpdatedAt: application.updated_at, workUpdatedAt: work?.updated_at || null, attentionScore: Math.min(100, score), reasons,
    completed: !ACTIVE_BETA.has(application.status), metadata: { eventCount: events.length, participant: application.participant || null }
  };
  card.radarLane = radarLane(card);
  return card;
}

function stateBySource(rows) {
  const support = new Map();
  const beta = new Map();
  for (const row of rows || []) {
    if (row.support_ticket_id) support.set(row.support_ticket_id, row);
    if (row.beta_application_id) beta.set(row.beta_application_id, row);
  }
  return { support, beta };
}

async function loadBoard(context) {
  const canSupport = hasCapability(context, 'support.read');
  const canBeta = hasCapability(context, 'beta.read');
  const [ticketsResult, betaResult, workResult] = await Promise.all([
    canSupport ? supabase('/rest/v1/support_tickets?select=id,client_id,store_name,subject,priority,status,created_at,updated_at,messages:support_ticket_messages(text,sender_type,created_at)&order=updated_at.desc&limit=250') : Promise.resolve({ data: [] }),
    canBeta ? supabase('/rest/v1/beta_applications?select=id,name,restaurant_name,establishment_type,restaurant_size,status,assigned_to,submitted_at,updated_at,events:beta_application_events(note,to_status,created_at),participant:beta_participants(id,status,cohort,activated_at,beta_ends_at)&order=updated_at.desc&limit=250') : Promise.resolve({ data: [] }),
    supabase('/rest/v1/admin_work_items?select=id,support_ticket_id,beta_application_id,assigned_to,due_at,board_position,updated_at&limit=1000')
  ]);
  const tickets = ticketsResult.data || [];
  const clientIds = [...new Set(tickets.map((ticket) => ticket.client_id).filter(Boolean))];
  const profiles = clientIds.length ? (await supabase(`/rest/v1/profiles?select=id,full_name&id=in.(${clientIds.map(encodeURIComponent).join(',')})`)).data || [] : [];
  const names = new Map(profiles.map((profile) => [profile.id, profile.full_name]));
  const work = stateBySource(workResult.data || []);
  const cards = [
    ...tickets.map((ticket) => supportCard(ticket, work.support.get(ticket.id), names)),
    ...(betaResult.data || []).map((application) => betaCard(application, work.beta.get(application.id)))
  ].sort((a, b) => b.attentionScore - a.attentionScore || new Date(a.dueAt || '9999-12-31') - new Date(b.dueAt || '9999-12-31') || a.position - b.position);
  return {
    cards,
    meta: {
      availableBoards: [canSupport ? 'support' : null, canBeta ? 'beta' : null].filter(Boolean),
      betaTransitions: canBeta ? BETA_TRANSITIONS : undefined,
      currentUser: context.user.email,
      summary: {
        total: cards.length,
        active: cards.filter((card) => !card.completed).length,
        critical: cards.filter((card) => !card.completed && card.radarLane === 'critical').length,
        unassigned: cards.filter((card) => !card.completed && !card.assignedTo).length,
        dueToday: cards.filter((card) => !card.completed && card.radarLane === 'today').length
      }
    }
  };
}

function parseDueAt(value) {
  if (value === null || value === '') return null;
  const date = new Date(value);
  assert(!Number.isNaN(date.getTime()), 'Prazo inválido.');
  return date.toISOString();
}

async function saveWorkState(source, id, payload) {
  const conflict = source === 'support' ? 'support_ticket_id' : 'beta_application_id';
  const body = {
    [conflict]: id,
    updated_at: new Date().toISOString()
  };
  if (Object.hasOwn(payload, 'assignedTo')) body.assigned_to = cleanText(payload.assignedTo, 254) || null;
  if (Object.hasOwn(payload, 'dueAt')) body.due_at = parseDueAt(payload.dueAt);
  if (Object.hasOwn(payload, 'position')) {
    const position = Number(payload.position);
    assert(Number.isSafeInteger(position) && position >= 0, 'Posição inválida.');
    body.board_position = position;
  }
  if (Object.keys(body).length === 2) return null;
  if (payload.expectedWorkUpdatedAt) {
    const result = await supabase(`/rest/v1/admin_work_items?${conflict}=eq.${encodeURIComponent(id)}&updated_at=eq.${encodeURIComponent(payload.expectedWorkUpdatedAt)}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body
    });
    assert(result.data?.[0], 'A organização deste card foi atualizada por outra sessão. Recarregue o quadro.', 409);
    return result.data[0];
  }
  const existing = await supabase(`/rest/v1/admin_work_items?select=id,updated_at&${conflict}=eq.${encodeURIComponent(id)}&limit=1`);
  assert(!existing.data?.[0], 'A organização deste card foi atualizada por outra sessão. Recarregue o quadro.', 409);
  const result = await supabase('/rest/v1/admin_work_items', {
    method: 'POST', headers: { Prefer: 'return=representation' }, body
  });
  assert(result.data?.[0], 'Não foi possível salvar a organização do card.', 502);
  return result.data[0];
}

export default async function handler(req, res) {
  const context = await requireAdmin(req, res, 'GET, PATCH, OPTIONS');
  if (!context) return;
  try {
    if (req.method === 'GET') return reply(res, 200, await loadBoard(context));
    if (req.method !== 'PATCH') return reply(res, 405, { error: 'Método não permitido.' });

    const payload = await bodyOf(req);
    const source = cleanText(payload.source, 20);
    assertEnum(source, ['support', 'beta'], 'origem');
    assertUuid(payload.id, 'item');
    const capability = source === 'support' ? 'support.manage' : 'beta.manage';
    assert(hasCapability(context, capability), 'Seu perfil não possui permissão para movimentar este item.', 403);
    const note = cleanText(payload.note, 1000) || null;
    let before;
    let after;

    if (source === 'support') {
      const current = await supabase(`/rest/v1/support_tickets?select=id,status,priority,subject,updated_at&id=eq.${encodeURIComponent(payload.id)}&limit=1`);
      assert(current.data?.[0], 'Chamado não encontrado.', 404);
      before = current.data[0];
      if (payload.expectedUpdatedAt) assert(String(before.updated_at) === String(payload.expectedUpdatedAt), 'Este chamado foi atualizado por outra sessão. Recarregue o quadro.', 409);
      const updates = {};
      if (payload.status !== undefined) {
        const status = cleanText(payload.status, 30);
        assertEnum(status, SUPPORT_STATUSES, 'status');
        if (status !== before.status) updates.status = status;
      }
      if (Object.keys(updates).length) {
        updates.updated_at = new Date().toISOString();
        const versionFilter = before.updated_at ? `&updated_at=eq.${encodeURIComponent(before.updated_at)}` : '';
        const result = await supabase(`/rest/v1/support_tickets?id=eq.${encodeURIComponent(payload.id)}${versionFilter}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: updates });
        assert(result.data?.[0], 'Este chamado foi atualizado por outra sessão. Recarregue o quadro.', 409);
        after = result.data[0];
      } else after = before;
    } else {
      const current = await supabase(`/rest/v1/beta_applications?select=id,status,updated_at&id=eq.${encodeURIComponent(payload.id)}&limit=1`);
      assert(current.data?.[0], 'Candidatura não encontrada.', 404);
      before = current.data[0];
      assertBetaExpectedUpdatedAt(before.updated_at, payload.expectedUpdatedAt);
      const nextStatus = payload.status === undefined ? before.status : cleanText(payload.status, 30);
      assertEnum(nextStatus, BETA_STATUSES, 'status');
      if (nextStatus !== before.status || note || Object.hasOwn(payload, 'assignedTo')) {
        const betaUpdate = {
          id: payload.id,
          status: nextStatus,
          note,
          cohort: payload.cohort,
          expectedUpdatedAt: payload.expectedUpdatedAt
        };
        if (Object.hasOwn(payload, 'assignedTo')) betaUpdate.assignedTo = payload.assignedTo;
        const result = await updateBetaApplication(context, betaUpdate);
        after = result.data;
      } else after = before;
    }

    const workState = await saveWorkState(source, payload.id, payload);
    await auditAdminAction(context, source === 'support' ? 'ADMIN_SUPPORT_WORK_ITEM_UPDATED' : 'ADMIN_BETA_WORK_ITEM_UPDATED', {
      targetType: source === 'support' ? 'support_ticket' : 'beta_application', targetId: payload.id,
      before: { status: before.status }, after: { status: after.status, assignedTo: workState?.assigned_to, dueAt: workState?.due_at, position: workState?.board_position }, reason: note
    });
    return reply(res, 200, { data: { source, id: payload.id, status: after.status, workState } });
  } catch (error) {
    return fail(res, error);
  }
}
