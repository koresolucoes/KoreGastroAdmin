(() => {
  'use strict';

  const config = window.KORE_ADMIN_CONFIG || {};
  const app = document.querySelector('#app');
  const authHash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const inviteToken = authHash.get('type') === 'invite' ? authHash.get('access_token') : '';
  const ROUTE_PATHS = Object.freeze({
    overview: 'inicio', mywork: 'minha-fila', workboard: 'kanban', tenants: 'clientes', support: 'suporte',
    beta: 'beta', subscriptions: 'assinaturas', plans: 'planos', catalog: 'cardapios',
    administrators: 'equipe', logs: 'auditoria', health: 'saude', provision: 'novo-cliente'
  });
  const PATH_SECTIONS = Object.fromEntries(Object.entries(ROUTE_PATHS).map(([section, path]) => [path, section]));
  const sectionFromLocation = () => PATH_SECTIONS[window.location.hash.match(/^#\/([^?]+)/)?.[1]] || 'overview';
  const state = {
    token: inviteToken || sessionStorage.getItem('koregastro_admin_token') || '',
    inviteMode: Boolean(inviteToken),
    mfaMode: null,
    user: null,
    section: sectionFromLocation(),
    loading: false,
    restoringSession: Boolean(!inviteToken && (inviteToken || sessionStorage.getItem('koregastro_admin_token'))),
    sectionLoading: '',
    sectionError: null,
    pendingAction: '',
    navigationSequence: 0,
    pageDirty: false,
    dashboard: null,
    tenants: [],
    customerSummary: null,
    customerMeta: null,
    plans: [],
    permissionCatalog: [],
    tickets: null,
    ticketSummary: null,
    ticketMeta: null,
    menu: [],
    menuCategories: [],
    menuMeta: null,
    selectedTenant: '',
    selectedStore: '',
    selectedTicketId: '',
    admins: null,
    adminSummary: null,
    adminRoles: [],
    adminMeta: null,
    health: null,
    logs: null,
    betaApplications: null,
    betaSummary: null,
    betaTransitions: null,
    workCards: null,
    workMeta: null,
    workView: 'radar',
    notice: null,
    modal: null,
    modalDirty: false,
    modalReturn: null,
    sidebarOpen: false,
    globalQuery: '',
    filters: {
      customer: '', subscription: '', subscriptionStatus: 'all', ticket: '', ticketStatus: 'active',
      catalog: '', catalogCategory: 'all', catalogStatus: 'all', auditQuery: '', auditCategory: 'all',
      auditOutcome: 'all', auditActor: '', auditFrom: '', auditTo: '', auditPage: 1,
      betaQuery: '', betaStatus: 'all', betaAttention: 'all', workQuery: '', workOwner: 'all'
    }
  };
  let draggedWorkKey = '';
  let searchTimer = 0;

  const navigation = [
    { label: 'Trabalho', items: [
      ['overview', 'Início', '⌂'], ['mywork', 'Minha fila', '✓'], ['workboard', 'Kanban', '▦']
    ] },
    { label: 'Relacionamento', items: [
      ['tenants', 'Clientes', '◫'], ['support', 'Suporte', '✦'], ['beta', 'Programa beta', '★']
    ] },
    { label: 'Receita', items: [
      ['subscriptions', 'Assinaturas', '◎'], ['plans', 'Planos', '◇']
    ] },
    { label: 'Produto', items: [
      ['catalog', 'Cardápios', '≡']
    ] },
    { label: 'Administração', items: [
      ['administrators', 'Equipe e acessos', '⚙'], ['logs', 'Auditoria', '≋'], ['health', 'Saúde do sistema', '♥']
    ] }
  ];
  const sectionLabels = {
    ...Object.fromEntries(navigation.flatMap((group) => group.items.map(([key, label]) => [key, label]))),
    provision: 'Novo cliente'
  };
  const SECTION_CAPABILITIES = Object.freeze({
    overview: ['dashboard.read'], mywork: ['dashboard.read'], workboard: ['dashboard.read'],
    tenants: ['customers.read'], support: ['support.read'], beta: ['beta.read'],
    subscriptions: ['subscriptions.read'], plans: ['plans.read'], catalog: ['catalog.read'],
    provision: ['onboarding.manage'], administrators: ['access.read'], logs: ['audit.read'], health: ['health.read']
  });

  const escape = (value = '') => String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
  const date = (value) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
  const day = (value) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(value)) : '—';
  const shortNumber = (value) => new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value || 0));
  const apiUrl = (path) => `${String(config.apiBaseUrl || '').replace(/\/$/, '')}${path}`;
  const configured = () => Boolean(config.supabaseUrl && config.supabaseAnonKey);
  const planById = (id) => state.plans.find((plan) => String(plan.id) === String(id));
  const permissionDefinitions = () => state.permissionCatalog.flatMap((group) => group.permissions || []);
  const permissionDefinition = (key) => permissionDefinitions().find((permission) => permission.key === key);
  const permissionLabel = (key) => permissionDefinition(key)?.name || 'Acesso adicional';
  const subscriptionOf = (tenant) => tenant?.subscription || tenant?.subscriptions?.[0] || null;
  const initials = (value = '') => value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'C';
  const normalize = (value = '') => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const includes = (haystack, needle) => normalize(haystack).includes(normalize(needle));
  const DAY_MS = 24 * 60 * 60 * 1000;
  const BETA_STAGE_LABELS = { new: 'Nova', review: 'Em análise', contact: 'Contato', interview: 'Entrevista', approved: 'Aprovada', onboarding: 'Onboarding', active: 'Beta ativo', completed: 'Concluída', converted: 'Convertida', closed: 'Encerrada' };
  const BETA_STAGES = Object.keys(BETA_STAGE_LABELS);
  const WORK_SOURCE_LABELS = { support: 'Suporte', beta: 'Programa beta' };
  const SUPPORT_STATUS_LABELS = { open: 'Aberto', in_progress: 'Em atendimento', resolved: 'Resolvido', closed: 'Fechado' };
  const workStatusLabel = (source, value) => (source === 'support' ? SUPPORT_STATUS_LABELS : BETA_STAGE_LABELS)[value] || value;
  const toInputDate = (value) => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toISOString().slice(0, 10) : '';
  const toInputDateTime = (value) => {
    if (!value || Number.isNaN(new Date(value).getTime())) return '';
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  const can = (capability) => Boolean(state.user?.capabilities?.includes('*') || state.user?.capabilities?.includes(capability));
  const canAny = (capabilities = []) => capabilities.some(can);
  const canOpenSection = (section) => !state.user || canAny(SECTION_CAPABILITIES[section] || []);
  const betaTransitionMap = () => state.betaTransitions || state.workMeta?.betaTransitions || {};
  const betaAllowedStatuses = (currentStatus) => [...new Set([
    currentStatus,
    ...(betaTransitionMap()[currentStatus] || [])
  ])].filter((status) => BETA_STAGES.includes(status));
  const roleLabel = (role) => ({ owner: 'Proprietário', platform_admin: 'Administrador', finance: 'Financeiro', support: 'Suporte', auditor: 'Auditor' }[role] || role || 'Administrador');
  const accessStatusLabel = (value) => ({ invited: 'Convite pendente', active: 'Ativo', suspended: 'Suspenso', revoked: 'Revogado' }[value] || value || 'Desconhecido');
  const healthStatusLabel = (value) => ({ ok: 'Operacional', attention: 'Atenção', degraded: 'Degradado', critical: 'Crítico', unknown: 'Desconhecido', healthy: 'Operacional' }[value] || value);
  const auditOutcomeLabel = (value) => ({ success: 'Sucesso', failure: 'Falha', blocked: 'Bloqueado' }[value] || value || 'Sucesso');
  const prettyJson = (value) => value ? JSON.stringify(value, null, 2) : '';

  function randomPassword() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
    const bytes = new Uint32Array(32);
    window.crypto.getRandomValues(bytes);
    const password = ['A', 'a', '2', '!', ...Array.from(bytes.slice(0, 14), (value) => alphabet[value % alphabet.length])];
    for (let index = password.length - 1; index > 0; index -= 1) {
      const swap = bytes[index] % (index + 1);
      [password[index], password[swap]] = [password[swap], password[index]];
    }
    return password.join('');
  }

  function updatePermissionSummary(form) {
    if (!form) return;
    const checkboxes = [...form.querySelectorAll('input[type="checkbox"][name="permissions"]')];
    const legacyCount = form.querySelectorAll('input[type="hidden"][name="permissions"]').length;
    const selectedCount = checkboxes.filter((checkbox) => checkbox.checked).length + legacyCount;
    const count = form.querySelector('[data-permission-count]');
    if (count) count.textContent = `${selectedCount} módulo(s) selecionado(s)`;
    form.querySelectorAll('[data-permission-group]').forEach((group) => {
      const groupCheckboxes = [...group.querySelectorAll('input[name="permissions"]')];
      const button = group.querySelector('[data-action="toggle-permission-group"]');
      const groupCount = group.querySelector('[data-permission-group-count]');
      if (groupCount) groupCount.textContent = `${groupCheckboxes.filter((checkbox) => checkbox.checked).length}/${groupCheckboxes.length}`;
      if (button) button.textContent = groupCheckboxes.length && groupCheckboxes.every((checkbox) => checkbox.checked) ? 'Desmarcar grupo' : 'Selecionar grupo';
    });
  }

  function filterPermissionOptions(input) {
    const form = input.closest('form');
    const query = normalize(input.value);
    let visible = 0;
    form?.querySelectorAll('.permission-option').forEach((option) => {
      const matches = !query || normalize(option.dataset.permissionText).includes(query);
      option.hidden = !matches;
      if (matches) visible += 1;
    });
    form?.querySelectorAll('[data-permission-group]').forEach((group) => {
      group.hidden = !group.querySelector('.permission-option:not([hidden])');
    });
    const empty = form?.querySelector('[data-permission-empty]');
    if (empty) empty.hidden = visible > 0;
  }

  function relative(value) {
    if (!value) return 'sem registro';
    const diff = new Date(value).getTime() - Date.now();
    const abs = Math.abs(diff);
    const formatter = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
    if (abs < 3600000) return formatter.format(Math.round(diff / 60000), 'minute');
    if (abs < 86400000) return formatter.format(Math.round(diff / 3600000), 'hour');
    return formatter.format(Math.round(diff / 86400000), 'day');
  }

  function status(value) {
    const labels = {
      active: 'Ativa', trialing: 'Em teste', past_due: 'Inadimplente', canceled: 'Cancelada', unpaid: 'Não paga',
      open: 'Aberto', in_progress: 'Em atendimento', resolved: 'Resolvido', closed: 'Fechado', unknown: 'Sem status'
    };
    const safe = value || 'unknown';
    return `<span class="status status-${escape(safe)}"><i></i>${labels[safe] || escape(safe)}</span>`;
  }

  function entitlement(subscription) {
    if (!subscription) return '<span class="health-signal neutral"><i></i>Sem assinatura</span>';
    if (subscription.periodExpired) return '<span class="health-signal danger"><i></i>Período vencido</span>';
    if (subscription.entitlementActive) return '<span class="health-signal success"><i></i>Acesso vigente</span>';
    return '<span class="health-signal warning"><i></i>Acesso restrito</span>';
  }

  function onboarding(tenant) {
    const missing = tenant?.onboarding?.missing || [];
    if (!missing.length) return '<span class="health-signal success"><i></i>Completo</span>';
    const labels = { store: 'loja', company_profile: 'perfil empresarial', company_data: 'dados fiscais', subscription: 'assinatura' };
    return `<span class="health-signal warning" title="Faltando: ${escape(missing.map((item) => labels[item] || item).join(', '))}"><i></i>${missing.length} pendência(s)</span>`;
  }

  function sla(ticket) {
    if (!ticket || ['resolved', 'closed'].includes(ticket.status)) return '<span class="sla sla-done">Concluído</span>';
    const hours = Number(ticket.waitingHours || 0);
    const label = hours < 1 ? 'Agora' : `${hours}h na fila`;
    return `<span class="sla sla-${escape(ticket.slaState || 'ok')}">${label}</span>`;
  }

  function priority(value) {
    const normalized = normalize(value || 'normal');
    const type = ['urgent', 'urgente'].includes(normalized) ? 'urgent' : ['high', 'alta'].includes(normalized) ? 'high' : 'normal';
    const label = type === 'urgent' ? 'Urgente' : type === 'high' ? 'Alta' : value || 'Normal';
    return `<span class="priority priority-${type}">${escape(label)}</span>`;
  }

  function betaRemainingDays(participant) {
    if (!participant?.beta_ends_at) return null;
    return Math.ceil((new Date(participant.beta_ends_at).getTime() - Date.now()) / DAY_MS);
  }

  function betaParticipantStatusSignal(status) {
    const labels = { onboarding: 'Onboarding', active: 'Beta ativo', completed: 'Concluído', converted: 'Convertido', closed: 'Encerrado' };
    const tone = status === 'onboarding' ? 'warning' : status === 'closed' ? 'neutral' : 'success';
    return `<span class="health-signal ${tone}"><i></i>${escape(labels[status] || 'Onboarding')}</span>`;
  }

  function betaStageSignal(stage) {
    const tone = ['approved', 'active', 'completed', 'converted'].includes(stage) ? 'success' : ['closed'].includes(stage) ? 'neutral' : ['contact', 'interview', 'onboarding'].includes(stage) ? 'warning' : '';
    return `<span class="health-signal ${tone}"><i></i>${escape(BETA_STAGE_LABELS[stage] || stage || 'Nova')}</span>`;
  }

  function betaLatestEvent(application) {
    return [...(application?.events || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] || null;
  }

  function betaNeedsAttention(application) {
    if (['converted', 'closed'].includes(application?.status)) return false;
    const reference = betaLatestEvent(application)?.created_at || application?.updated_at || application?.submitted_at;
    return reference && Date.now() - new Date(reference).getTime() >= 3 * DAY_MS;
  }

  function whatsappUrl(phone) {
    let digits = String(phone || '').replace(/\D/g, '');
    if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
    return digits ? `https://wa.me/${digits}` : '';
  }

  function betaParticipantHealthSignal(participant) {
    if (!participant?.activated_at) return '<span class="health-signal warning"><i></i>Aguardando ativação</span>';
    const remaining = betaRemainingDays(participant);
    if (remaining === null) return '<span class="health-signal warning"><i></i>Sem data de encerramento</span>';
    if (remaining < 0) return `<span class="health-signal danger"><i></i>Beta encerrado há ${Math.abs(remaining)} dia(s)</span>`;
    if (remaining <= 7) return `<span class="health-signal danger"><i></i>${remaining} dia(s) restantes</span>`;
    if (remaining <= 21) return `<span class="health-signal warning"><i></i>${remaining} dia(s) restantes</span>`;
    return `<span class="health-signal success"><i></i>${remaining} dia(s) restantes</span>`;
  }

  function noticeMarkup() {
    if (!state.notice) return '';
    return `<div class='notice ${escape(state.notice.type)}' role='${state.notice.type === 'error' ? 'alert' : 'status'}'><span>${state.notice.type === 'error' ? '!' : '✓'}</span>${escape(state.notice.text)}<button type='button' data-action='dismiss-notice' aria-label='Fechar aviso'>×</button></div>`;
  }

  function updateNoticeRegion() {
    document.querySelectorAll('[data-notice-region]').forEach((region) => { region.innerHTML = noticeMarkup(); });
  }

  function showNotice(text, type = 'success', rerender = true) {
    state.notice = { text, type };
    if (rerender) render();
    else updateNoticeRegion();
    window.setTimeout(() => {
      if (state.notice?.text === text) { state.notice = null; updateNoticeRegion(); }
    }, 5000);
  }

  function setPendingElement(element, pending) {
    if (!element) return;
    const buttons = element.matches?.('form') ? [...element.querySelectorAll('button[type="submit"]')] : [element];
    element.setAttribute('aria-busy', pending ? 'true' : 'false');
    buttons.forEach((button) => {
      if (pending) {
        button.dataset.pendingLabel = button.textContent;
        button.disabled = true;
        button.textContent = 'Aguarde…';
      } else {
        button.disabled = false;
        if (button.dataset.pendingLabel) button.textContent = button.dataset.pendingLabel;
        delete button.dataset.pendingLabel;
      }
    });
  }

  async function withPending(key, element, action) {
    if (state.pendingAction) return;
    state.pendingAction = key;
    setPendingElement(element, true);
    try {
      return await action();
    } finally {
      if (state.pendingAction === key) state.pendingAction = '';
      if (element?.isConnected) setPendingElement(element, false);
    }
  }

  async function api(path, options = {}) {
    const response = await fetch(apiUrl(path), {
      ...options,
      headers: {
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.error || 'Não foi possível concluir a operação.');
      error.status = response.status;
      throw error;
    }
    return body;
  }

  async function authRequest(path, options = {}) {
    const response = await fetch(`${String(config.supabaseUrl).replace(/\/$/, '')}/auth/v1${path}`, {
      method: options.method || 'GET',
      headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${state.token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.msg || body.message || body.error_description || 'Não foi possível validar o segundo fator.');
      error.status = response.status;
      throw error;
    }
    return body;
  }

  async function startMfaEnrollment() {
    const enrolled = await authRequest('/factors', {
      method: 'POST',
      body: { factor_type: 'totp', friendly_name: 'ChefOS Control Center', issuer: 'ChefOS' }
    });
    const qrCode = enrolled.totp?.qr_code || '';
    state.mfaMode = {
      type: 'enroll',
      factorId: enrolled.id,
      qrCode: qrCode.startsWith('data:') ? qrCode : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrCode)}`,
      secret: enrolled.totp?.secret || '',
      uri: enrolled.totp?.uri || ''
    };
  }

  async function prepareMfa(authUser = null) {
    const privileged = Boolean(state.user?.mfaRequired || ['owner', 'platform_admin'].includes(state.user?.role));
    if (!privileged || state.user?.mfaVerified) return false;
    const user = authUser?.factors ? authUser : await authRequest('/user');
    const factor = user?.factors?.find((item) => item.factor_type === 'totp' && item.status === 'verified');
    if (factor) state.mfaMode = { type: 'challenge', factorId: factor.id };
    else {
      const pending = user?.factors?.find((item) => item.factor_type === 'totp' && item.status === 'unverified');
      if (pending) await authRequest(`/factors/${encodeURIComponent(pending.id)}`, { method: 'DELETE' });
      await startMfaEnrollment();
    }
    state.loading = false;
    render();
    return true;
  }

  async function verifyMfa(code) {
    const challenge = await authRequest(`/factors/${encodeURIComponent(state.mfaMode.factorId)}/challenge`, {
      method: 'POST', body: { factorId: state.mfaMode.factorId }
    });
    const verified = await authRequest(`/factors/${encodeURIComponent(state.mfaMode.factorId)}/verify`, {
      method: 'POST', body: { challenge_id: challenge.id, code: String(code || '').replace(/\s/g, '') }
    });
    if (!verified.access_token) throw new Error('O Supabase não retornou a sessão AAL2 esperada.');
    state.token = verified.access_token;
    sessionStorage.setItem('koregastro_admin_token', state.token);
    state.mfaMode = null;
    state.user = (await api('/api/admin/session')).data;
    await finishAuthenticatedBoot();
    showNotice('Segundo fator confirmado. Sessão administrativa protegida.');
  }

  async function signIn(email, password) {
    const response = await fetch(`${String(config.supabaseUrl).replace(/\/$/, '')}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${config.supabaseAnonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.access_token) throw new Error(body.error_description || 'Credenciais inválidas.');
    state.token = body.access_token;
    sessionStorage.setItem('koregastro_admin_token', state.token);
    try {
      state.user = (await api('/api/admin/session')).data;
    } catch (error) {
      sessionStorage.removeItem('koregastro_admin_token');
      state.token = '';
      throw error;
    }
    return !(await prepareMfa(body.user));
  }

  async function finishInvitation(password, confirmation) {
    if (password !== confirmation) throw new Error('As senhas informadas não coincidem.');
    if (password.length < 10) throw new Error('Use uma senha com pelo menos 10 caracteres.');
    const response = await fetch(`${String(config.supabaseUrl).replace(/\/$/, '')}/auth/v1/user`, {
      method: 'PUT',
      headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.msg || body.message || body.error_description || 'Não foi possível concluir o convite.');
    sessionStorage.setItem('koregastro_admin_token', state.token);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    state.inviteMode = false;
    state.user = (await api('/api/admin/session')).data;
    if (await prepareMfa()) return;
    await finishAuthenticatedBoot();
    showNotice('Convite aceito. Seu acesso administrativo está ativo.');
  }

  async function signOut() {
    try {
      await fetch(`${String(config.supabaseUrl).replace(/\/$/, '')}/auth/v1/logout`, {
        method: 'POST', headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${state.token}` }
      });
    } finally {
      sessionStorage.removeItem('koregastro_admin_token');
      Object.assign(state, { token: '', inviteMode: false, mfaMode: null, user: null, dashboard: null, tenants: [], customerSummary: null, customerMeta: null, plans: [], permissionCatalog: [], tickets: null, ticketSummary: null, ticketMeta: null, menu: [], menuCategories: [], menuMeta: null, selectedTenant: '', selectedStore: '', selectedTicketId: '', admins: null, adminSummary: null, adminRoles: [], adminMeta: null, health: null, logs: null, betaApplications: null, betaSummary: null, betaTransitions: null, workCards: null, workMeta: null, modal: null, modalDirty: false, modalReturn: null, pageDirty: false, pendingAction: '', sectionLoading: '', sectionError: null, sidebarOpen: false, globalQuery: '', notice: null });
      render();
    }
  }

  async function loadCore({ silent = false } = {}) {
    if (!silent) {
      state.sectionLoading = state.section;
      state.sectionError = null;
      render();
    }
    try {
      const requests = [
        ['dashboard', 'dashboard.read', '/api/admin/dashboard'],
        ['customers', 'customers.read', '/api/admin/customers?pageSize=500'],
        ['plans', 'plans.read', '/api/admin/plans'],
        ['tickets', 'support.read', '/api/admin/tickets']
      ].filter(([, capability]) => can(capability));
      const settled = await Promise.allSettled(requests.map(([, , endpoint]) => api(endpoint)));
      const results = Object.fromEntries(requests.map(([key], index) => [key, settled[index]]));
      if (results.dashboard?.status === 'fulfilled') state.dashboard = results.dashboard.value.data;
      if (results.customers?.status === 'fulfilled') {
        state.tenants = results.customers.value.data || [];
        state.customerSummary = results.customers.value.summary || null;
        state.customerMeta = results.customers.value.meta || null;
      }
      if (results.plans?.status === 'fulfilled') {
        state.plans = results.plans.value.data || [];
        state.permissionCatalog = results.plans.value.permissionCatalog || [];
      }
      if (results.tickets?.status === 'fulfilled') {
        state.tickets = results.tickets.value.data || [];
        state.ticketSummary = results.tickets.value.summary || null;
        state.ticketMeta = results.tickets.value.meta || null;
      }
      if (!state.selectedTenant && state.tenants[0]) state.selectedTenant = state.tenants[0].accountId || state.tenants[0].id;
      const selectedCustomer = state.tenants.find((tenant) => String(tenant.accountId || tenant.id) === String(state.selectedTenant));
      if (!selectedCustomer?.stores?.some((store) => String(store.storeId || store.id) === String(state.selectedStore))) {
        state.selectedStore = selectedCustomer?.stores?.[0]?.storeId || selectedCustomer?.stores?.[0]?.id || '';
      }
      if (!state.selectedTicketId && state.tickets?.[0]) state.selectedTicketId = state.tickets[0].id;
      const failures = settled.filter((result) => result.status === 'rejected').map((result) => result.reason);
      if (failures.length) {
        const unauthorized = failures.find((error) => error?.status === 401);
        if (unauthorized) throw unauthorized;
        const error = new Error(`${failures.length} área(s) não responderam. Os dados disponíveis foram mantidos.`);
        error.partial = true;
        throw error;
      }
    } finally {
      if (!silent) {
        state.sectionLoading = '';
        render();
      }
    }
  }

  async function loadSection(section = state.section, force = false) {
    if (section === 'support' && (force || !state.tickets)) {
      const tickets = await api('/api/admin/tickets');
      state.tickets = tickets.data || [];
      state.ticketSummary = tickets.summary || null;
      state.ticketMeta = tickets.meta || null;
    }
    if (section === 'catalog') {
      if (!state.selectedStore) {
        state.menu = [];
        state.menuCategories = [];
        state.menuMeta = null;
      } else {
        const menu = await api(`/api/admin/tenant-menu?storeId=${encodeURIComponent(state.selectedStore)}`);
        state.menu = menu.data || [];
        state.menuCategories = menu.categories || [];
        state.menuMeta = menu.meta || null;
      }
    }
    if (section === 'administrators' && (force || !state.admins)) {
      const access = await api('/api/admin/administrators');
      state.admins = access.data || [];
      state.adminSummary = access.summary || null;
      state.adminRoles = access.roles || [];
      state.adminMeta = access.meta || null;
    }
    if (section === 'health' && (force || !state.health)) state.health = await api('/api/admin/health');
    if (section === 'beta' && (force || !state.betaApplications)) {
      const betaPayload = await api('/api/admin/beta-applications');
      state.betaApplications = betaPayload.data || [];
      state.betaSummary = betaPayload.summary || {};
      state.betaTransitions = betaPayload.transitions || state.betaTransitions || null;
    }
    if (['workboard', 'mywork'].includes(section) && (force || !state.workCards)) {
      const board = await api('/api/admin/work-board');
      state.workCards = board.cards || [];
      state.workMeta = board.meta || {};
      state.betaTransitions = board.meta?.betaTransitions || state.betaTransitions || null;
    }
    if (section === 'logs' && (force || !state.logs)) {
      const filters = state.filters;
      const query = new URLSearchParams({
        page: String(filters.auditPage || 1), pageSize: '40', q: filters.auditQuery || '',
        category: filters.auditCategory || 'all', outcome: filters.auditOutcome || 'all',
        actor: filters.auditActor || '', from: filters.auditFrom || '', to: filters.auditTo || ''
      });
      state.logs = await api(`/api/admin/logs?${query}`);
    }
  }

  function authNotice() {
    return `<div class='auth-notice-region' data-notice-region aria-live='polite' aria-atomic='true'>${noticeMarkup()}</div>`;
  }

  async function loadInitialData() {
    let coreWarning = null;
    try {
      await loadCore();
    } catch (error) {
      if (error?.status === 401) throw error;
      coreWarning = error;
    }
    const alreadyLoaded = new Set(['overview', 'subscriptions', 'tenants', 'support', 'plans', 'provision']);
    if (alreadyLoaded.has(state.section)) {
      if (coreWarning) showNotice(coreWarning.message || 'Parte dos dados gerais não respondeu.', 'error', false);
      return;
    }
    state.sectionLoading = state.section;
    state.sectionError = null;
    render();
    try {
      await loadSection(state.section);
      if (coreWarning) showNotice(coreWarning.message || 'Parte dos dados gerais não respondeu.', 'error', false);
    } catch (error) {
      state.sectionError = { section: state.section, message: error.message || 'A área não respondeu.' };
      throw error;
    } finally {
      state.sectionLoading = '';
      render();
    }
  }

  async function finishAuthenticatedBoot() {
    state.restoringSession = false;
    if (!canOpenSection(state.section)) state.section = 'overview';
    window.history.replaceState({ section: state.section }, '', `#/${ROUTE_PATHS[state.section] || ROUTE_PATHS.overview}`);
    await loadInitialData();
  }

  function restoringView() {
    return `<section class='login-shell' aria-busy='true'><div class='login-brand'><span class='brand-mark' aria-hidden='true'></span><div><strong>ChefOS</strong><small>Painel administrativo</small></div></div><div class='login-card restoring-card' role='status' aria-live='polite'><div class='loading'><i></i>Restaurando sua sessão segura…</div><p class='muted'>Estamos preparando suas permissões e os dados da operação.</p></div></section>`;
  }

  function loginView() {
    return `<section class="login-shell">
      <div class="login-brand"><span class="brand-mark" aria-hidden="true"></span><strong>ChefOS</strong><small>Control Center</small></div>
      <form class="login-card" data-form="login">${authNotice()}
        <p class="eyebrow">ACESSO ADMINISTRATIVO</p>
        <h1>Bem-vindo ao centro de comando.</h1>
        <p class="muted">Gerencie toda a operação ChefOS com uma conta autorizada.</p>
        <label>E-mail<input type="email" name="email" autocomplete="email" placeholder="admin@chefos.online" required /></label>
        <label>Senha<input type="password" name="password" autocomplete="current-password" placeholder="Sua senha" required /></label>
        <button class="primary wide-button" type="submit">Entrar no Control Center</button>
        <small class="secure-note"><i></i>Sessão protegida pelo Supabase</small>
      </form>
    </section>`;
  }

  function inviteView() {
    return `<section class='login-shell invite-acceptance'><div class='login-brand'><span class='brand-mark' aria-hidden='true'></span><div><strong>ChefOS</strong><small>Control Center</small></div></div><form class='login-card' data-form='invite-password'>${authNotice()}<p class='eyebrow'>CONVITE ADMINISTRATIVO</p><h1>Proteja seu novo acesso.</h1><p class='muted'>Defina uma senha forte para concluir o convite e entrar no centro de controle.</p><label>Nova senha<input name='password' type='password' required minlength='10' maxlength='128' autocomplete='new-password' placeholder='Mínimo de 10 caracteres' /></label><label>Confirmar senha<input name='confirmation' type='password' required minlength='10' maxlength='128' autocomplete='new-password' placeholder='Repita a senha' /></label><div class='login-security'><span>✓</span><p><strong>Ativação auditada</strong><small>A conta só será ativada após a confirmação do e-mail.</small></p></div><button class='primary wide-button' type='submit'>Aceitar convite e entrar →</button></form></section>`;
  }

  function mfaView() {
    const enrollment = state.mfaMode?.type === 'enroll';
    return `<section class='login-shell mfa-shell'><div class='login-brand'><span class='brand-mark' aria-hidden='true'></span><div><strong>ChefOS</strong><small>Control Center</small></div></div><form class='login-card mfa-card' data-form='mfa'>${authNotice()}<p class='eyebrow'>SEGUNDO FATOR</p><h1>${enrollment ? 'Proteja sua conta administrativa.' : 'Confirme que é você.'}</h1><p class='muted'>${enrollment ? 'Escaneie o QR Code no Google Authenticator, Microsoft Authenticator, 1Password ou aplicativo compatível.' : 'Abra seu aplicativo autenticador e informe o código atual.'}</p>${enrollment ? `<div class='mfa-setup'><img src='${escape(state.mfaMode.qrCode)}' alt='QR Code para cadastrar o segundo fator' /><div><small>CHAVE MANUAL</small><code>${escape(state.mfaMode.secret)}</code><button type='button' class='text-button' data-action='copy-mfa-secret'>Copiar chave</button></div></div>` : `<div class='mfa-prompt'><span>⌁</span><div><strong>Autenticador cadastrado</strong><small>O código muda a cada 30 segundos.</small></div></div>`}<label>Código de 6 dígitos<input name='code' type='text' inputmode='numeric' autocomplete='one-time-code' required minlength='6' maxlength='6' pattern='[0-9]{6}' placeholder='000000' /></label><button class='primary wide-button' type='submit'>${enrollment ? 'Ativar MFA e entrar →' : 'Verificar e entrar →'}</button><button class='quiet mfa-logout' type='button' data-action='logout'>Sair e usar outra conta</button></form></section>`;
  }

  function missingConfigView() {
    return `<section class="login-shell"><div class="login-card"><p class="eyebrow">CONFIGURAÇÃO PENDENTE</p><h1>Painel pronto para conectar</h1><p class="muted">Configure <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> antes do deploy.</p></div></section>`;
  }

  function sidebar() {
    const visibleGroups = navigation.map((group) => ({ ...group, items: group.items.filter(([key]) => canOpenSection(key)) })).filter((group) => group.items.length);
    const groups = visibleGroups.map((group) => `<div class="nav-group"><span class="nav-label">${group.label}</span>${group.items.map(([key, label, glyph]) => {
      const badge = key === 'support' && (state.dashboard?.openTickets || 0) ? `<b>${state.dashboard.openTickets}</b>` : '';
      return `<button class="nav-item ${state.section === key ? 'active' : ''}" data-action="section" data-section="${key}" ${state.section === key ? 'aria-current="page"' : ''}><span class="nav-glyph" aria-hidden="true">${glyph}</span><span>${label}</span>${badge}</button>`;
    }).join('')}</div>`).join('');
    const healthState = state.health?.status || 'unknown';
    const healthLabels = {
      healthy: ['Sistema operacional', 'Serviços verificados'], attention: ['Sistema com atenção', 'Verifique os alertas'],
      degraded: ['Operação degradada', 'Intervenção necessária'], critical: ['Incidente crítico', 'Intervenção imediata'],
      unknown: ['Status não verificado', 'Abra Saúde do sistema']
    };
    const healthLabel = healthLabels[healthState] || healthLabels.unknown;
    return `<aside class="sidebar ${state.sidebarOpen ? 'open' : ''}" aria-label="Navegação principal">
      <div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>ChefOS<small>Control Center</small></span><button class="icon-button sidebar-close" data-action="toggle-sidebar" aria-label="Fechar menu">×</button></div>
      <nav>${groups}</nav>
      <div class="sidebar-footer">
        <div class="system-pill system-${escape(healthState)}"><i></i><span><strong>${healthLabel[0]}</strong><small>${healthLabel[1]}</small></span></div>
        <div class="user-card"><span class="avatar">${initials(state.user?.email)}</span><span><strong>${escape(state.user?.email?.split('@')[0])}</strong><small>${escape(roleLabel(state.user?.role))} · ${escape(state.user?.email)}</small></span><button class="quiet" data-action="logout">Sair</button></div>
      </div>
    </aside>`;
  }

  function commandResults() {
    if (state.globalQuery.trim().length < 2) return '';
    const query = state.globalQuery.trim();
    const sectionResults = Object.entries(sectionLabels).filter(([key, label]) => canOpenSection(key) && includes(label, query)).slice(0, 4);
    const tenantResults = state.tenants.filter((tenant) => includes(`${tenant.full_name} ${tenant.email} ${(tenant.stores || []).map((store) => store.name).join(' ')}`, query)).slice(0, 5);
    if (!sectionResults.length && !tenantResults.length) return `<div class="command-results"><p>Nenhum resultado para “${escape(query)}”.</p></div>`;
    return `<div class="command-results">
      ${sectionResults.length ? `<small>NAVEGAÇÃO</small>${sectionResults.map(([key, label]) => `<button role="option" data-command-option data-action="command-section" data-section="${key}"><span class="command-icon">↗</span><span><strong>${label}</strong><em>Abrir seção</em></span></button>`).join('')}` : ''}
      ${tenantResults.length ? `<small>CLIENTES E LOJAS</small>${tenantResults.map((tenant) => { const matchingStore = (tenant.stores || []).find((store) => includes(store.name, query)); return `<button role="option" data-command-option data-action="open-tenant" data-id="${tenant.accountId || tenant.id}"><span class="avatar small">${initials(tenant.full_name)}</span><span><strong>${escape(tenant.full_name)}</strong><em>${escape(matchingStore ? `Loja: ${matchingStore.name}` : tenant.email)}</em></span></button>`; }).join('')}` : ''}
    </div>`;
  }

  function topbar() {
    return `<header class="topbar">
      <button class="icon-button menu-button" data-action="toggle-sidebar" aria-label="Abrir menu">☰</button>
      <div class="breadcrumbs"><span>ChefOS</span><b>/</b><strong>${sectionLabels[state.section]}</strong></div>
      <div class="global-search" role="search"><span>⌕</span><input role="combobox" aria-autocomplete="list" aria-haspopup="listbox" data-search="global" value="${escape(state.globalQuery)}" placeholder="Buscar cliente, loja ou seção..." aria-label="Busca global" aria-controls="global-search-results" aria-expanded="${state.globalQuery.trim().length >= 2 ? 'true' : 'false'}" autocomplete="off" /><kbd>Ctrl K</kbd><div id="global-search-results" role="listbox" aria-label="Resultados da busca" data-command-region aria-live="polite" style="display:contents">${commandResults()}</div></div>
      ${can('onboarding.manage') ? `<button class="top-action" data-action="open-provision"><span>＋</span>Novo cliente</button>` : ''}
    </header>`;
  }

  function pageHeader(eyebrow, title, description, actions = '') {
    return `<header class="page-header"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="muted">${description}</p></div>${actions ? `<div class="header-actions">${actions}</div>` : ''}</header>`;
  }

  function metric(label, value, detail, tone = '', glyph = '↗') {
    return `<article class="metric-card ${tone}"><div><span>${label}</span><i aria-hidden="true">${glyph}</i></div><strong>${value}</strong><small>${detail}</small></article>`;
  }

  function overview() {
    const data = state.dashboard || {};
    const subscriptions = data.subscriptions || {};
    const totalSubscriptions = Object.values(subscriptions).reduce((sum, value) => sum + Number(value || 0), 0);
    const healthySubscriptions = Number(data.activeSubscriptions || 0) + Number(data.activeTrials || 0);
    const activeRate = totalSubscriptions ? Math.round((healthySubscriptions / totalSubscriptions) * 100) : 0;
    const recent = [...state.tenants].sort((a, b) => new Date(b.created_at || b.updated_at) - new Date(a.created_at || a.updated_at)).slice(0, 5);
    const attentionTickets = (state.tickets || []).filter((ticket) => !['resolved', 'closed'].includes(ticket.status)).sort((a, b) => Number(b.waitingHours || 0) - Number(a.waitingHours || 0)).slice(0, 4);
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
    const alerts = [];
    if (data.atRiskSubscriptions) alerts.push(`<button data-action="filtered-section" data-section="subscriptions" data-filter="past_due"><i class="alert-dot danger"></i><span><strong>${data.atRiskSubscriptions} assinatura(s) inadimplente(s)</strong><small>Precisam de acompanhamento financeiro</small></span><b>Ver agora →</b></button>`);
    if (data.expiredButEnabled) alerts.push(`<button data-action="section" data-section="subscriptions"><i class="alert-dot danger"></i><span><strong>${data.expiredButEnabled} acesso(s) marcado(s) ativo(s), mas vencido(s)</strong><small>Corrija o período para evitar divergência de acesso</small></span><b>Revisar →</b></button>`);
    if (data.waitingOver24Hours) alerts.push(`<button data-action="section" data-section="support"><i class="alert-dot warning"></i><span><strong>${data.waitingOver24Hours} chamado(s) aguardando há mais de 24h</strong><small>Fila fora do objetivo de resposta</small></span><b>Atender →</b></button>`);
    if (data.urgentTickets) alerts.push(`<button data-action="section" data-section="support"><i class="alert-dot warning"></i><span><strong>${data.urgentTickets} chamado(s) prioritário(s)</strong><small>Fila de atendimento requer atenção</small></span><b>Abrir fila →</b></button>`);
    if (data.incompleteOnboarding) alerts.push(`<button data-action="section" data-section="tenants"><i class="alert-dot info"></i><span><strong>${data.incompleteOnboarding} cliente(s) com onboarding incompleto</strong><small>Faltam estrutura empresarial, dados fiscais ou assinatura</small></span><b>Ver clientes →</b></button>`);
    if (!alerts.length) alerts.push(`<div class="all-clear"><i>✓</i><span><strong>Operação sob controle</strong><small>Nenhuma pendência crítica identificada agora.</small></span></div>`);

    return `<section class="page overview-page">
      ${pageHeader('PAINEL EXECUTIVO', `${greeting}, equipe ChefOS.`, `Pulso operacional atualizado ${relative(data.generatedAt)}.`, `<button class="secondary" data-action="refresh">↻ Atualizar dados</button>${can('onboarding.manage') ? `<button class="primary" data-action="open-provision">＋ Novo cliente</button>` : ''}`)}
      ${(data.dataQuality?.warnings || []).length ? `<div class="data-quality-banner"><span>i</span><div><strong>Receita contratada, ainda sem conciliação automática</strong><p>${escape(data.dataQuality.warnings[0])}</p></div><button data-action="section" data-section="subscriptions">Entender na base →</button></div>` : ''}
      <div class="metrics executive-metrics">
        ${metric('Receita mensal contratada', money(data.contractedMonthly), `${money((data.contractedMonthly || 0) * 12)} anualizado`, 'accent', 'R$')}
        ${metric('Acessos vigentes', shortNumber(healthySubscriptions), `${activeRate}% das assinaturas cadastradas`, 'success', '↗')}
        ${metric('Clientes ChefOS', shortNumber(data.tenants), `${data.stores || 0} operações · ${data.incompleteOnboarding || 0} incompletas`, data.incompleteOnboarding ? 'warning' : '', '◫')}
        ${metric('Fila de suporte', shortNumber((data.openTickets || 0) + (data.inProgressTickets || 0)), `${data.waitingOver24Hours || 0} aguardando há mais de 24h`, data.waitingOver24Hours ? 'warning' : '', '✦')}
      </div>
      <div class="operations-radar">
        <button data-action="filtered-section" data-section="subscriptions" data-filter="trialing"><span>TESTES ENCERRANDO</span><strong>${data.trialsEnding7Days || 0}</strong><small>nos próximos 7 dias</small></button>
        <button data-action="section" data-section="subscriptions"><span>ACESSOS VENCIDOS</span><strong>${data.expiredButEnabled || 0}</strong><small>com status ainda ativo</small></button>
        <button data-action="section" data-section="support"><span>SLA &gt; 24 HORAS</span><strong>${data.waitingOver24Hours || 0}</strong><small>chamados pendentes</small></button>
        <button data-action="section" data-section="tenants"><span>ONBOARDING INCOMPLETO</span><strong>${data.incompleteOnboarding || 0}</strong><small>clientes para revisar</small></button>
      </div>
      <div class="overview-grid">
        <section class="panel revenue-panel">
          <div class="panel-heading"><div><p class="eyebrow">ASSINATURAS</p><h2>Saúde da receita</h2></div><button class="text-button" data-action="section" data-section="subscriptions">Ver assinaturas →</button></div>
          <div class="revenue-hero"><span><small>CONTRATADO / MÊS</small><strong>${money(data.contractedMonthly)}</strong></span><span><small>RENOVAÇÕES EM 7 DIAS</small><strong>${data.renewalsNext7Days || 0}</strong></span></div>
          <div class="distribution-bar" aria-label="Distribuição das assinaturas">
            ${Object.entries(subscriptions).map(([key, value]) => `<i class="segment segment-${key}" style="width:${totalSubscriptions ? (value / totalSubscriptions) * 100 : 0}%" title="${key}: ${value}"></i>`).join('')}
          </div>
          <div class="distribution-legend">${Object.entries(subscriptions).map(([key, value]) => `<span>${status(key)}<strong>${value}</strong></span>`).join('') || '<p class="empty-inline">Ainda não há assinaturas.</p>'}</div>
        </section>
        <section class="panel attention-panel"><div class="panel-heading"><div><p class="eyebrow">AGORA</p><h2>Pontos de atenção</h2></div></div><div class="attention-list">${alerts.join('')}</div></section>
      </div>
      <div class="overview-grid lower">
        <section class="panel compact-table"><div class="panel-heading"><div><p class="eyebrow">CLIENTES</p><h2>Entradas recentes</h2></div><button class="text-button" data-action="section" data-section="tenants">Ver todos →</button></div>
          <div class="recent-list">${recent.map((tenant) => { const subscription = subscriptionOf(tenant); return `<button data-action="open-tenant" data-id="${tenant.accountId || tenant.id}"><span class="avatar">${initials(tenant.full_name)}</span><span><strong>${escape(tenant.full_name)}</strong><small>${escape(tenant.stores?.[0]?.name || tenant.email)}</small></span>${subscription ? status(subscription.status) : status('unknown')}<time>${relative(tenant.created_at || tenant.updated_at)}</time></button>`; }).join('') || '<p class="empty">Nenhum cliente cadastrado.</p>'}</div>
        </section>
        <section class="panel support-snapshot"><div class="panel-heading"><div><p class="eyebrow">SUPORTE</p><h2>Fila prioritária</h2></div><button class="text-button" data-action="section" data-section="support">Central de suporte →</button></div>
          <div class="snapshot-list">${attentionTickets.map((ticket) => `<button data-action="open-ticket" data-id="${ticket.id}"><span>${priority(ticket.priority)}<strong>${escape(ticket.subject || 'Sem assunto')}</strong><small>${escape(ticket.client_name)} · ${relative(ticket.updated_at || ticket.created_at)}</small></span><span class="snapshot-status">${sla(ticket)}${status(ticket.status)}</span></button>`).join('') || '<div class="all-clear compact"><i>✓</i><span><strong>Caixa de entrada vazia</strong><small>Nenhum chamado pendente.</small></span></div>'}</div>
        </section>
      </div>
    </section>`;
  }

  function subscriptions() {
    const query = state.filters.subscription;
    const filter = state.filters.subscriptionStatus;
    const rows = state.tenants.map((tenant) => ({ tenant, subscription: subscriptionOf(tenant) || {} }))
      .filter(({ tenant, subscription }) => (!query || includes(`${tenant.full_name} ${tenant.email} ${tenant.stores?.map((store) => store.name).join(' ')}`, query)) && (filter === 'all' || subscription.status === filter));
    const contractedMonthly = rows.filter(({ subscription }) => subscription.status === 'active' && subscription.entitlementActive).reduce((sum, { subscription }) => sum + Number(planById(subscription.plan_id)?.price || 0), 0);
    const dueSoon = rows.filter(({ subscription }) => { const diff = new Date(subscription.current_period_end).getTime() - Date.now(); return subscription.entitlementActive && diff >= 0 && diff <= 7 * 86400000; }).length;
    const expired = rows.filter(({ subscription }) => subscription.periodExpired && ['active', 'trialing'].includes(subscription.status)).length;
    const actions = `<button class="secondary" data-action="export" data-kind="subscriptions">↓ Exportar CSV</button>${can('onboarding.manage') ? `<button class="primary" data-action="open-provision">＋ Provisionar cliente</button>` : ''}`;
    return `<section class="page">
      ${pageHeader('RECEITA E ACESSO', 'Assinaturas', 'Controle planos, vencimentos e o acesso de cada operação ChefOS.', actions)}
      <div class="integration-warning"><span>!</span><div><strong>Alterações de acesso são internas</strong><p>O conector de recorrência do Mercado Pago ainda não está habilitado; mudanças aqui não cancelam nem alteram cobranças no provedor.</p></div></div>
      <div class="summary-strip"><div><span>Receita contratada nesta visão</span><strong>${money(contractedMonthly)}</strong></div><div><span>Assinaturas exibidas</span><strong>${rows.length}</strong></div><div><span>Vencem em 7 dias</span><strong>${dueSoon}</strong></div><div class="danger-text"><span>Ativas com período vencido</span><strong>${expired}</strong></div></div>
      <div class="data-toolbar"><div class="search-field"><span>⌕</span><input data-search="subscription" value="${escape(query)}" placeholder="Buscar cliente, e-mail ou loja" /></div><select data-filter="subscriptionStatus" aria-label="Filtrar status"><option value="all" ${filter === 'all' ? 'selected' : ''}>Todos os status</option><option value="active" ${filter === 'active' ? 'selected' : ''}>Ativas</option><option value="trialing" ${filter === 'trialing' ? 'selected' : ''}>Em teste</option><option value="past_due" ${filter === 'past_due' ? 'selected' : ''}>Inadimplentes</option><option value="unpaid" ${filter === 'unpaid' ? 'selected' : ''}>Não pagas</option><option value="canceled" ${filter === 'canceled' ? 'selected' : ''}>Canceladas</option></select><span class="result-count">${rows.length} resultado(s)</span></div>
      <div class="panel table-wrap"><table><thead><tr><th>Cliente / operação</th><th>Plano</th><th>Status</th><th>Saúde do acesso</th><th>Valor mensal</th><th>Período atual</th><th></th></tr></thead><tbody>
        ${rows.map(({ tenant, subscription }) => { const plan = planById(subscription.plan_id); const accountId = tenant.accountId || tenant.id; return `<tr><td><button class="customer-cell" data-action="open-tenant" data-id="${accountId}"><span class="avatar small">${initials(tenant.full_name)}</span><span><strong>${escape(tenant.full_name)}</strong><small>${escape(tenant.stores?.[0]?.name || tenant.email)}</small></span></button></td><td><strong>${escape(plan?.name || 'Sem plano')}</strong><small>${plan ? `${plan.max_stores || 1} loja(s)` : 'Defina um plano'}</small></td><td>${status(subscription.status)}</td><td>${entitlement(subscription)}</td><td><strong>${money(plan?.price)}</strong><small>valor do plano</small></td><td><strong>${day(subscription.current_period_end)}</strong><small>${relative(subscription.current_period_end)}</small></td><td>${can('subscriptions.manage') ? `<button class="row-action" data-action="edit-subscription" data-id="${accountId}">Gerenciar</button>` : '<span class="read-only-label">Somente leitura</span>'}</td></tr>`; }).join('') || '<tr><td colspan="7" class="empty">Nenhuma assinatura encontrada com estes filtros.</td></tr>'}
      </tbody></table></div>
    </section>`;
  }

  function tenants() {
    const query = state.filters.customer;
    const rows = state.tenants.filter((tenant) => !query || includes(`${tenant.full_name} ${tenant.email} ${tenant.stores?.map((store) => store.name).join(' ')}`, query));
    const summary = state.customerSummary || {};
    const actions = `<button class="secondary" data-action="export" data-kind="customers">↓ Exportar CSV</button>${can('onboarding.manage') ? `<button class="primary" data-action="open-provision">＋ Novo cliente</button>` : ''}`;
    return `<section class="page">
      ${pageHeader('BASE DE CLIENTES', 'Clientes e operações', 'Visão 360º de identidade, onboarding, lojas, assinatura e suporte.', actions)}
      <div class="summary-strip customer-summary"><div><span>Clientes</span><strong>${summary.total ?? state.tenants.length}</strong></div><div><span>Operações</span><strong>${summary.stores || 0}</strong></div><div class="warning-text"><span>Onboarding incompleto</span><strong>${summary.incompleteOnboarding || 0}</strong></div><div class="danger-text"><span>Sem assinatura</span><strong>${summary.withoutSubscription || 0}</strong></div><div><span>Chamados abertos</span><strong>${summary.openTickets || 0}</strong></div></div>
      <div class="data-toolbar"><div class="search-field"><span>⌕</span><input data-search="customer" value="${escape(query)}" placeholder="Buscar por nome, e-mail ou loja" /></div><span class="result-count">${rows.length} cliente(s)</span></div>
      <div class="panel table-wrap"><table><thead><tr><th>Cliente</th><th>Operações</th><th>Onboarding</th><th>Assinatura</th><th>Suporte</th><th>Última atividade</th><th></th></tr></thead><tbody>
        ${rows.map((tenant) => { const subscription = subscriptionOf(tenant); const accountId = tenant.accountId || tenant.id; return `<tr><td><button class="customer-cell" data-action="open-tenant" data-id="${accountId}"><span class="avatar small">${initials(tenant.full_name)}</span><span><strong>${escape(tenant.full_name)}</strong><small>${escape(tenant.email)}</small></span></button></td><td><strong>${tenant.stores?.length || 0} operação(ões)</strong><small>${escape(tenant.stores?.map((store) => store.name).join(', ') || 'Nenhuma loja')}</small></td><td>${onboarding(tenant)}</td><td>${subscription ? status(subscription.status) : status('unknown')}<small>${subscription ? escape(planById(subscription.plan_id)?.name || 'Plano não identificado') : 'Requer configuração'}</small></td><td><strong>${tenant.support?.openTickets || 0} aberto(s)</strong><small>${tenant.support?.urgentTickets || 0} prioritário(s)</small></td><td><strong>${relative(tenant.last_sign_in_at || tenant.updated_at)}</strong><small>${date(tenant.last_sign_in_at || tenant.updated_at)}</small></td><td><button class="row-action" data-action="open-tenant" data-id="${accountId}">Visão 360º</button></td></tr>`; }).join('') || '<tr><td colspan="7" class="empty">Nenhum cliente encontrado.</td></tr>'}
      </tbody></table></div>
      ${state.customerMeta ? `<p class="dataset-meta">Exibindo ${state.customerMeta.returned || rows.length} de ${state.customerMeta.total || rows.length} contas retornadas pela API administrativa.</p>` : ''}
    </section>`;
  }

  function workLaneTarget(view, lane, currentStatus = '') {
    if (view === 'support') return lane;
    if (view === 'beta') {
      const laneStatuses = {
        intake: ['new', 'review'],
        contact: ['contact', 'interview'],
        selection: ['approved'],
        onboarding: ['onboarding'],
        active: ['active'],
        done: ['completed', 'converted', 'closed']
      }[lane] || [];
      const allowed = new Set(betaAllowedStatuses(currentStatus));
      return laneStatuses.find((status) => allowed.has(status)) || null;
    }
    return null;
  }

  function filteredWorkCards(mineOnly = false) {
    const query = state.filters.workQuery;
    const owner = state.filters.workOwner;
    return (state.workCards || []).filter((card) => {
      const matchesView = state.workView === 'radar' || card.source === state.workView;
      const matchesQuery = !query || includes(`${card.title} ${card.subtitle} ${card.detail} ${card.assignedTo || ''}`, query);
      const matchesOwner = mineOnly
        ? normalize(card.assignedTo) === normalize(state.user?.email)
        : owner === 'all' || (owner === 'mine' ? normalize(card.assignedTo) === normalize(state.user?.email) : !card.assignedTo);
      return matchesView && matchesQuery && matchesOwner;
    });
  }

  function workCard(card) {
    const canMove = can(card.source === 'support' ? 'support.manage' : 'beta.manage');
    const reasons = (card.reasons || []).slice(0, 2);
    const dueClass = card.dueAt && new Date(card.dueAt) < new Date() ? 'overdue' : '';
    return `<article class='work-card source-${escape(card.source)} ${card.completed ? 'completed' : ''}' draggable='${canMove ? 'true' : 'false'}' data-work-key='${escape(card.key)}'><header><span class='work-source'>${escape(WORK_SOURCE_LABELS[card.source])}</span><strong class='attention-score score-${card.attentionScore >= 80 ? 'critical' : card.attentionScore >= 50 ? 'high' : 'normal'}' title='Pontuação de atenção'>${card.attentionScore}</strong></header><button class='work-card-main' data-action='open-work-item' data-key='${escape(card.key)}'><h3>${escape(card.title)}</h3><p>${escape(card.subtitle)}</p><small>${escape(card.detail || 'Sem detalhe adicional')}</small></button><div class='work-card-signals'>${reasons.map((reason) => `<span>${escape(reason)}</span>`).join('') || `<span class='quiet-signal'>Acompanhamento em dia</span>`}</div><footer><span class='work-owner ${card.assignedTo ? '' : 'unassigned'}'>${card.assignedTo ? `◎ ${escape(card.assignedTo.split('@')[0])}` : '○ Sem responsável'}</span>${card.dueAt ? `<time class='${dueClass}'>${day(card.dueAt)}</time>` : `<time>Sem prazo</time>`}${canMove ? `<button class='icon-button small-work-action' data-action='organize-work' data-key='${escape(card.key)}' aria-label='Organizar card'>•••</button>` : `<span class='read-only-label'>Somente leitura</span>`}</footer></article>`;
  }

  function workboard() {
    const mineOnly = state.section === 'mywork';
    const meta = state.workMeta || { summary: {}, availableBoards: [] };
    const summary = meta.summary || {};
    const available = new Set(meta.availableBoards || []);
    if (state.workView !== 'radar' && !available.has(state.workView)) state.workView = 'radar';
    const laneSets = {
      radar: [
        ['critical', 'Críticos agora', 'Ação imediata'], ['today', 'Para hoje', 'Prioridades do dia'],
        ['week', 'Esta semana', 'Planejamento próximo'], ['waiting', 'Aguardando', 'Sem urgência imediata'], ['done', 'Concluídos', 'Histórico recente']
      ],
      support: [['open', 'Aberto', 'Aguardando atendimento'], ['in_progress', 'Em atendimento', 'Equipe trabalhando'], ['resolved', 'Resolvido', 'Solução entregue'], ['closed', 'Fechado', 'Atendimento encerrado']],
      beta: [['intake', 'Entrada', 'Novas e em análise'], ['contact', 'Contato', 'Contato e entrevista'], ['selection', 'Selecionados', 'Aprovados'], ['onboarding', 'Onboarding', 'Preparando a operação'], ['active', 'Acompanhamento', 'Beta em uso real'], ['done', 'Finalizados', 'Concluídos ou encerrados']]
    };
    const cards = filteredWorkCards(mineOnly);
    const lanes = laneSets[state.workView];
    const laneOf = (card) => state.workView === 'radar' ? card.radarLane : card.nativeLane;
    const tabs = [['radar', 'Radar inteligente'], ...(available.has('support') ? [['support', 'Suporte']] : []), ...(available.has('beta') ? [['beta', 'Programa beta']] : [])];
    return `<section class='page work-center'>${pageHeader(mineOnly ? 'TRABALHO PESSOAL' : 'OPERAÇÃO UNIFICADA', mineOnly ? 'Minha fila' : 'Kanban operacional', mineOnly ? 'Veja apenas os itens atribuídos a você, ordenados pelo que precisa de atenção primeiro.' : 'Priorize o que exige atenção e trabalhe suporte e beta sem perder o contexto de cada módulo.', `<button class='secondary' data-action='reload-workboard'>↻ Atualizar quadro</button>`)}
      <div class='summary-strip work-summary'>${[
        ['Itens ativos', summary.active || 0, 'nos dois fluxos'], ['Críticos agora', summary.critical || 0, 'exigem ação imediata'],
        ['Para hoje', summary.dueToday || 0, 'prioridades do dia'], ['Sem responsável', summary.unassigned || 0, 'precisam de atribuição']
      ].map(([label, value, helper]) => `<div><span>${label}</span><strong>${value}</strong><small>${helper}</small></div>`).join('')}</div>
      <div class='work-controls'><div class='work-tabs' role='tablist' aria-label='Visão do quadro'>${tabs.map(([key, label]) => `<button role='tab' aria-selected='${state.workView === key}' class='${state.workView === key ? 'active' : ''}' data-action='work-view' data-view='${key}'>${label}</button>`).join('')}</div><div class='work-filters'><div class='search-field'><span>⌕</span><input data-search='workQuery' value='${escape(state.filters.workQuery)}' placeholder='Buscar card, cliente ou responsável' /></div>${mineOnly ? `<span class='result-count'>${cards.length} item(ns) atribuído(s) a você</span>` : `<select data-filter='workOwner' aria-label='Filtrar responsável'><option value='all'>Todos os responsáveis</option><option value='mine' ${state.filters.workOwner === 'mine' ? 'selected' : ''}>Minha fila</option><option value='unassigned' ${state.filters.workOwner === 'unassigned' ? 'selected' : ''}>Sem responsável</option></select>`}</div></div>
      <div class='work-intelligence'><i>✦</i><span><strong>Prioridade explicável</strong><small>A pontuação considera urgência, tempo sem movimentação, prazo, etapa e responsável. O ChefOS nunca muda um card sozinho.</small></span></div>
      <div class='kanban-board board-${state.workView}'>${lanes.map(([key, label, helper]) => { const laneCards = cards.filter((card) => laneOf(card) === key).sort((a, b) => state.workView === 'radar' ? b.attentionScore - a.attentionScore : a.position - b.position || b.attentionScore - a.attentionScore); return `<section class='kanban-lane' ${state.workView === 'radar' ? '' : `data-drop-lane='${key}'`}><header><span><h2>${label}</h2><small>${helper}</small></span><b>${laneCards.length}</b></header><div class='kanban-cards'>${laneCards.map(workCard).join('') || `<div class='kanban-empty'><i>✓</i><span>Nenhum item nesta coluna</span></div>`}</div></section>`; }).join('')}</div>
    </section>`;
  }

  function filteredTickets() {
    const query = state.filters.ticket;
    const filter = state.filters.ticketStatus;
    return (state.tickets || []).filter((ticket) => {
      const matchesQuery = !query || includes(`${ticket.subject} ${ticket.client_name} ${ticket.store_name}`, query);
      const matchesStatus = filter === 'all'
        || (filter === 'active' ? !['resolved', 'closed'].includes(ticket.status) : false)
        || (filter === 'completed' ? ['resolved', 'closed'].includes(ticket.status) : ticket.status === filter);
      return matchesQuery && matchesStatus;
    });
  }

  function support() {
    const tickets = filteredTickets();
    if (tickets.length && !tickets.some((ticket) => String(ticket.id) === String(state.selectedTicketId))) state.selectedTicketId = tickets[0].id;
    if (!tickets.length) state.selectedTicketId = '';
    const selected = tickets.find((ticket) => String(ticket.id) === String(state.selectedTicketId));
    const messages = selected?.messages || [];
    const summary = state.ticketSummary || {};
    return `<section class="page support-page">
      ${pageHeader('ATENDIMENTO AO CLIENTE', 'Central de suporte', 'Priorize, responda e acompanhe cada conversa até a resolução.', `<button class="secondary" data-action="reload-tickets">↻ Atualizar fila</button>`)}
      <div class="support-kpis"><div><span>FILA ATIVA</span><strong>${summary.active || 0}</strong><small>chamados para atender</small></div><div><span>PRIORIDADE ALTA</span><strong>${summary.priority || 0}</strong><small>altos e urgentes</small></div><div class="${summary.waitingOver24Hours ? 'danger-text' : ''}"><span>SLA &gt; 24H</span><strong>${summary.waitingOver24Hours || 0}</strong><small>sem atualização</small></div><div><span>TOTAL NA BASE</span><strong>${summary.total || 0}</strong><small>até ${state.ticketMeta?.limit || 250} mais recentes</small></div></div>
      <div class="support-workspace panel">
        <aside class="ticket-queue">
          <div class="queue-head"><div><h2>Caixa de entrada</h2><span>${tickets.filter((ticket) => !['resolved', 'closed'].includes(ticket.status)).length} pendente(s)</span></div><div class="search-field compact"><span>⌕</span><input data-search="ticket" value="${escape(state.filters.ticket)}" placeholder="Buscar chamado" /></div><div class="filter-tabs" role="tablist" aria-label="Status dos chamados">${[['active','Ativos'],['open','Novos'],['completed','Finalizados'],['all','Todos']].map(([key,label]) => `<button role="tab" aria-selected="${state.filters.ticketStatus === key}" class="${state.filters.ticketStatus === key ? 'active' : ''}" data-action="ticket-filter" data-value="${key}">${label}</button>`).join('')}</div></div>
          <div class="queue-list">${tickets.map((ticket) => `<button class="queue-item ${String(ticket.id) === String(state.selectedTicketId) ? 'active' : ''}" data-action="select-ticket" data-id="${ticket.id}"><div><span class="avatar small">${initials(ticket.client_name)}</span><strong>${escape(ticket.client_name)}</strong><time>${relative(ticket.updated_at || ticket.created_at)}</time></div><h3>${escape(ticket.subject || 'Sem assunto')}</h3><p>${escape(ticket.messages?.at(-1)?.text || ticket.store_name || 'Aguardando primeira mensagem')}</p><footer>${priority(ticket.priority)}${sla(ticket)}</footer></button>`).join('') || '<p class="empty">Nenhum chamado nesta fila.</p>'}</div>
        </aside>
        <section class="conversation">${selected ? `<header class="conversation-head"><div><span class="avatar">${initials(selected.client_name)}</span><span><h2>${escape(selected.subject || 'Sem assunto')}</h2><p>${escape(selected.client_name)} · ${escape(selected.store_name || 'Geral')}</p></span></div><div>${priority(selected.priority)}${status(selected.status)}${can('support.manage') && !['resolved', 'closed'].includes(selected.status) ? `<button class="secondary small-button" data-action="resolve-ticket" data-id="${selected.id}">✓ Resolver</button>` : ''}</div></header>
          <div class="conversation-meta"><span><small>CRIADO</small><strong>${date(selected.created_at)}</strong></span><span><small>ÚLTIMA ATUALIZAÇÃO</small><strong>${relative(selected.updated_at || selected.created_at)}</strong></span><span><small>TEMPO NA FILA</small><strong>${sla(selected)}</strong></span><span><small>MENSAGENS</small><strong>${selected.messageCount ?? messages.length}</strong></span></div>
          <div class="messages">${messages.map((message) => `<article class="message ${message.sender_type === 'admin' ? 'mine' : ''}"><span class="message-avatar">${message.sender_type === 'admin' ? 'C' : initials(selected.client_name)}</span><div><header><strong>${message.sender_type === 'admin' ? 'Equipe ChefOS' : escape(selected.client_name)}</strong><time>${date(message.created_at)}</time></header><p>${escape(message.text)}</p></div></article>`).join('') || '<div class="empty-conversation"><i>✦</i><strong>Conversa ainda vazia</strong><small>Envie a primeira resposta para iniciar o atendimento.</small></div>'}</div>
          ${can('support.manage') ? `<form data-form="reply" data-ticket="${selected.id}" class="composer"><textarea name="text" required maxlength="10000" placeholder="Escreva uma resposta para ${escape(selected.client_name)}..."></textarea><div class="composer-hint">Ctrl + Enter para enviar · a resposta fica registrada na auditoria</div><footer><label>Atualizar como <select name="status"><option value="in_progress">Em atendimento</option><option value="resolved">Resolvido</option><option value="open">Aberto</option></select></label><button class="primary" type="submit">Enviar resposta →</button></footer></form>` : `<div class="composer-hint">Você possui acesso somente para leitura deste atendimento.</div>`}` : '<div class="empty-conversation full"><i>✦</i><strong>Selecione um chamado</strong><small>A conversa completa aparecerá aqui.</small></div>'}</section>
      </div>
    </section>`;
  }

  function plans() {
    const activeSubscriptions = state.tenants.map(subscriptionOf).filter((subscription) => subscription?.status === 'active' && subscription.entitlementActive);
    const contractedMonthly = activeSubscriptions.reduce((total, subscription) => total + Number(planById(subscription.plan_id)?.price || 0), 0);
    const integrationGaps = state.plans.filter((plan) => plan.recurring && !plan.preapproval_plan_id).length;
    const planCards = state.plans.map((plan) => {
      const subscribers = activeSubscriptions.filter((subscription) => String(subscription.plan_id) === String(plan.id)).length;
      const linkedSubscriptions = state.tenants.filter((tenant) => String(subscriptionOf(tenant)?.plan_id) === String(plan.id)).length;
      const permissions = (plan.plan_permissions || []).map((permission) => permission.permission_key);
      const billingState = !plan.recurring ? '<span class="billing-state neutral">Pagamento único</span>' : plan.preapproval_plan_id ? '<span class="billing-state ready">Mercado Pago conectado</span>' : '<span class="billing-state warning">Recorrência pendente</span>';
      return `<article class="plan-card ${plan.isMostPopular ? 'featured' : ''}"><header><span><div class="plan-labels"><small>${plan.recurring ? 'ASSINATURA' : 'ACESSO ÚNICO'}</small>${plan.isMostPopular ? '<b>MAIS POPULAR</b>' : ''}</div><h2>${escape(plan.name)}</h2><p>${escape(plan.description || 'Sem descrição comercial.')}</p></span>${can('plans.manage') ? `<button class="row-action" data-action="edit-plan" data-id="${plan.id}">Editar</button>` : '<span class="read-only-label">Somente leitura</span>'}</header><div class="plan-price"><strong>${money(plan.price)}</strong><span>${plan.recurring ? '/ mês' : ' pagamento único'}</span></div>${billingState}<div class="plan-stats"><span><strong>${subscribers}</strong><small>acessos ativos</small></span><span><strong>${plan.max_stores || 1}</strong><small>loja(s) incluída(s)</small></span><span><strong>${permissions.length}</strong><small>módulos</small></span></div><div class="permission-list">${permissions.slice(0, 5).map((key) => `<span>✓ ${escape(permissionLabel(key))}</span>`).join('') || '<span class="muted">Nenhum módulo incluído</span>'}${permissions.length > 5 ? `<small>+ ${permissions.length - 5} módulos incluídos</small>` : ''}</div><footer><span>${plan.trial_period_days || 0} dias de teste</span>${can('plans.manage') ? `<div><button class="text-button" data-action="duplicate-plan" data-id="${plan.id}">Duplicar</button><button class="danger-link" data-action="delete-plan" data-id="${plan.id}" ${linkedSubscriptions ? 'disabled title="Plano com assinaturas vinculadas"' : ''}>Excluir</button></div>` : ''}</footer></article>`;
    }).join('');
    return `<section class="page">${pageHeader('ESTRATÉGIA COMERCIAL', 'Planos e módulos', 'Modele preço, recorrência, limites e acesso sem editar o banco manualmente.', can('plans.manage') ? `<button class="primary" data-action="open-plan">＋ Criar plano</button>` : '')}
      ${integrationGaps ? `<div class="integration-warning"><span>!</span><div><strong>${integrationGaps} plano(s) recorrente(s) sem vínculo de cobrança</strong><p>Adicione o ID do plano de recorrência do Mercado Pago antes de comercializar esses planos.</p></div></div>` : ''}
      <div class="summary-strip"><div><span>Planos no catálogo</span><strong>${state.plans.length}</strong></div><div><span>Acessos ativos</span><strong>${activeSubscriptions.length}</strong></div><div><span>Receita contratada</span><strong>${money(contractedMonthly)}</strong></div><div class="${integrationGaps ? 'warning-text' : ''}"><span>Integrações pendentes</span><strong>${integrationGaps}</strong></div></div>
      <div class="plan-grid">${planCards || '<div class="panel empty">Nenhum plano cadastrado.</div>'}</div></section>`;
  }

  function catalog() {
    const selected = state.tenants.find((tenant) => String(tenant.accountId || tenant.id) === String(state.selectedTenant));
    const customerOptions = state.tenants.map((tenant) => `<option value="${tenant.accountId || tenant.id}" ${String(tenant.accountId || tenant.id) === String(state.selectedTenant) ? 'selected' : ''}>${escape(tenant.full_name)} — ${tenant.stores?.length || 0} loja(s)</option>`).join('');
    const storeOptions = (selected?.stores || []).map((store) => `<option value="${store.storeId || store.id}" ${String(store.storeId || store.id) === String(state.selectedStore) ? 'selected' : ''}>${escape(store.name)}</option>`).join('');
    const query = state.filters.catalog;
    const category = state.filters.catalogCategory;
    const availability = state.filters.catalogStatus;
    const rows = state.menu.filter((item) => {
      const matchesText = !query || includes(`${item.name} ${item.description || ''} ${item.categories?.name || ''} ${item.external_code || ''}`, query);
      const matchesCategory = category === 'all' || String(item.category_id) === String(category);
      const matchesAvailability = availability === 'all' || (availability === 'available' ? item.is_available : !item.is_available);
      return matchesText && matchesCategory && matchesAvailability;
    });
    const meta = state.menuMeta || { total: 0, available: 0, paused: 0, averagePrice: 0 };
    const contextActions = `<div class="catalog-context"><label><span>CLIENTE</span><select data-action="select-tenant" aria-label="Selecionar cliente">${customerOptions}</select></label><label><span>OPERAÇÃO</span><select data-action="select-store" aria-label="Selecionar operação" ${storeOptions ? '' : 'disabled'}>${storeOptions || '<option>Sem loja cadastrada</option>'}</select></label></div>`;
    return `<section class="page">${pageHeader('OPERAÇÃO DO PRODUTO', 'Gestão de cardápios', 'Consulte e edite os itens da loja correta com todas as ações passando pela API.', contextActions)}
      <div class="summary-strip catalog-summary"><div><span>Cliente</span><strong>${escape(selected?.full_name || '—')}</strong></div><div><span>Itens</span><strong>${meta.total || 0}</strong></div><div><span>Disponíveis</span><strong>${meta.available || 0}</strong></div><div><span>Pausados</span><strong>${meta.paused || 0}</strong></div><div><span>Preço médio</span><strong>${money(meta.averagePrice)}</strong></div></div>
      <div class="data-toolbar"><div class="search-field"><span>⌕</span><input data-search="catalog" value="${escape(query)}" placeholder="Buscar item, categoria ou código" /></div><select data-filter="catalogCategory" aria-label="Filtrar categoria"><option value="all">Todas as categorias</option>${state.menuCategories.map((item) => `<option value="${item.id}" ${String(category) === String(item.id) ? 'selected' : ''}>${escape(item.name)}</option>`).join('')}</select><select data-filter="catalogStatus" aria-label="Filtrar disponibilidade"><option value="all" ${availability === 'all' ? 'selected' : ''}>Todos os itens</option><option value="available" ${availability === 'available' ? 'selected' : ''}>Disponíveis</option><option value="paused" ${availability === 'paused' ? 'selected' : ''}>Pausados</option></select>${can('catalog.manage') ? `<button class="primary" data-action="open-catalog-item" ${state.selectedStore ? '' : 'disabled'}>＋ Novo item</button>` : ''}<span class="result-count">${rows.length} resultado(s)</span></div>
      <div class="panel table-wrap"><table><thead><tr><th>Produto</th><th>Categoria</th><th>Preço</th><th>Preparo</th><th>Disponibilidade</th><th></th></tr></thead><tbody>${rows.map((item) => `<tr><td><strong>${escape(item.name)}</strong><small>${escape(item.description || item.external_code || `ID ${String(item.id).slice(0, 8)}`)}</small></td><td>${escape(item.categories?.name || 'Geral')}</td><td><strong>${money(item.price)}</strong></td><td><strong>${item.prep_time_in_minutes || 0} min</strong></td><td><span class="availability ${item.is_available ? 'on' : 'off'}"><i></i>${item.is_available ? 'Disponível' : 'Pausado'}</span></td><td>${can('catalog.manage') ? `<div class="row-actions"><button class="row-action" data-action="edit-catalog-item" data-id="${item.id}">Editar</button><button class="row-action" data-action="toggle-menu" data-id="${item.id}" data-available="${item.is_available}">${item.is_available ? 'Pausar' : 'Ativar'}</button></div>` : '<span class="read-only-label">Somente leitura</span>'}</td></tr>`).join('') || `<tr><td colspan="6" class="empty">${state.selectedStore ? 'Nenhum item encontrado nesta operação.' : 'Selecione um cliente com loja para gerenciar o cardápio.'}</td></tr>`}</tbody></table></div>
    </section>`;
  }

  function provision() {
    return `<section class="page onboarding-page">${pageHeader('NOVO CLIENTE', 'Onboarding ChefOS', 'Crie a conta, a operação e o acesso inicial em um único fluxo.', '')}
      <div class="onboarding-layout"><aside class="onboarding-steps"><span class="active"><i>1</i><strong>Criar acesso</strong><small>Nome, e-mail e senha</small></span><span><i>2</i><strong>Configurar operação</strong><small>Empresa e loja principal</small></span><span><i>3</i><strong>Ativar plano</strong><small>Teste, módulos e estrutura</small></span><div class="onboarding-note"><strong>Sem UUID manual</strong><p>A API cria a conta no Supabase Auth e usa o identificador internamente. Se o e-mail já existir, a conta é reutilizada sem trocar sua senha.</p></div></aside>
        <form class="panel onboarding-form" data-form="provision"><div class="onboarding-intro"><span>✦</span><div><strong>Ativação completa em uma ação</strong><p>Ao finalizar, o cliente poderá entrar no ChefOS com o e-mail e a senha inicial definidos abaixo.</p></div></div><div class="form-section"><span class="section-number">01</span><div><h2>Acesso do proprietário</h2><p class="muted">Estes dados criam a conta real do cliente.</p></div></div><div class="form-grid"><label>Nome completo<input name="fullName" required maxlength="160" autocomplete="off" placeholder="Ex.: Mariana Costa" /></label><label>E-mail de acesso<input name="email" type="email" required maxlength="254" autocomplete="off" placeholder="mariana@restaurante.com" /></label><label class="wide password-field">Senha inicial<span><input name="initialPassword" type="text" required minlength="10" maxlength="128" autocomplete="off" placeholder="Mínimo de 10 caracteres" /><button type="button" class="secondary" data-action="generate-password">Gerar senha segura</button></span><small>Guarde esta senha para entregar ao cliente. Ela não será salva no painel.</small></label></div><hr/><div class="form-section"><span class="section-number">02</span><div><h2>Empresa e operação</h2><p class="muted">Dados usados na loja principal e no perfil empresarial.</p></div></div><div class="form-grid"><label>Nome da operação<input name="storeName" required maxlength="180" placeholder="Ex.: Bistrô Central" /></label><label>CNPJ<input name="cnpj" required maxlength="30" placeholder="00.000.000/0001-00" /></label><label>Telefone<input name="phone" maxlength="40" placeholder="(00) 00000-0000" /></label><label>Endereço<input name="address" maxlength="300" placeholder="Rua, número, bairro e cidade" /></label></div><hr/><div class="form-section"><span class="section-number">03</span><div><h2>Plano e ativação</h2><p class="muted">O período de teste e os limites seguem o plano selecionado.</p></div></div><label>Plano ChefOS<select name="planId" required><option value="">Selecione o plano</option>${state.plans.map((plan) => `<option value="${plan.id}">${escape(plan.name)} — ${money(plan.price)}${plan.recurring ? '/mês' : ''} · ${plan.trial_period_days || 0} dias de teste</option>`).join('')}</select></label><label class="confirmation-check"><input type="checkbox" name="confirm" required /><span><strong>Confirmo a criação desta conta e estrutura</strong><small>Será criado o usuário, perfil, loja, assinatura, módulos, salão e seis mesas.</small></span></label><footer><span><i>✓</i> Todo o fluxo usa APIs administrativas auditadas</span><button class="primary" type="submit">Criar cliente e ativar ChefOS →</button></footer></form>
      </div></section>`;
  }

  function legacyHealth() {
    const data = state.health || {};
    const healthy = data.status === 'healthy';
    return `<section class="page">${pageHeader('OBSERVABILIDADE', 'Saúde do sistema', 'Conectividade, ambiente e desempenho dos serviços administrativos.', `<button class="secondary" data-action="reload-health">↻ Executar verificação</button>`)}
      <div class="health-hero ${healthy ? 'healthy' : 'degraded'}"><div><i>${healthy ? '✓' : '!'}</i><span><small>STATUS GERAL</small><strong>${healthy ? 'Tudo operacional' : 'Atenção necessária'}</strong><p>${healthy ? 'Os serviços principais responderam normalmente.' : 'Uma ou mais verificações precisam de atenção.'}</p></span></div><span><small>LATÊNCIA TOTAL</small><strong>${data.latencyMs ?? '—'} ms</strong></span></div>
      <div class="check-grid">${Object.entries(data.checks || {}).map(([name, check]) => `<article class="panel check-card"><header><span class="check-icon ${check.status}">${check.status === 'ok' ? '✓' : '!'}</span>${status(check.status === 'ok' ? 'active' : 'past_due')}</header><h2>${escape(name)}</h2><p>${escape(check.message || '')}</p><footer><span>Latência</span><strong>${check.latencyMs ?? '—'} ms</strong></footer></article>`).join('') || '<div class="panel empty">Execute a verificação para carregar os serviços.</div>'}</div>
      ${data.system ? `<div class="panel system-info"><div><span>Node.js</span><strong>${escape(data.system.nodeVersion)}</strong></div><div><span>Uptime</span><strong>${data.system.uptimeSeconds}s</strong></div><div><span>Memória</span><strong>${data.system.memoryUsageMB} MB</strong></div><div><span>Última verificação</span><strong>${date(data.timestamp)}</strong></div></div>` : ''}
    </section>`;
  }

  function legacyLogs() {
    return `<section class="page">${pageHeader('GOVERNANÇA', 'Auditoria do sistema', 'Últimos eventos registrados pelas operações administrativas.', `<button class="secondary" data-action="reload-logs">↻ Atualizar eventos</button>`)}
      <div class="panel timeline">${(state.logs || []).map((log) => `<article><span class="timeline-dot"></span><div><header><strong>${escape(log.action || log.event_type || 'Evento')}</strong><time>${date(log.created_at)}</time></header><p>${escape(typeof log.details === 'object' ? JSON.stringify(log.details) : log.description || log.details || 'Sem descrição adicional')}</p></div></article>`).join('') || '<p class="empty">Nenhum evento de auditoria encontrado.</p>'}</div>
    </section>`;
  }

  function legacyAdministrators() {
    return `<section class="page">${pageHeader('SEGURANÇA E ACESSO', 'Administradores', 'Controle quem pode operar o Control Center do ChefOS.', '')}
      <div class="access-layout"><div class="panel"><div class="panel-heading"><div><p class="eyebrow">EQUIPE</p><h2>Acessos ativos</h2></div><span class="count-badge">${state.admins?.length || 0}</span></div><div class="admin-list">${(state.admins || []).map((admin) => `<div><span class="avatar">${initials(admin.email)}</span><span><strong>${escape(admin.email)}</strong><small>${admin.protected ? 'Administrador raiz' : 'Administrador'} · desde ${day(admin.created_at)}</small></span>${admin.protected ? '<span class="root-badge">Protegido</span>' : `<button class="danger-link" data-action="delete-admin" data-email="${escape(admin.email)}">Remover</button>`}</div>`).join('') || '<p class="empty">Nenhum administrador encontrado.</p>'}</div></div>
        <form class="panel invite-card" data-form="admin"><span class="invite-icon">＋</span><p class="eyebrow">NOVO ACESSO</p><h2>Adicionar administrador</h2><p class="muted">O usuário precisa existir no Supabase Auth para conseguir entrar.</p><label>E-mail corporativo<input name="email" type="email" required placeholder="nome@chefos.online" /></label><button class="primary" type="submit">Autorizar acesso</button></form></div>
    </section>`;
  }

  function healthCheckCard(item) {
    const action = item.action?.section
      ? `<button class='text-button' data-action='health-navigate' data-section='${escape(item.action.section)}' data-filter='${escape(item.action.filter || '')}'>Investigar →</button>`
      : '';
    return `<article class='health-check health-${escape(item.status)}'><span class='health-check-icon'>${item.status === 'ok' ? '✓' : item.status === 'unknown' ? '?' : '!'}</span><div><header><strong>${escape(item.label)}</strong><span>${escape(healthStatusLabel(item.status))}</span></header><p>${escape(item.message || '')}</p>${item.latencyMs !== undefined ? `<small>${item.latencyMs} ms</small>` : item.value !== undefined ? `<small>Valor observado: ${item.value}</small>` : ''}</div>${action}</article>`;
  }

  function health() {
    const data = state.health || {};
    const labels = {
      healthy: ['Tudo operacional', 'Os fluxos essenciais responderam normalmente.', '✓'],
      attention: ['Pontos de atenção', 'Existem configurações ou indicadores que merecem acompanhamento.', '!'],
      degraded: ['Operação degradada', 'Um ou mais fluxos do ChefOS precisam de intervenção.', '!'],
      critical: ['Incidente crítico', 'Um serviço essencial não respondeu corretamente.', '!'],
      unknown: ['Estado desconhecido', 'Ainda não existem informações suficientes para o diagnóstico.', '?']
    };
    const hero = labels[data.status] || labels.unknown;
    const summary = data.summary || { operational: 0, attention: 0, degraded: 0, total: 0 };
    const groups = [
      ['core', 'Infraestrutura', 'Banco, autenticação e configuração administrativa.'],
      ['business', 'Saúde do negócio', 'Assinaturas, cobranças, integrações e suporte.'],
      ['security', 'Segurança', 'Acessos privilegiados, MFA e modelo de autorização.']
    ];
    return `<section class='page health-center'>${pageHeader('CENTRO DE CONFIABILIDADE', 'Saúde do ChefOS', 'Disponibilidade técnica, fluxos do negócio e segurança em uma única visão.', can('health.run') ? `<button class='primary' data-action='reload-health'>↻ Executar diagnóstico</button>` : '')}
      <div class='health-hero health-overall-${escape(data.status || 'unknown')}'><div><i>${hero[2]}</i><span><small>STATUS GERAL</small><strong>${hero[0]}</strong><p>${hero[1]}</p></span></div><span><small>ÚLTIMA VERIFICAÇÃO</small><strong>${data.timestamp ? relative(data.timestamp) : '—'}</strong><p>${data.latencyMs ?? '—'} ms · deploy ${escape(data.system?.deployment || 'local')}</p></span></div>
      <div class='summary-strip health-summary'><div><span>Verificações</span><strong>${summary.total}</strong></div><div><span>Operacionais</span><strong class='success-text'>${summary.operational}</strong></div><div><span>Atenção</span><strong class='warning-text'>${summary.attention}</strong></div><div><span>Degradadas</span><strong class='danger-text'>${summary.degraded}</strong></div></div>
      <div class='health-domain-grid'>${groups.map(([key, title, description]) => `<section class='panel health-domain'><header><span><p class='eyebrow'>${escape(key.toUpperCase())}</p><h2>${title}</h2><small>${description}</small></span><b>${data.groups?.[key]?.length || 0}</b></header><div>${(data.groups?.[key] || []).map(healthCheckCard).join('') || `<p class='empty'>Sem verificações disponíveis.</p>`}</div></section>`).join('')}</div>
      <div class='health-lower-grid'><section class='panel health-history'><div class='panel-heading'><div><p class='eyebrow'>HISTÓRICO</p><h2>Últimos diagnósticos</h2></div><span class='count-badge'>${data.history?.length || 0}</span></div><div class='health-history-track'>${(data.history || []).map((item) => `<span class='history-${escape(item.overall_status)}' title='${escape(`${date(item.checked_at)} · ${healthStatusLabel(item.overall_status)}`)}'><i></i><small>${day(item.checked_at)}</small></span>`).join('') || `<p class='empty'>O histórico começa após o primeiro diagnóstico manual.</p>`}</div></section><section class='panel incident-list'><div class='panel-heading'><div><p class='eyebrow'>INCIDENTES</p><h2>Acompanhamento ativo</h2></div><span class='count-badge'>${data.incidents?.length || 0}</span></div>${(data.incidents || []).map((incident) => `<article><span class='severity severity-${escape(incident.severity)}'>${escape(incident.severity)}</span><div><strong>${escape(incident.title)}</strong><small>${escape(incident.service)} · iniciado ${relative(incident.started_at)}</small></div><span>${escape(incident.status)}</span></article>`).join('') || `<div class='all-clear'><i>✓</i><span><strong>Nenhum incidente aberto</strong><small>A operação não possui incidentes registrados.</small></span></div>`}</section></div>
    </section>`;
  }

  function auditDescription(event) {
    if (event.reason) return event.reason;
    const target = [event.target_type, event.target_id].filter(Boolean).join(' · ');
    if (target) return target;
    if (event.metadata?.description) return event.metadata.description;
    return 'Evento administrativo registrado com sucesso.';
  }

  function logs() {
    const payload = state.logs || { data: [], summary: {}, meta: {}, catalogs: {} };
    const summary = payload.summary || {};
    const meta = payload.meta || { page: 1, pages: 1, total: 0 };
    const filters = state.filters;
    return `<section class='page audit-center'>${pageHeader('GOVERNANÇA E CONTROLE', 'Auditoria administrativa', 'Descubra quem fez o quê, quando, onde e com qual resultado.', `<button class='secondary' data-action='export-audit' ${can('audit.export') ? '' : 'disabled'}>↓ Exportar CSV</button><button class='secondary' data-action='reload-logs'>↻ Atualizar</button>`)}
      ${meta.legacy ? `<div class='migration-banner'><i>!</i><span><strong>Auditoria em modo de compatibilidade</strong><small>Aplique a migração para habilitar filtros estruturados, antes/depois e resultado das operações.</small></span></div>` : ''}
      <div class='summary-strip audit-summary'><div><span>Eventos encontrados</span><strong>${summary.total || 0}</strong></div><div><span>Alto risco nesta página</span><strong class='danger-text'>${summary.highRisk || 0}</strong></div><div><span>Falhas e bloqueios</span><strong class='warning-text'>${summary.failures || 0}</strong></div><div><span>Atores nesta página</span><strong>${summary.actors || 0}</strong></div></div>
      <form class='panel audit-filters' data-form='audit-filter'><label class='audit-search'><span>⌕</span><input name='q' value='${escape(filters.auditQuery)}' placeholder='Buscar ação, recurso ou identificador' /></label><select name='category' aria-label='Categoria'><option value='all'>Todas as categorias</option>${(payload.catalogs?.categories || []).map((item) => `<option value='${escape(item.key)}' ${filters.auditCategory === item.key ? 'selected' : ''}>${escape(item.label)}</option>`).join('')}</select><select name='outcome' aria-label='Resultado'><option value='all'>Todos os resultados</option><option value='success' ${filters.auditOutcome === 'success' ? 'selected' : ''}>Sucesso</option><option value='failure' ${filters.auditOutcome === 'failure' ? 'selected' : ''}>Falha</option><option value='blocked' ${filters.auditOutcome === 'blocked' ? 'selected' : ''}>Bloqueado</option></select><input name='actor' value='${escape(filters.auditActor)}' placeholder='E-mail do ator' /><label class='date-filter'>De<input name='from' type='date' value='${escape(filters.auditFrom)}' /></label><label class='date-filter'>Até<input name='to' type='date' value='${escape(filters.auditTo)}' /></label><button class='primary' type='submit'>Aplicar filtros</button><button class='text-button' type='button' data-action='clear-audit-filters'>Limpar</button></form>
      <div class='panel table-wrap audit-table'><table><thead><tr><th>Data e hora</th><th>Evento</th><th>Ator</th><th>Categoria</th><th>Resultado</th><th>Risco</th><th></th></tr></thead><tbody>${(payload.data || []).map((event) => `<tr><td><strong>${date(event.created_at)}</strong><small>${event.request_id ? `Req. ${escape(String(event.request_id).slice(0, 12))}` : 'Sem correlação'}</small></td><td><strong>${escape(event.actionLabel || event.action)}</strong><small>${escape(auditDescription(event))}</small></td><td><strong>${escape(event.actor_email || 'Não identificado')}</strong><small>${event.target_type ? `${escape(event.target_type)} · ${escape(event.target_id || '—')}` : 'Ação administrativa'}</small></td><td><span class='category-pill'>${escape(event.categoryLabel || event.category)}</span></td><td><span class='outcome outcome-${escape(event.outcome)}'>${escape(auditOutcomeLabel(event.outcome))}</span></td><td><span class='severity severity-${escape(event.severity)}'>${escape(event.severity || 'low')}</span></td><td><button class='row-action' data-action='view-audit' data-id='${escape(event.id)}'>Detalhes</button></td></tr>`).join('') || `<tr><td colspan='7' class='empty'>Nenhum evento corresponde aos filtros.</td></tr>`}</tbody></table></div>
      <footer class='pagination'><span>Página ${meta.page || 1} de ${meta.pages || 1} · ${meta.total || 0} evento(s)</span><div><button class='secondary' data-action='audit-page' data-page='${Math.max(1, (meta.page || 1) - 1)}' ${(meta.page || 1) <= 1 ? 'disabled' : ''}>← Anterior</button><button class='secondary' data-action='audit-page' data-page='${Math.min(meta.pages || 1, (meta.page || 1) + 1)}' ${(meta.page || 1) >= (meta.pages || 1) ? 'disabled' : ''}>Próxima →</button></div></footer>
    </section>`;
  }

  function administrators() {
    const summary = state.adminSummary || { total: state.admins?.length || 0, active: 0, invited: 0, suspended: 0, withoutMfa: 0 };
    const canManage = Boolean(state.adminMeta?.canManage && can('access.manage'));
    return `<section class='page access-center'>${pageHeader('IDENTIDADE E SEGURANÇA', 'Acessos administrativos', 'Gerencie o ciclo de vida da equipe, funções e segundo fator.', '')}
      ${state.adminMeta?.legacySchema ? `<div class='migration-banner critical'><i>!</i><span><strong>Proteção avançada ainda não aplicada no banco</strong><small>O painel está compatível, mas papéis, suspensão e bloqueio direto por RLS dependem da migração SQL.</small></span></div>` : ''}
      <div class='summary-strip access-summary'><div><span>Total da equipe</span><strong>${summary.total || 0}</strong></div><div><span>Ativos</span><strong class='success-text'>${summary.active || 0}</strong></div><div><span>Convites pendentes</span><strong>${summary.invited || 0}</strong></div><div><span>Suspensos</span><strong class='warning-text'>${summary.suspended || 0}</strong></div><div><span>Privilegiados sem MFA</span><strong class='danger-text'>${summary.withoutMfa || 0}</strong></div></div>
      <div class='access-workspace'><section class='panel access-team'><div class='panel-heading'><div><p class='eyebrow'>EQUIPE ADMINISTRATIVA</p><h2>Pessoas e permissões</h2></div><span class='count-badge'>${state.admins?.length || 0}</span></div><div class='access-table'>${(state.admins || []).map((admin) => `<article><span class='avatar'>${initials(admin.display_name || admin.email)}</span><div class='access-person'><strong>${escape(admin.display_name || admin.email.split('@')[0])}</strong><small>${escape(admin.email)}</small></div><div><small>FUNÇÃO</small><strong>${escape(roleLabel(admin.role))}</strong></div><div><small>STATUS</small><span class='access-status access-${escape(admin.status)}'><i></i>${escape(accessStatusLabel(admin.status))}</span></div><div><small>SEGURANÇA</small><span class='mfa-state ${admin.mfaEnabled ? 'enabled' : 'missing'}'>${admin.mfaEnabled ? '✓ MFA ativo' : admin.mfa_required ? '! MFA pendente' : 'MFA opcional'}</span></div><div><small>ÚLTIMA ATIVIDADE</small><strong>${relative(admin.last_sign_in_at || admin.last_seen_at)}</strong></div>${admin.protected ? `<span class='root-badge'>Raiz protegido</span>` : canManage && (admin.role !== 'owner' || state.adminMeta?.canManageOwners) ? `<button class='row-action' data-action='manage-admin' data-email='${escape(admin.email)}'>Gerenciar</button>` : `<span class='read-only-label'>Somente leitura</span>`}</article>`).join('') || `<p class='empty'>Nenhum administrador encontrado.</p>`}</div></section>
        ${canManage ? `<form class='panel invite-card access-invite' data-form='admin'><span class='invite-icon'>＋</span><p class='eyebrow'>NOVO ACESSO</p><h2>Convidar para a equipe</h2><p class='muted'>O ChefOS enviará um convite real e registrará a concessão na auditoria.</p><label>Nome completo<input name='displayName' required maxlength='160' placeholder='Ex.: Ana Martins' /></label><label>E-mail corporativo<input name='email' type='email' required maxlength='254' placeholder='ana@chefos.online' /></label><label>Função<select name='role' required>${state.adminRoles.map((role) => `<option value='${escape(role.key)}'>${escape(role.label)} — ${escape(role.description)}</option>`).join('') || `<option value='support'>Suporte</option>`}</select></label><label>Motivo do acesso<textarea name='reason' required minlength='5' maxlength='500' placeholder='Ex.: nova responsável pelo atendimento'></textarea></label><label class='confirmation-check'><input type='checkbox' name='mfaRequired' checked /><span><strong>Exigir segundo fator</strong><small>Obrigatório para funções privilegiadas.</small></span></label><button class='primary' type='submit'>Enviar convite seguro →</button></form>` : `<aside class='panel invite-card access-invite'><p class='eyebrow'>SOMENTE LEITURA</p><h2>Gestão protegida</h2><p class='muted'>Seu perfil pode consultar a equipe, mas apenas responsáveis autorizados podem conceder ou alterar acessos.</p></aside>`}</div>
    </section>`;
  }

  function beta() {
    const allRows = state.betaApplications || [];
    const query = state.filters.betaQuery;
    const rows = allRows.filter((item) => {
      const matchesQuery = !query || includes(`${item.restaurant_name} ${item.name} ${item.email} ${item.phone || ''}`, query);
      const matchesStatus = state.filters.betaStatus === 'all' || item.status === state.filters.betaStatus;
      const matchesAttention = state.filters.betaAttention === 'all' || (state.filters.betaAttention === 'attention' ? betaNeedsAttention(item) : !betaNeedsAttention(item));
      return matchesQuery && matchesStatus && matchesAttention;
    });
    const participants = allRows.filter((item) => item.participant);
    const activeParticipants = participants.filter((item) => item.participant?.status === 'active').length;
    const onboardingParticipants = participants.filter((item) => item.participant?.status === 'onboarding').length;
    const awaitingReview = allRows.filter((item) => ['new', 'review'].includes(item.status)).length;
    const attentionCount = allRows.filter(betaNeedsAttention).length;
    const endingSoon = participants.filter((item) => {
      const remaining = betaRemainingDays(item.participant);
      return remaining !== null && remaining >= 0 && remaining <= 21;
    }).length;
    return `<section class='page beta-center'>${pageHeader('PARCEIROS FUNDADORES', 'Operação do beta', 'Organize a seleção, registre cada contato e acompanhe os restaurantes durante os 90 dias.', `<button class='secondary' data-action='reload-beta'>↻ Atualizar</button>`)}
      <div class='summary-strip beta-operational-summary'>${[
        ['Aguardando triagem', awaitingReview, 'novas candidaturas ou em análise'],
        ['Precisam de atenção', attentionCount, 'sem movimentação há 3 dias ou mais'],
        ['Em onboarding', onboardingParticipants, 'preparando o início da operação'],
        ['Ativos no beta', activeParticipants, 'usando o ChefOS em operação real']
      ].map(([label, value, helper]) => `<div><span>${label}</span><strong>${value}</strong><small>${helper}</small></div>`).join('')}</div>
      <div class='data-toolbar beta-toolbar'><div class='search-field'><span>⌕</span><input data-search='betaQuery' value='${escape(query)}' placeholder='Buscar restaurante, responsável ou contato' /></div><select data-filter='betaStatus' aria-label='Filtrar etapa'><option value='all'>Todas as etapas</option>${BETA_STAGES.map((key) => `<option value='${key}' ${state.filters.betaStatus === key ? 'selected' : ''}>${BETA_STAGE_LABELS[key]}</option>`).join('')}</select><select data-filter='betaAttention' aria-label='Filtrar atenção'><option value='all'>Todos os acompanhamentos</option><option value='attention' ${state.filters.betaAttention === 'attention' ? 'selected' : ''}>Precisam de atenção</option><option value='current' ${state.filters.betaAttention === 'current' ? 'selected' : ''}>Acompanhamento em dia</option></select><span class='result-count'>${rows.length} de ${allRows.length}</span></div>
      <div class='panel table-wrap beta-table'><table><thead><tr><th>Restaurante</th><th>Responsável</th><th>Etapa</th><th>Última movimentação</th><th>Acompanhamento</th><th></th></tr></thead><tbody>${rows.map((item) => { const latest = betaLatestEvent(item); return `<tr><td><strong>${escape(item.restaurant_name)}</strong><small>${escape(item.establishment_type || item.restaurant_size || 'Perfil não informado')}</small></td><td><strong>${escape(item.name)}</strong><small>${escape(item.email)}${item.phone ? ` · ${escape(item.phone)}` : ''}</small></td><td>${betaStageSignal(item.status)}</td><td><strong>${day(latest?.created_at || item.updated_at || item.submitted_at)}</strong><small>${latest?.note ? escape(latest.note) : escape(BETA_STAGE_LABELS[latest?.to_status] || 'Candidatura recebida')}</small></td><td>${betaNeedsAttention(item) ? `<span class='health-signal warning'><i></i>Retomar contato</span>` : `<span class='health-signal success'><i></i>Em dia</span>`}</td><td><button class='row-action' data-action='open-beta' data-id='${escape(item.id)}'>Abrir ficha</button></td></tr>`; }).join('') || `<tr><td colspan='6' class='empty'>Nenhuma candidatura corresponde aos filtros.</td></tr>`}</tbody></table></div>
      <div class='panel table-wrap beta-participants'><div class='panel-heading'><div><p class='eyebrow'>CICLO DE 90 DIAS</p><h2>Participantes do programa</h2><p class='muted'>Acompanhe quem está preparando a entrada, em uso real ou perto do encerramento.</p></div><span class='count-badge'>${participants.length}</span></div><table><thead><tr><th>Restaurante</th><th>Coorte</th><th>Situação</th><th>Ativação</th><th>Fim do beta</th><th>Saúde</th><th></th></tr></thead><tbody>${participants.map((item) => `<tr><td><strong>${escape(item.restaurant_name)}</strong><small>${escape(item.name)} · ${escape(item.email)}</small></td><td><strong>${escape(item.participant?.cohort || 'founders-2026')}</strong><small>Grupo do programa</small></td><td>${betaParticipantStatusSignal(item.participant?.status)}</td><td><strong>${item.participant?.activated_at ? day(item.participant.activated_at) : 'Aguardando ativação'}</strong><small>${item.participant?.activated_at ? relative(item.participant.activated_at) : 'Início operacional pendente'}</small></td><td><strong>${item.participant?.beta_ends_at ? day(item.participant.beta_ends_at) : '—'}</strong><small>${item.participant?.beta_ends_at ? relative(item.participant.beta_ends_at) : '90 dias após a ativação'}</small></td><td>${betaParticipantHealthSignal(item.participant)}</td><td><button class='row-action' data-action='open-beta' data-id='${escape(item.id)}'>Detalhes</button></td></tr>`).join('') || `<tr><td colspan='7' class='empty'>Nenhum participante criado ainda.</td></tr>`}</tbody></table></div>
    </section>`;
  }

  function activePage() {
    const pages = { overview, mywork: workboard, workboard, subscriptions, tenants, beta, support, plans, catalog, provision, health, logs, administrators };
    return (pages[state.section] || overview)();
  }

  function subscriptionModal(tenant) {
    const subscription = subscriptionOf(tenant) || {};
    const accountId = tenant.accountId || tenant.id;
    return `<div class="modal-shell" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button class="modal-backdrop" data-action="close-modal" aria-label="Fechar"></button><form class="modal-card" data-form="subscription"><header><div><p class="eyebrow">GESTÃO DE ACESSO</p><h2 id="modal-title">Assinatura de ${escape(tenant.full_name)}</h2><p>${escape(tenant.email)}</p></div><button type="button" class="icon-button" data-action="close-modal" aria-label="Fechar">×</button></header><div class="modal-body"><input type="hidden" name="accountId" value="${accountId}"/><div class="modal-alert"><strong>Atenção à cobrança</strong><p>Esta ação altera o acesso interno. A recorrência do Mercado Pago ainda precisa ser gerenciada separadamente.</p></div><label>Status<select name="status" required><option value="active" ${subscription.status === 'active' ? 'selected' : ''}>Ativa</option><option value="trialing" ${subscription.status === 'trialing' ? 'selected' : ''}>Em teste</option><option value="past_due" ${subscription.status === 'past_due' ? 'selected' : ''}>Inadimplente</option><option value="unpaid" ${subscription.status === 'unpaid' ? 'selected' : ''}>Não paga</option><option value="canceled" ${subscription.status === 'canceled' ? 'selected' : ''}>Cancelada</option></select></label><label>Plano<select name="planId" required>${state.plans.map((plan) => `<option value="${plan.id}" ${String(subscription.plan_id) === String(plan.id) ? 'selected' : ''}>${escape(plan.name)} — ${money(plan.price)}/mês</option>`).join('')}</select></label><label>Fim do período atual<input name="currentPeriodEnd" type="date" value="${toInputDate(subscription.current_period_end)}" ${subscription.id ? '' : 'required'} /></label><label>Motivo da alteração<textarea name="reason" required minlength="5" maxlength="500" placeholder="Ex.: pagamento confirmado manualmente pelo financeiro"></textarea></label><div class="modal-summary"><span><small>SAÚDE DO ACESSO</small><strong>${entitlement(subscription)}</strong></span><span><small>VALOR DO PLANO</small><strong>${money(planById(subscription.plan_id)?.price)}</strong></span></div></div><footer><button type="button" class="secondary" data-action="close-modal">Cancelar</button><button class="primary" type="submit">Salvar com auditoria</button></footer></form></div>`;
  }

  function tenantModal(tenant) {
    const subscription = subscriptionOf(tenant) || {};
    const plan = planById(subscription.plan_id);
    const accountId = tenant.accountId || tenant.id;
    const missingLabels = { store: 'Criar loja principal', company_profile: 'Completar perfil da empresa', company_data: 'Completar dados fiscais da empresa', subscription: 'Configurar assinatura' };
    return `<div class="modal-shell drawer-shell" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><button class="modal-backdrop" data-action="close-modal" aria-label="Fechar"></button><aside class="detail-drawer"><header><div class="avatar large">${initials(tenant.full_name)}</div><button class="icon-button" data-action="close-modal" aria-label="Fechar">×</button></header><div class="drawer-title"><p class="eyebrow">VISÃO 360º DO CLIENTE</p><h2 id="drawer-title">${escape(tenant.full_name)}</h2><p>${escape(tenant.email)}</p><div class="drawer-signals">${subscription ? status(subscription.status) : status('unknown')}${entitlement(subscription)}${onboarding(tenant)}</div></div><div class="detail-grid"><span><small>PLANO</small><strong>${escape(plan?.name || 'Sem plano')}</strong></span><span><small>VALOR CONTRATADO</small><strong>${money(plan?.price)}</strong></span><span><small>CLIENTE DESDE</small><strong>${day(tenant.created_at)}</strong></span><span><small>ÚLTIMO ACESSO</small><strong>${relative(tenant.last_sign_in_at || tenant.updated_at)}</strong></span><span><small>CHAMADOS ABERTOS</small><strong>${tenant.support?.openTickets || 0}</strong></span><span><small>PRIORITÁRIOS</small><strong>${tenant.support?.urgentTickets || 0}</strong></span></div>${tenant.onboarding?.missing?.length ? `<section class="drawer-checklist"><div class="panel-heading"><h3>Próximas ações</h3><span class="count-badge">${tenant.onboarding.missing.length}</span></div>${tenant.onboarding.missing.map((item) => `<div><i>!</i><span><strong>${escape(missingLabels[item] || item)}</strong><small>Necessário para concluir o onboarding</small></span></div>`).join('')}</section>` : '<div class="drawer-all-clear"><i>✓</i><span><strong>Onboarding completo</strong><small>Estrutura mínima pronta para operar.</small></span></div>'}<section><div class="panel-heading"><h3>Operações</h3><span class="count-badge">${tenant.stores?.length || 0}</span></div><div class="store-list">${(tenant.stores || []).map((store) => `<div><span>◫</span><span><strong>${escape(store.name)}</strong><small>ID ${escape(String(store.storeId || store.id).slice(0, 8))} · criada em ${day(store.created_at)}</small></span></div>`).join('') || '<p class="empty">Nenhuma operação vinculada.</p>'}</div></section><footer>${can('subscriptions.manage') ? `<button class="secondary" data-action="edit-subscription" data-id="${accountId}">Gerenciar assinatura</button>` : ''}${can('catalog.read') ? `<button class="primary" data-action="tenant-catalog" data-id="${accountId}">Ver cardápio</button>` : ''}</footer></aside></div>`;
  }

  function planModal() {
    const source = state.modal?.id ? state.plans.find((plan) => String(plan.id) === String(state.modal.id)) : null;
    const duplicate = Boolean(state.modal?.duplicate);
    const editing = Boolean(source && !duplicate);
    const selectedPermissions = new Set((source?.plan_permissions || []).map((permission) => permission.permission_key));
    const catalogKeys = new Set(permissionDefinitions().map((permission) => permission.key));
    const legacyPermissions = [...selectedPermissions].filter((key) => !catalogKeys.has(key));
    const selectedCount = selectedPermissions.size;
    const name = duplicate ? `${source?.name || ''} Cópia` : source?.name || '';
    const slug = duplicate ? `${source?.slug || 'plano'}-copia` : source?.slug || '';
    const recurring = source ? source.recurring !== false : true;
    const preapprovalPlanId = duplicate ? '' : source?.preapproval_plan_id || '';
    const permissionGroups = state.permissionCatalog.map((group) => {
      const groupSelected = group.permissions.filter((permission) => selectedPermissions.has(permission.key)).length;
      return `<section class="permission-group" data-permission-group="${escape(group.id)}"><header><span><strong>${escape(group.name)}</strong><small>${escape(group.description)}</small></span><span><b data-permission-group-count>${groupSelected}/${group.permissions.length}</b><button type="button" data-action="toggle-permission-group">${groupSelected === group.permissions.length ? 'Desmarcar grupo' : 'Selecionar grupo'}</button></span></header><div class="permission-options">${group.permissions.map((permission) => `<label class="permission-option" data-permission-text="${escape(`${permission.name} ${permission.description} ${group.name}`)}"><input type="checkbox" name="permissions" value="${escape(permission.key)}" ${selectedPermissions.has(permission.key) ? 'checked' : ''}/><i>✓</i><span><strong>${escape(permission.name)}</strong><small>${escape(permission.description)}</small></span></label>`).join('')}</div></section>`;
    }).join('');
    const preservedLegacy = legacyPermissions.map((key) => `<input type="hidden" name="permissions" value="${escape(key)}"/>`).join('');
    return `<div class="modal-shell" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button class="modal-backdrop" data-action="close-modal" aria-label="Fechar"></button><form class="modal-card large-modal plan-modal" data-form="plan"><header><div><p class="eyebrow">CATÁLOGO COMERCIAL</p><h2 id="modal-title">${editing ? `Editar ${escape(source.name)}` : duplicate ? 'Duplicar plano' : 'Criar novo plano'}</h2><p>Configure a oferta comercial e escolha visualmente os módulos incluídos.</p></div><button type="button" class="icon-button" data-action="close-modal" aria-label="Fechar">×</button></header><div class="modal-body"><input type="hidden" name="id" value="${editing ? source.id : ''}"/><div class="form-grid"><label>Nome do plano<input name="name" required maxlength="120" value="${escape(name)}" placeholder="Profissional" /></label><label>Identificador interno<input name="slug" required maxlength="80" pattern="[a-z0-9_-]+" value="${escape(slug)}" placeholder="profissional" /></label><label class="wide">Descrição comercial<textarea name="description" maxlength="500" placeholder="Para quem é este plano e qual seu principal benefício?">${escape(source?.description || '')}</textarea></label><label>Preço<input name="price" type="number" step="0.01" min="0" required value="${source?.price ?? ''}" placeholder="199,00" /></label><label>Máximo de lojas<input name="stores" type="number" min="1" step="1" required value="${source?.max_stores || 1}" /></label><label>Período de teste (dias)<input name="trial" type="number" min="0" step="1" value="${source?.trial_period_days || 0}" /></label><label>Descrição no Mercado Pago<input name="mpReason" maxlength="255" value="${escape(source?.mp_reason || '')}" placeholder="ChefOS Profissional" /></label><label class="wide">ID do plano recorrente no Mercado Pago<input name="preapprovalPlanId" maxlength="255" value="${escape(preapprovalPlanId)}" placeholder="2c938084..." /><small>Ao duplicar um plano, este vínculo não é copiado.</small></label></div><div class="choice-grid"><label><input type="checkbox" name="recurring" ${recurring ? 'checked' : ''}/><span><strong>Cobrança recorrente</strong><small>Renovação mensal do acesso</small></span></label><label><input type="checkbox" name="popular" ${source?.isMostPopular && !duplicate ? 'checked' : ''}/><span><strong>Destacar como mais popular</strong><small>Remove o destaque dos demais planos</small></span></label></div><section class="permission-picker"><header><div><p class="eyebrow">MÓDULOS INCLUÍDOS</p><h3>O que o cliente poderá usar?</h3><small>Selecione pelas funções do ChefOS, sem precisar conhecer códigos internos.</small></div><strong data-permission-count>${selectedCount} módulo(s) selecionado(s)</strong></header><div class="permission-toolbar"><label><span>⌕</span><input type="search" data-permission-search aria-label="Buscar módulo" placeholder="Buscar módulo ou funcionalidade" /></label><button type="button" class="secondary" data-action="select-all-permissions">Selecionar todos</button><button type="button" class="text-button" data-action="clear-permissions">Limpar seleção</button></div>${preservedLegacy}${legacyPermissions.length ? `<div class="legacy-permission-note"><i>i</i><span><strong>${legacyPermissions.length} acesso(s) de compatibilidade preservado(s)</strong><small>Eles não aparecem no catálogo atual, mas não serão removidos ao salvar.</small></span></div>` : ''}<div class="permission-groups">${permissionGroups || '<div class="empty">O catálogo de módulos não foi carregado.</div>'}</div><div class="permission-empty" data-permission-empty hidden>Nenhum módulo encontrado para esta busca.</div></section></div><footer><button type="button" class="secondary" data-action="close-modal">Cancelar</button><button class="primary" type="submit">${editing ? 'Salvar alterações' : 'Criar plano'}</button></footer></form></div>`;
  }

  function catalogItemModal() {
    const item = state.modal?.id ? state.menu.find((entry) => String(entry.id) === String(state.modal.id)) : null;
    const store = state.tenants.flatMap((tenant) => tenant.stores || []).find((entry) => String(entry.storeId || entry.id) === String(state.selectedStore));
    return `<div class="modal-shell" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button class="modal-backdrop" data-action="close-modal" aria-label="Fechar"></button><form class="modal-card large-modal" data-form="catalog-item"><header><div><p class="eyebrow">CARDÁPIO · ${escape(store?.name || 'OPERAÇÃO')}</p><h2 id="modal-title">${item ? `Editar ${escape(item.name)}` : 'Adicionar item ao cardápio'}</h2><p>A alteração será publicada na operação selecionada.</p></div><button type="button" class="icon-button" data-action="close-modal" aria-label="Fechar">×</button></header><div class="modal-body form-grid"><input type="hidden" name="id" value="${item?.id || ''}"/><label>Nome do item<input name="name" required maxlength="180" value="${escape(item?.name || '')}" placeholder="Ex.: Risoto de cogumelos" /></label><label>Categoria<input name="category" list="catalog-categories" required maxlength="120" value="${escape(item?.categories?.name || 'Geral')}" placeholder="Pratos principais" /><datalist id="catalog-categories">${state.menuCategories.map((category) => `<option value="${escape(category.name)}"></option>`).join('')}</datalist></label><label>Preço<input name="price" type="number" step="0.01" min="0" required value="${item?.price ?? ''}" placeholder="39,90" /></label><label>Tempo de preparo (min)<input name="prepTime" type="number" min="0" max="1440" step="1" required value="${item?.prep_time_in_minutes ?? 15}" /></label><label>Código externo<input name="externalCode" maxlength="120" value="${escape(item?.external_code || '')}" placeholder="SKU-001" /></label><label class="wide">Descrição<textarea name="description" maxlength="1000" placeholder="Descrição exibida no cardápio">${escape(item?.description || '')}</textarea></label><label class="confirmation-check wide"><input type="checkbox" name="available" ${item?.is_available !== false ? 'checked' : ''}/><span><strong>Disponível para venda</strong><small>Desmarque para criar ou manter o item pausado.</small></span></label></div><footer><button type="button" class="secondary" data-action="close-modal">Cancelar</button><button class="primary" type="submit">${item ? 'Salvar item' : 'Adicionar ao cardápio'}</button></footer></form></div>`;
  }

  function onboardingSuccessModal() {
    const result = state.modal?.data || {};
    const auth = result.auth || {};
    const tenant = result.tenant || {};
    const plan = planById(tenant.planId);
    return `<div class="modal-shell" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button class="modal-backdrop" data-action="close-modal" aria-label="Fechar"></button><section class="modal-card onboarding-success"><header><div><p class="eyebrow">ATIVAÇÃO CONCLUÍDA</p><h2 id="modal-title">Cliente pronto para entrar</h2><p>${auth.userCreated ? 'A conta e a estrutura ChefOS foram criadas.' : 'A conta existente foi reutilizada e a estrutura foi validada.'}</p></div><button type="button" class="icon-button" data-action="close-modal" aria-label="Fechar">×</button></header><div class="modal-body"><div class="success-mark">✓</div><div class="credential-list"><div><span><small>E-MAIL DE ACESSO</small><strong>${escape(auth.email || '')}</strong></span><button class="row-action" data-action="copy-onboarding" data-copy="email">Copiar</button></div>${auth.userCreated ? `<div><span><small>SENHA INICIAL</small><strong>${escape(state.modal.password || '')}</strong></span><button class="row-action" data-action="copy-onboarding" data-copy="password">Copiar</button></div>` : '<div class="credential-note"><i>i</i><span><strong>Senha preservada</strong><small>O e-mail já existia; a senha informada não foi aplicada.</small></span></div>'}<div><span><small>OPERAÇÃO</small><strong>${escape(tenant.storeName || '')}</strong></span></div><div><span><small>PLANO INICIAL</small><strong>${escape(plan?.name || 'Plano configurado')}</strong></span></div><div><span><small>CHAVE DE INTEGRAÇÃO</small><strong class="technical-value">${escape(tenant.apiKey || '')}</strong></span><button class="row-action" data-action="copy-onboarding" data-copy="apiKey">Copiar</button></div></div><div class="security-reminder"><strong>Entregue as credenciais por um canal seguro</strong><p>A senha inicial só permanece nesta tela enquanto o modal estiver aberto.</p></div><label class="confirmation-check credential-ack"><input type="checkbox" data-credential-ack ${state.modal.credentialsAcknowledged ? 'checked' : ''} /><span><strong>Guardei as credenciais necessárias</strong><small>Confirme antes de sair desta tela para evitar a perda da senha inicial.</small></span></label></div><footer><button class="secondary" data-action="close-modal">Fechar</button><button class="primary" data-action="view-provisioned-customer" data-id="${tenant.accountId || ''}">Abrir visão do cliente</button></footer></section></div>`;
  }

  function adminAccessModal() {
    const admin = (state.admins || []).find((item) => item.email === state.modal?.email);
    if (!admin) return '';
    const roles = state.adminRoles.length ? state.adminRoles : [{ key: admin.role, label: roleLabel(admin.role) }];
    return `<div class='modal-shell' role='dialog' aria-modal='true' aria-labelledby='admin-access-title'><button class='modal-backdrop' data-action='close-modal' aria-label='Fechar'></button><form class='modal-card admin-access-modal' data-form='admin-access'><header><div><p class='eyebrow'>GESTÃO DE IDENTIDADE</p><h2 id='admin-access-title'>Acesso de ${escape(admin.display_name || admin.email)}</h2><p>${escape(admin.email)}</p></div><button type='button' class='icon-button' data-action='close-modal' aria-label='Fechar'>×</button></header><div class='modal-body'><input type='hidden' name='email' value='${escape(admin.email)}' /><label>Nome de exibição<input name='displayName' maxlength='160' value='${escape(admin.display_name || '')}' /></label><label>Função<select name='role' required>${roles.map((role) => `<option value='${escape(role.key)}' ${admin.role === role.key ? 'selected' : ''}>${escape(role.label)}</option>`).join('')}</select></label><label>Status<select name='status' required><option value='active' ${admin.status === 'active' ? 'selected' : ''}>Ativo</option><option value='invited' ${admin.status === 'invited' ? 'selected' : ''}>Convite pendente</option><option value='suspended' ${admin.status === 'suspended' ? 'selected' : ''}>Suspenso</option><option value='revoked' ${admin.status === 'revoked' ? 'selected' : ''}>Revogado</option></select></label><label class='confirmation-check'><input type='checkbox' name='mfaRequired' ${admin.mfa_required ? 'checked' : ''} /><span><strong>Exigir segundo fator</strong><small>Ações mutáveis podem exigir uma sessão AAL2.</small></span></label><label>Motivo da alteração<textarea name='reason' required minlength='5' maxlength='500' placeholder='Explique por que o acesso está sendo alterado'></textarea></label><div class='modal-alert'><strong>Alteração auditada</strong><p>Mudanças de função ou status preservam o histórico e nunca apagam a identidade.</p></div></div><footer><button type='button' class='secondary' data-action='close-modal'>Cancelar</button><button class='primary' type='submit'>Salvar acesso</button></footer></form></div>`;
  }

  function auditEventModal() {
    const event = state.logs?.data?.find((item) => String(item.id) === String(state.modal?.id));
    if (!event) return '';
    return `<div class='modal-shell drawer-shell' role='dialog' aria-modal='true' aria-labelledby='audit-event-title'><button class='modal-backdrop' data-action='close-modal' aria-label='Fechar'></button><aside class='detail-drawer audit-drawer'><header><div><p class='eyebrow'>EVENTO DE AUDITORIA</p><h2 id='audit-event-title'>${escape(event.actionLabel || event.action)}</h2></div><button class='icon-button' data-action='close-modal' aria-label='Fechar'>×</button></header><div class='drawer-signals'><span class='category-pill'>${escape(event.categoryLabel || event.category)}</span><span class='outcome outcome-${escape(event.outcome)}'>${escape(auditOutcomeLabel(event.outcome))}</span><span class='severity severity-${escape(event.severity)}'>${escape(event.severity)}</span></div><div class='detail-grid audit-detail-grid'><span><small>ATOR</small><strong>${escape(event.actor_email || 'Não identificado')}</strong></span><span><small>DATA E HORA</small><strong>${date(event.created_at)}</strong></span><span><small>RECURSO</small><strong>${escape(event.target_type || '—')}</strong></span><span><small>IDENTIFICADOR</small><strong>${escape(event.target_id || '—')}</strong></span><span><small>REQUISIÇÃO</small><strong>${escape(event.request_id || '—')}</strong></span><span><small>RESULTADO</small><strong>${escape(auditOutcomeLabel(event.outcome))}</strong></span></div>${event.reason ? `<section class='audit-reason'><small>MOTIVO INFORMADO</small><p>${escape(event.reason)}</p></section>` : ''}<section class='audit-diff'><div><small>ANTES</small>${event.before_state ? `<pre>${escape(prettyJson(event.before_state))}</pre>` : `<p class='empty'>Sem estado anterior.</p>`}</div><div><small>DEPOIS</small>${event.after_state ? `<pre>${escape(prettyJson(event.after_state))}</pre>` : `<p class='empty'>Sem estado posterior.</p>`}</div></section><details class='audit-metadata'><summary>Metadados técnicos</summary><pre>${escape(prettyJson(event.metadata || {}))}</pre></details></aside></div>`;
  }

  function workItemModal() {
    const card = (state.workCards || []).find((item) => item.key === state.modal?.key);
    if (!card) return '';
    const canManage = can(card.source === 'support' ? 'support.manage' : 'beta.manage');
    if (!canManage) return '';
    const statuses = card.source === 'support'
      ? ['open', 'in_progress', 'resolved', 'closed']
      : betaAllowedStatuses(card.status);
    const requestedStatus = state.modal?.targetStatus || card.status;
    const selectedStatus = statuses.includes(requestedStatus) ? requestedStatus : card.status;
    return `<div class='modal-shell' role='dialog' aria-modal='true' aria-labelledby='work-item-title'><button class='modal-backdrop' data-action='close-modal' aria-label='Fechar'></button><form class='modal-card work-item-modal' data-form='work-item'><header><div><p class='eyebrow'>${escape(WORK_SOURCE_LABELS[card.source])}</p><h2 id='work-item-title'>Organizar card</h2><p>${escape(card.title)} · prioridade ${card.attentionScore}</p></div><button type='button' class='icon-button' data-action='close-modal' aria-label='Fechar'>×</button></header><div class='modal-body'><input type='hidden' name='key' value='${escape(card.key)}' /><div class='work-modal-score'><strong>${card.attentionScore}</strong><span><b>Índice de atenção</b><small>${escape((card.reasons || []).join(' · ') || 'Acompanhamento em dia')}</small></span></div><label>Etapa<select name='status' required>${statuses.map((key) => `<option value='${key}' ${selectedStatus === key ? 'selected' : ''}>${escape(workStatusLabel(card.source, key))}</option>`).join('')}</select></label><label>Responsável interno<input name='assignedTo' type='email' maxlength='254' value='${escape(card.assignedTo || '')}' placeholder='administrador@chefos.online' /></label><label>Prazo para próxima ação<input name='dueAt' type='datetime-local' value='${escape(toInputDateTime(card.dueAt))}' /></label><label>Registro da movimentação<textarea name='note' maxlength='1000' placeholder='Contexto da decisão ou próximo passo${card.source === 'beta' ? ' — obrigatório ao mudar a etapa' : ''}'></textarea></label>${card.source === 'beta' ? `<div class='modal-alert'><strong>Histórico do programa</strong><p>Mudar a etapa do beta exige uma observação e registra o responsável pela decisão.</p></div>` : `<div class='secure-note'><span>✓</span><p><strong>Movimentação auditada</strong><small>A alteração de etapa, responsável e prazo ficará no histórico administrativo.</small></p></div>`}</div><footer><button type='button' class='secondary' data-action='close-modal'>Cancelar</button><button class='primary' type='submit'>Salvar no quadro</button></footer></form></div>`;
  }

  function betaApplicationModal() {
    const application = (state.betaApplications || []).find((item) => String(item.id) === String(state.modal?.id));
    if (!application) return '';
    const participant = application.participant || null;
    const events = [...(application.events || [])].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const whatsapp = whatsappUrl(application.phone);
    const canManageBeta = can('beta.manage');
    const canConvert = canManageBeta && !participant && ['approved', 'onboarding'].includes(application.status);
    const allowedStatuses = betaAllowedStatuses(application.status);
    return `<div class='modal-shell drawer-shell' role='dialog' aria-modal='true' aria-labelledby='beta-application-title'><button class='modal-backdrop' data-action='close-modal' aria-label='Fechar'></button><form class='detail-drawer beta-drawer' data-form='beta-application'><header><div><p class='eyebrow'>FICHA DO CANDIDATO</p><h2 id='beta-application-title'>${escape(application.restaurant_name)}</h2></div><button type='button' class='icon-button' data-action='close-modal' aria-label='Fechar'>×</button></header><input type='hidden' name='id' value='${escape(application.id)}' /><div class='drawer-title'><p>${escape(application.name)} · candidatura ${relative(application.submitted_at)}</p><div class='drawer-signals'>${betaStageSignal(application.status)}${betaNeedsAttention(application) ? `<span class='health-signal warning'><i></i>Precisa de atenção</span>` : `<span class='health-signal success'><i></i>Acompanhamento em dia</span>`}</div></div>
      <div class='beta-contact-actions'><a class='secondary' href='mailto:${encodeURIComponent(application.email)}'>Enviar e-mail</a>${whatsapp ? `<a class='secondary' href='${escape(whatsapp)}' target='_blank' rel='noopener'>Abrir WhatsApp</a>` : ''}</div>
      <section class='detail-grid beta-detail-grid'><span><small>RESPONSÁVEL</small><strong>${escape(application.name)}</strong></span><span><small>E-MAIL</small><strong>${escape(application.email)}</strong></span><span><small>TELEFONE</small><strong>${escape(application.phone || 'Não informado')}</strong></span><span><small>PERFIL</small><strong>${escape(application.establishment_type || application.restaurant_size || 'Não informado')}</strong></span><span><small>ORIGEM</small><strong>${escape(application.source || 'landing')}</strong></span><span><small>RESPONSÁVEL INTERNO</small><strong>${escape(application.assigned_to || 'Ainda não atribuído')}</strong></span></section>
      <section class='beta-consent'><div><i>✓</i><span><strong>Participação no programa</strong><small>Termo ${escape(application.consent_version || 'registrado')} aceito na candidatura.</small></span></div><div class='${application.consent_marketing ? 'granted' : 'optional'}'><i>${application.consent_marketing ? '✓' : '—'}</i><span><strong>Comunicações de marketing</strong><small>${application.consent_marketing ? 'Autorizadas pelo candidato.' : 'Não autorizadas; envie somente mensagens necessárias ao beta.'}</small></span></div></section>
      ${participant ? `<section class='beta-participant-card'><div class='panel-heading'><div><p class='eyebrow'>PARTICIPANTE</p><h3>Ciclo do beta</h3></div>${betaParticipantStatusSignal(participant.status)}</div><div class='detail-grid'><span><small>COORTE</small><strong>${escape(participant.cohort || 'founders-2026')}</strong></span><span><small>ATIVAÇÃO</small><strong>${participant.activated_at ? day(participant.activated_at) : 'Pendente'}</strong></span><span><small>ENCERRAMENTO</small><strong>${participant.beta_ends_at ? day(participant.beta_ends_at) : '90 dias após ativar'}</strong></span><span><small>SAÚDE</small><strong>${betaParticipantHealthSignal(participant)}</strong></span></div></section>` : ''}
      ${canManageBeta ? `<section class='beta-operation-form'><div class='panel-heading'><div><p class='eyebrow'>PRÓXIMA MOVIMENTAÇÃO</p><h3>Registrar acompanhamento</h3><p class='muted'>Toda mudança fica vinculada ao administrador responsável.</p></div></div><label>Etapa<select name='status' required>${allowedStatuses.map((key) => `<option value='${key}' ${application.status === key ? 'selected' : ''}>${BETA_STAGE_LABELS[key]}</option>`).join('')}</select></label><label>Coorte<input name='cohort' maxlength='80' value='${escape(participant?.cohort || 'founders-2026')}' placeholder='founders-2026' /></label><label>Registro da conversa ou decisão<textarea name='note' required minlength='3' maxlength='1000' placeholder='Ex.: falei com o responsável; entrevista marcada para sexta-feira.'></textarea></label><div class='modal-alert'><strong>Quando começa o período gratuito?</strong><p>Os 90 dias começam somente ao mover um participante para “Beta ativo”. Até lá ele permanece em onboarding.</p></div></section>` : `<div class='secure-note'><span>i</span><p><strong>Acesso somente para leitura</strong><small>Seu perfil pode consultar a candidatura e o histórico, mas não alterar a etapa.</small></p></div>`}
      <section class='beta-timeline'><div class='panel-heading'><div><p class='eyebrow'>HISTÓRICO</p><h3>Movimentações da candidatura</h3></div><span class='count-badge'>${events.length}</span></div>${events.map((entry) => `<article><i></i><div><strong>${entry.event_type === 'participant_created' ? 'Participante criado' : entry.event_type === 'note_added' ? 'Acompanhamento registrado' : entry.to_status ? `${BETA_STAGE_LABELS[entry.from_status] || 'Entrada'} → ${BETA_STAGE_LABELS[entry.to_status] || entry.to_status}` : 'Candidatura recebida'}</strong><p>${escape(entry.note || 'Sem observação adicional.')}</p><small>${date(entry.created_at)} · ${escape(entry.actor_email || 'sistema')}</small></div></article>`).join('') || `<p class='empty'>Nenhuma movimentação registrada.</p>`}</section>
      <footer>${canConvert ? `<button type='button' class='secondary' data-action='convert-beta' data-id='${escape(application.id)}'>Criar participante</button>` : `<button type='button' class='secondary' data-action='close-modal'>Fechar</button>`}${canManageBeta ? `<button class='primary' type='submit'>Salvar acompanhamento</button>` : ''}</footer></form></div>`;
  }

  function modalView() {
    if (!state.modal) return '';
    if (state.modal.type === 'subscription') return subscriptionModal(state.tenants.find((tenant) => String(tenant.accountId || tenant.id) === String(state.modal.id)));
    if (state.modal.type === 'tenant') return tenantModal(state.tenants.find((tenant) => String(tenant.accountId || tenant.id) === String(state.modal.id)));
    if (state.modal.type === 'plan') return planModal();
    if (state.modal.type === 'catalog-item') return catalogItemModal();
    if (state.modal.type === 'onboarding-success') return onboardingSuccessModal();
    if (state.modal.type === 'admin-access') return adminAccessModal();
    if (state.modal.type === 'audit-event') return auditEventModal();
    if (state.modal.type === 'work-item') return workItemModal();
    if (state.modal.type === 'beta-application') return betaApplicationModal();
    return '';
  }

  function sectionContent() {
    if (state.sectionLoading === state.section) {
      return `<section class='page panel loading-page' role='status' aria-live='polite' aria-busy='true'><div class='loading'><i></i>Carregando ${escape(sectionLabels[state.section] || 'esta área')}…</div><p class='muted'>Os dados anteriores permanecem seguros enquanto a atualização é concluída.</p></section>`;
    }
    if (state.sectionError?.section === state.section) {
      return `<section class='page panel error-page' role='alert'><p class='eyebrow'>NÃO FOI POSSÍVEL CARREGAR</p><h1>${escape(sectionLabels[state.section] || 'Esta área')}</h1><p class='muted'>${escape(state.sectionError.message || 'A área não respondeu. Tente novamente.')}</p><button class='primary' data-action='retry-section'>Tentar novamente</button></section>`;
    }
    return activePage();
  }

  function modalReturnSelector(target) {
    if (!target) return null;
    const attributes = ['action', 'id', 'key', 'email'].filter((key) => target.dataset?.[key]).map((key) => `[data-${key}="${CSS.escape(target.dataset[key])}"]`).join('');
    return attributes || null;
  }

  function openModal(modal, target = document.activeElement) {
    state.modalReturn = modalReturnSelector(target);
    state.modalDirty = false;
    state.modal = modal;
    render();
  }

  function focusModal() {
    const dialog = document.querySelector('.modal-shell[role="dialog"]');
    if (!dialog) return;
    document.querySelectorAll('.sidebar, .workspace').forEach((element) => {
      element.inert = true;
      element.setAttribute('aria-hidden', 'true');
    });
    const focusable = dialog.querySelector('[autofocus], input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not(.modal-backdrop):not([disabled]), a[href]');
    window.requestAnimationFrame(() => focusable?.focus());
  }

  function confirmCredentialExit() {
    if (state.modal?.type !== 'onboarding-success' || !state.modal?.password || state.modal?.credentialsAcknowledged) return true;
    return window.confirm('A senha inicial não poderá ser exibida novamente. Fechar sem confirmar que as credenciais foram guardadas?');
  }

  function closeModal({ force = false } = {}) {
    if (!state.modal) return true;
    if (!force && !confirmCredentialExit()) return false;
    if (!force && state.modalDirty && !window.confirm('Descartar as alterações não salvas?')) return false;
    const returnSelector = state.modalReturn;
    state.modal = null;
    state.modalDirty = false;
    state.modalReturn = null;
    render();
    if (returnSelector) window.requestAnimationFrame(() => document.querySelector(returnSelector)?.focus());
    return true;
  }

  function shell() {
    return `<div class="app-shell">${sidebar()}<div class="workspace">${topbar()}<main class="content" aria-busy="${state.sectionLoading === state.section}"><div data-notice-region aria-live="polite" aria-atomic="true">${noticeMarkup()}</div><div data-page-region style="display:contents">${sectionContent()}</div></main></div>${state.sidebarOpen ? '<button class="sidebar-backdrop" data-action="toggle-sidebar" aria-label="Fechar menu"></button>' : ''}${modalView()}</div>`;
  }

  function render(focusKey = '') {
    if (!configured()) { app.innerHTML = missingConfigView(); return; }
    app.innerHTML = state.inviteMode ? inviteView() : state.mfaMode ? mfaView() : state.restoringSession ? restoringView() : state.user ? shell() : loginView();
    document.title = state.user ? `ChefOS — ${sectionLabels[state.section] || 'Painel administrativo'}` : 'ChefOS — Painel administrativo';
    if (focusKey) {
      const input = document.querySelector(`[data-search="${focusKey}"]`);
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }
    document.body.classList.toggle('modal-open', Boolean(state.modal));
    if (state.modal) focusModal();
  }

  function renderPage(focusKey = '') {
    const region = document.querySelector('[data-page-region]');
    if (!region) { render(focusKey); return; }
    region.innerHTML = sectionContent();
    document.title = `ChefOS — ${sectionLabels[state.section] || 'Painel administrativo'}`;
    if (focusKey) {
      const input = document.querySelector(`[data-search="${focusKey}"]`);
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }
  }

  async function safe(action) {
    try { await action(); } catch (error) {
      state.loading = false;
      state.sectionLoading = '';
      if (error?.status === 401 && state.user) {
        await signOut();
        showNotice('Sua sessão expirou. Entre novamente.', 'error');
        return;
      }
      showNotice(error.message || 'Ocorreu um erro.', 'error', false);
    }
  }

  async function openSection(section, { history = 'push', scroll = true } = {}) {
    if (!canOpenSection(section)) {
      showNotice('Seu perfil não possui acesso a esta área.', 'error', false);
      return;
    }
    if (state.modal && !closeModal()) {
      if (history === 'none') window.history.replaceState({ section: state.section }, '', `#/${ROUTE_PATHS[state.section] || ROUTE_PATHS.overview}`);
      return;
    }
    if (state.pageDirty && !window.confirm('Descartar as alterações não salvas desta página?')) {
      if (history === 'none') window.history.replaceState({ section: state.section }, '', `#/${ROUTE_PATHS[state.section] || ROUTE_PATHS.overview}`);
      return;
    }
    const navigationId = ++state.navigationSequence;
    state.pageDirty = false;
    state.section = section;
    state.sidebarOpen = false;
    state.globalQuery = '';
    state.sectionError = null;
    state.sectionLoading = section;
    const route = `#/${ROUTE_PATHS[section] || ROUTE_PATHS.overview}`;
    if (history === 'push' && window.location.hash !== route) window.history.pushState({ section }, '', route);
    if (history === 'replace') window.history.replaceState({ section }, '', route);
    render();
    if (scroll) window.scrollTo({ top: 0, behavior: 'auto' });
    try {
      await loadSection(section);
    } catch (error) {
      if (navigationId === state.navigationSequence && state.section === section) state.sectionError = { section, message: error.message || 'A área não respondeu.' };
    } finally {
      if (navigationId === state.navigationSequence && state.section === section) {
        state.sectionLoading = '';
        render();
      }
    }
  }

  function downloadCsv(kind) {
    const sourceTenants = kind === 'subscriptions'
      ? state.tenants.filter((tenant) => {
        const subscription = tenant.subscriptions?.[0] || {};
        const query = state.filters.subscription;
        return (!query || includes(`${tenant.full_name} ${tenant.email} ${tenant.stores?.map((store) => store.name).join(' ')}`, query))
          && (state.filters.subscriptionStatus === 'all' || subscription.status === state.filters.subscriptionStatus);
      })
      : state.tenants.filter((tenant) => !state.filters.customer || includes(`${tenant.full_name} ${tenant.email} ${tenant.stores?.map((store) => store.name).join(' ')}`, state.filters.customer));
    const rows = kind === 'subscriptions'
      ? [['Cliente', 'Email', 'Loja', 'Plano', 'Status', 'Valor mensal', 'Renovação'], ...sourceTenants.map((tenant) => { const subscription = tenant.subscriptions?.[0] || {}; const plan = planById(subscription.plan_id); return [tenant.full_name, tenant.email, tenant.stores?.[0]?.name || '', plan?.name || '', subscription.status || '', plan?.price || 0, subscription.current_period_end || '']; })]
      : [['Cliente', 'Email', 'Lojas', 'Status', 'Criado em', 'Último acesso'], ...sourceTenants.map((tenant) => [tenant.full_name, tenant.email, tenant.stores?.map((store) => store.name).join(' | ') || '', tenant.subscriptions?.[0]?.status || '', tenant.created_at || '', tenant.last_sign_in_at || ''])];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(';')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `chefos-${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showNotice('Arquivo CSV preparado com sucesso.');
  }

  async function downloadAuditCsv() {
    const filters = state.filters;
    const query = new URLSearchParams({
      export: '1', q: filters.auditQuery || '', category: filters.auditCategory || 'all',
      outcome: filters.auditOutcome || 'all', actor: filters.auditActor || '',
      from: filters.auditFrom || '', to: filters.auditTo || ''
    });
    const result = await api(`/api/admin/logs?${query}`);
    const rows = [['Data', 'Ação', 'Ator', 'Categoria', 'Resultado', 'Risco', 'Recurso', 'ID do recurso', 'Motivo', 'Request ID'], ...(result.data || []).map((event) => [
      event.created_at, event.actionLabel || event.action, event.actor_email, event.categoryLabel || event.category,
      auditOutcomeLabel(event.outcome), event.severity, event.target_type || '', event.target_id || '', event.reason || '', event.request_id || ''
    ])];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(';')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `chefos-auditoria-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showNotice(`${Math.max(0, rows.length - 1)} evento(s) exportado(s).`);
  }

  document.addEventListener('submit', (event) => safe(async () => {
    const form = event.target.closest('form');
    if (!form) return;
    event.preventDefault();
    if (state.pendingAction) return;
    const values = Object.fromEntries(new FormData(form));
    const pendingKey = `form:${form.dataset.form || 'unknown'}`;
    state.pendingAction = pendingKey;
    setPendingElement(form, true);
    try {
    if (form.dataset.form === 'login') {
      const ready = await signIn(values.email, values.password);
      if (ready) await finishAuthenticatedBoot();
      return;
    }
    if (form.dataset.form === 'invite-password') {
      await finishInvitation(values.password, values.confirmation);
      return;
    }
    if (form.dataset.form === 'mfa') {
      await verifyMfa(values.code);
      return;
    }
    if (form.dataset.form === 'subscription') {
      const currentPeriodEnd = values.currentPeriodEnd ? new Date(`${values.currentPeriodEnd}T23:59:59`).toISOString() : undefined;
      const result = await api('/api/admin/subscriptions', { method: 'POST', body: { accountId: values.accountId, status: values.status, planId: values.planId, currentPeriodEnd, reason: values.reason } });
      state.modal = null;
      state.modalDirty = false;
      await loadCore();
      showNotice(result.warning || 'Assinatura atualizada e registrada na auditoria.');
      return;
    }
    if (form.dataset.form === 'plan') {
      const editing = Boolean(values.id);
      const permissions = [...new Set(new FormData(form).getAll('permissions').map((key) => String(key)).filter(Boolean))];
      await api('/api/admin/plans', { method: editing ? 'PUT' : 'POST', body: { id: values.id || undefined, plan: { name: values.name, slug: values.slug, description: values.description, price: Number(values.price), trial_period_days: Number(values.trial), max_stores: Number(values.stores), recurring: values.recurring === 'on', isMostPopular: values.popular === 'on', preapproval_plan_id: values.preapprovalPlanId, mp_reason: values.mpReason }, permissions } });
      state.modal = null;
      state.modalDirty = false;
      try {
        const plans = await api('/api/admin/plans');
        state.plans = plans.data || [];
        state.permissionCatalog = plans.permissionCatalog || state.permissionCatalog;
      } catch {
        showNotice(`${editing ? 'Plano atualizado' : 'Plano criado'}. Atualize a lista para carregar os dados mais recentes.`, 'warning', false);
        return;
      }
      showNotice(editing ? 'Plano atualizado com sucesso.' : 'Plano criado com sucesso.');
      return;
    }
    if (form.dataset.form === 'catalog-item') {
      const item = { name: values.name, category: values.category, price: Number(values.price), prep_time_in_minutes: Number(values.prepTime), description: values.description, external_code: values.externalCode, is_available: values.available === 'on' };
      await api('/api/admin/tenant-menu', { method: values.id ? 'PUT' : 'POST', body: { storeId: state.selectedStore, id: values.id || undefined, item } });
      state.modal = null;
      state.modalDirty = false;
      await loadSection('catalog');
      showNotice(values.id ? 'Item atualizado no cardápio.' : 'Item adicionado ao cardápio.');
      return;
    }
    if (form.dataset.form === 'reply') {
      await api('/api/admin/messages', { method: 'POST', body: { ticket_id: form.dataset.ticket, text: values.text, status_update: values.status } });
      form.reset();
      try {
        const tickets = await api('/api/admin/tickets');
        state.tickets = tickets.data || [];
        state.ticketSummary = tickets.summary || null;
        state.ticketMeta = tickets.meta || null;
      } catch {
        showNotice('Resposta enviada. Atualize o atendimento para carregar a conversa mais recente.', 'warning', false);
        return;
      }
      showNotice('Resposta enviada ao cliente.');
      return;
    }
    if (form.dataset.form === 'provision') {
      const result = await api('/api/admin/provision-tenant', { method: 'POST', body: values });
      try {
        await loadCore({ silent: true });
      } catch {
        state.notice = { text: 'Cliente criado. Atualize o painel para recarregar os indicadores gerais.', type: 'warning' };
      }
      state.modalDirty = false;
      state.pageDirty = false;
      state.modal = { type: 'onboarding-success', data: result, password: values.initialPassword, credentialsAcknowledged: false };
      render();
      return;
    }
    if (form.dataset.form === 'admin') {
      const result = await api('/api/admin/administrators', { method: 'POST', body: { ...values, mfaRequired: values.mfaRequired === 'on' } });
      form.reset();
      try { await loadSection('administrators', true); }
      catch { showNotice('Convite enviado. Atualize a equipe para carregar os dados mais recentes.', 'warning', false); return; }
      showNotice(result.message || 'Convite administrativo enviado.');
      return;
    }
    if (form.dataset.form === 'admin-access') {
      await api('/api/admin/administrators', { method: 'PUT', body: { ...values, mfaRequired: values.mfaRequired === 'on' } });
      state.modal = null;
      state.modalDirty = false;
      await loadSection('administrators', true);
      showNotice('Acesso atualizado e registrado na auditoria.');
      return;
    }
    if (form.dataset.form === 'work-item') {
      const card = (state.workCards || []).find((item) => item.key === values.key);
      if (!card) throw new Error('O card não está mais disponível. Atualize o quadro.');
      const statusChanged = values.status !== card.status;
      if (card.source === 'beta' && statusChanged && !String(values.note || '').trim()) throw new Error('Registre a decisão antes de mudar a etapa do beta.');
      await api('/api/admin/work-board', { method: 'PATCH', body: {
        source: card.source, id: card.sourceId, status: values.status,
        assignedTo: values.assignedTo || null,
        dueAt: values.dueAt ? new Date(values.dueAt).toISOString() : null,
        position: Date.now(), note: values.note || null,
        expectedUpdatedAt: card.sourceUpdatedAt,
        expectedWorkUpdatedAt: card.workUpdatedAt
      } });
      state.modal = null;
      state.modalDirty = false;
      if (card.source === 'support') state.tickets = null;
      if (card.source === 'beta') state.betaApplications = null;
      await loadSection('workboard', true);
      render();
      showNotice('Card atualizado e registrado na auditoria.');
      return;
    }
    if (form.dataset.form === 'beta-application') {
      const application = (state.betaApplications || []).find((item) => String(item.id) === String(values.id));
      await api('/api/admin/beta-applications', { method: 'PATCH', body: { id: values.id, status: values.status, cohort: values.cohort, note: values.note, expectedUpdatedAt: application?.updated_at } });
      state.modalDirty = false;
      state.modal = null;
      try { await loadSection('beta', true); }
      catch { showNotice('Acompanhamento salvo. Atualize o beta para carregar a ficha mais recente.', 'warning', false); return; }
      render();
      showNotice(values.status === 'active' ? 'Participante ativado; o ciclo de 90 dias começou.' : 'Acompanhamento registrado no histórico.');
      return;
    }
    if (form.dataset.form === 'audit-filter') {
      Object.assign(state.filters, {
        auditQuery: values.q || '', auditCategory: values.category || 'all', auditOutcome: values.outcome || 'all',
        auditActor: values.actor || '', auditFrom: values.from || '', auditTo: values.to || '', auditPage: 1
      });
      state.logs = null;
      state.loading = true;
      render();
      await loadSection('logs', true);
      state.loading = false;
      render();
      return;
    }
    } finally {
      if (state.pendingAction === pendingKey) state.pendingAction = '';
      if (form.isConnected) setPendingElement(form, false);
    }
  }));

  document.addEventListener('click', (event) => safe(async () => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'logout') {
      if ((state.modalDirty || state.pageDirty) && !window.confirm('Sair e descartar as alterações não salvas?')) return;
      return signOut();
    }
    if (action === 'copy-mfa-secret') {
      await navigator.clipboard.writeText(state.mfaMode?.secret || '');
      showNotice('Chave do autenticador copiada.');
      return;
    }
    if (action === 'section' || action === 'command-section') return openSection(target.dataset.section);
    if (action === 'retry-section') return openSection(state.section, { history: 'replace', scroll: false });
    if (action === 'filtered-section') { state.filters.subscriptionStatus = target.dataset.filter; return openSection(target.dataset.section); }
    if (action === 'toggle-sidebar') { state.sidebarOpen = !state.sidebarOpen; render(); return; }
    if (action === 'refresh') return loadCore();
    if (action === 'dismiss-notice') { state.notice = null; updateNoticeRegion(); return; }
    if (action === 'close-modal') { closeModal(); return; }
    if (action === 'manage-admin') { openModal({ type: 'admin-access', email: target.dataset.email }, target); return; }
    if (action === 'view-audit') { openModal({ type: 'audit-event', id: target.dataset.id }, target); return; }
    if (action === 'work-view') { state.workView = target.dataset.view || 'radar'; render(); return; }
    if (action === 'organize-work') { openModal({ type: 'work-item', key: target.dataset.key }, target); return; }
    if (action === 'open-work-item') {
      const card = (state.workCards || []).find((item) => item.key === target.dataset.key);
      if (!card) return;
      if (card.source === 'support') {
        state.selectedTicketId = card.sourceId;
        return openSection('support');
      }
      if (!state.betaApplications) await loadSection('beta', true);
      openModal({ type: 'beta-application', id: card.sourceId }, target);
      return;
    }
    if (action === 'open-beta') { openModal({ type: 'beta-application', id: target.dataset.id }, target); return; }
    if (action === 'open-plan') { openModal({ type: 'plan' }, target); return; }
    if (action === 'edit-plan') { openModal({ type: 'plan', id: target.dataset.id }, target); return; }
    if (action === 'duplicate-plan') { openModal({ type: 'plan', id: target.dataset.id, duplicate: true }, target); return; }
    if (action === 'select-all-permissions' || action === 'clear-permissions') {
      const form = target.closest('form');
      form?.querySelectorAll('input[type="checkbox"][name="permissions"]').forEach((checkbox) => { checkbox.checked = action === 'select-all-permissions'; });
      if (form?.closest('.modal-shell')) state.modalDirty = true;
      updatePermissionSummary(form);
      return;
    }
    if (action === 'toggle-permission-group') {
      const form = target.closest('form');
      const checkboxes = [...target.closest('[data-permission-group]')?.querySelectorAll('input[name="permissions"]') || []];
      const shouldSelect = checkboxes.some((checkbox) => !checkbox.checked);
      checkboxes.forEach((checkbox) => { checkbox.checked = shouldSelect; });
      if (form?.closest('.modal-shell')) state.modalDirty = true;
      updatePermissionSummary(form);
      return;
    }
    if (action === 'open-catalog-item') { openModal({ type: 'catalog-item' }, target); return; }
    if (action === 'edit-catalog-item') { openModal({ type: 'catalog-item', id: target.dataset.id }, target); return; }
    if (action === 'generate-password') {
      const input = target.closest('form')?.querySelector('[name="initialPassword"]');
      if (input) { input.value = randomPassword(); state.pageDirty = true; input.focus(); input.select(); }
      return;
    }
    if (action === 'copy-onboarding') {
      const values = { email: state.modal?.data?.auth?.email, password: state.modal?.password, apiKey: state.modal?.data?.tenant?.apiKey };
      await navigator.clipboard.writeText(String(values[target.dataset.copy] || ''));
      showNotice('Informação copiada com segurança.');
      return;
    }
    if (action === 'view-provisioned-customer') {
      if (!confirmCredentialExit()) return;
      openModal({ type: 'tenant', id: target.dataset.id }, target);
      return;
    }
    if (action === 'open-provision') return openSection('provision');
    if (action === 'open-tenant') { state.globalQuery = ''; openModal({ type: 'tenant', id: target.dataset.id }, target); return; }
    if (action === 'edit-subscription') { openModal({ type: 'subscription', id: target.dataset.id }, target); return; }
    if (action === 'tenant-catalog') {
      state.modal = null;
      state.modalDirty = false;
      state.selectedTenant = target.dataset.id;
      const tenant = state.tenants.find((item) => String(item.accountId || item.id) === String(target.dataset.id));
      state.selectedStore = tenant?.stores?.[0]?.storeId || tenant?.stores?.[0]?.id || '';
      return openSection('catalog');
    }
    if (action === 'export') { downloadCsv(target.dataset.kind); return; }
    if (action === 'ticket-filter') { state.filters.ticketStatus = target.dataset.value; render(); return; }
    if (action === 'select-ticket') { state.selectedTicketId = target.dataset.id; render(); return; }
    if (action === 'open-ticket') { state.selectedTicketId = target.dataset.id; return openSection('support'); }
    if (action === 'reload-tickets') return withPending('reload-tickets', target, async () => { await loadSection('support', true); render(); });
    if (action === 'reload-workboard') return withPending('reload-workboard', target, async () => { await loadSection('workboard', true); render(); });
    if (action === 'resolve-ticket') {
      return withPending(`resolve-ticket:${target.dataset.id}`, target, async () => {
        await api('/api/admin/tickets', { method: 'PUT', body: { id: target.dataset.id, updates: { status: 'resolved' } } });
        const tickets = await api('/api/admin/tickets');
        state.tickets = tickets.data || [];
        state.ticketSummary = tickets.summary || null;
        state.ticketMeta = tickets.meta || null;
        showNotice('Chamado marcado como resolvido.');
      });
    }
    if (action === 'reload-health') {
      return withPending('reload-health', target, async () => {
        state.health = await api('/api/admin/health', { method: 'POST' });
        showNotice('Diagnóstico concluído e armazenado no histórico.');
      });
    }
    if (action === 'health-navigate') {
      if (target.dataset.section === 'subscriptions' && target.dataset.filter) state.filters.subscriptionStatus = target.dataset.filter;
      return openSection(target.dataset.section);
    }
    if (action === 'reload-logs') return withPending('reload-logs', target, async () => { await loadSection('logs', true); render(); });
    if (action === 'reload-beta') return withPending('reload-beta', target, async () => { await loadSection('beta', true); render(); });
    if (action === 'convert-beta') {
      const application = (state.betaApplications || []).find((item) => String(item.id) === String(target.dataset.id));
      return withPending(`convert-beta:${target.dataset.id}`, target, async () => {
        await api('/api/admin/beta-applications', { method: 'POST', body: { id: target.dataset.id, expectedUpdatedAt: application?.updated_at } });
        state.modalDirty = false;
        await loadSection('beta', true);
        render();
        showNotice('Participante criado e movido para onboarding.');
      });
    }
    if (action === 'export-audit') { await downloadAuditCsv(); return; }
    if (action === 'audit-page') {
      state.filters.auditPage = Number(target.dataset.page || 1);
      return withPending('audit-page', target, async () => { await loadSection('logs', true); render(); });
    }
    if (action === 'clear-audit-filters') {
      Object.assign(state.filters, { auditQuery: '', auditCategory: 'all', auditOutcome: 'all', auditActor: '', auditFrom: '', auditTo: '', auditPage: 1 });
      return withPending('clear-audit-filters', target, async () => { await loadSection('logs', true); render(); });
    }
    if (action === 'toggle-menu') {
      return withPending(`toggle-menu:${target.dataset.id}`, target, async () => {
        await api('/api/admin/tenant-menu', { method: 'PUT', body: { storeId: state.selectedStore, id: target.dataset.id, item: { is_available: target.dataset.available !== 'true' } } });
        await loadSection('catalog');
        render();
        showNotice('Disponibilidade atualizada.');
      });
    }
    if (action === 'delete-plan') {
      if (!confirm('Excluir este plano? Assinaturas vinculadas podem impedir a exclusão.')) return;
      return withPending(`delete-plan:${target.dataset.id}`, target, async () => {
        await api('/api/admin/plans', { method: 'DELETE', body: { id: target.dataset.id } });
        try { state.plans = (await api('/api/admin/plans')).data || []; }
        catch { showNotice('Plano excluído. Atualize a lista para confirmar os dados mais recentes.', 'warning', false); return; }
        showNotice('Plano excluído.');
      });
    }
    if (action === 'delete-admin') {
      if (!confirm(`Remover ${target.dataset.email} do Control Center?`)) return;
      return withPending(`delete-admin:${target.dataset.email}`, target, async () => {
        await api('/api/admin/administrators', { method: 'DELETE', body: { email: target.dataset.email, reason: 'Acesso revogado pelo painel' } });
        try { await loadSection('administrators', true); }
        catch { showNotice('Acesso revogado. Atualize a equipe para confirmar os dados mais recentes.', 'warning', false); return; }
        showNotice('Acesso revogado e histórico preservado.');
      });
    }
  }));

  document.addEventListener('input', (event) => {
    if (event.target.closest('form[data-form="provision"]') && !event.target.matches('[readonly], [disabled]')) state.pageDirty = true;
    if (state.modal && event.target.closest('.modal-shell form') && !event.target.matches('[readonly], [disabled], [data-permission-search]')) state.modalDirty = true;
    const permissionSearch = event.target.closest('[data-permission-search]');
    if (permissionSearch) { filterPermissionOptions(permissionSearch); return; }
    const input = event.target.closest('[data-search]');
    if (!input) return;
    const key = input.dataset.search;
    if (key === 'global') {
      state.globalQuery = input.value;
      const region = document.querySelector('[data-command-region]');
      if (region) region.innerHTML = commandResults();
      input.setAttribute('aria-expanded', state.globalQuery.trim().length >= 2 ? 'true' : 'false');
      return;
    }
    state.filters[key] = input.value;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => renderPage(key), 160);
  });

  document.addEventListener('change', (event) => safe(async () => {
    const credentialAck = event.target.closest('[data-credential-ack]');
    if (credentialAck && state.modal?.type === 'onboarding-success') {
      state.modal.credentialsAcknowledged = credentialAck.checked;
      return;
    }
    if (event.target.closest('form[data-form="provision"]') && !event.target.matches('[readonly], [disabled]')) state.pageDirty = true;
    if (state.modal && event.target.closest('.modal-shell form') && !event.target.matches('[readonly], [disabled], [data-permission-search]')) state.modalDirty = true;
    const permission = event.target.closest('input[type="checkbox"][name="permissions"]');
    if (permission) { updatePermissionSummary(permission.closest('form')); return; }
    const filter = event.target.closest('[data-filter]');
    if (filter) { state.filters[filter.dataset.filter] = filter.value; render(); return; }
    const customerSelect = event.target.closest('[data-action="select-tenant"]');
    const storeSelect = event.target.closest('[data-action="select-store"]');
    if (!customerSelect && !storeSelect) return;
    if (customerSelect) {
      state.selectedTenant = customerSelect.value;
      const tenant = state.tenants.find((item) => String(item.accountId || item.id) === String(state.selectedTenant));
      state.selectedStore = tenant?.stores?.[0]?.storeId || tenant?.stores?.[0]?.id || '';
    }
    if (storeSelect) state.selectedStore = storeSelect.value;
    state.filters.catalogCategory = 'all';
    state.loading = true; render();
    await loadSection('catalog');
    state.loading = false; render();
  }));

  document.addEventListener('dragstart', (event) => {
    const card = event.target.closest('[data-work-key][draggable="true"]');
    if (!card || state.workView === 'radar') return;
    draggedWorkKey = card.dataset.workKey || '';
    card.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', draggedWorkKey);
  });

  document.addEventListener('dragend', (event) => {
    event.target.closest('[data-work-key]')?.classList.remove('dragging');
    document.querySelectorAll('[data-drop-lane].drag-over').forEach((lane) => lane.classList.remove('drag-over'));
    draggedWorkKey = '';
  });

  document.addEventListener('dragover', (event) => {
    const lane = event.target.closest('[data-drop-lane]');
    if (!lane || !draggedWorkKey || state.workView === 'radar') return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('[data-drop-lane].drag-over').forEach((item) => item !== lane && item.classList.remove('drag-over'));
    lane.classList.add('drag-over');
  });

  document.addEventListener('dragleave', (event) => {
    const lane = event.target.closest('[data-drop-lane]');
    if (lane && !lane.contains(event.relatedTarget)) lane.classList.remove('drag-over');
  });

  document.addEventListener('drop', (event) => {
    const lane = event.target.closest('[data-drop-lane]');
    if (!lane || state.workView === 'radar') return;
    event.preventDefault();
    const key = draggedWorkKey || event.dataTransfer.getData('text/plain');
    const card = (state.workCards || []).find((item) => item.key === key);
    const targetStatus = workLaneTarget(state.workView, lane.dataset.dropLane, card?.status);
    document.querySelectorAll('[data-drop-lane].drag-over').forEach((item) => item.classList.remove('drag-over'));
    draggedWorkKey = '';
    if (!key || !card) return;
    if (!targetStatus || (lane.dataset.dropLane === card.nativeLane && targetStatus === card.status)) {
      showNotice('Esse card já está nesta coluna ou precisa passar pela etapa anterior.', 'error', false);
      return;
    }
    openModal({ type: 'work-item', key, targetStatus }, lane);
  });

  document.addEventListener('keydown', (event) => {
    const globalInput = event.target.closest?.('[data-search="global"]');
    const commandOption = event.target.closest?.('[data-command-option]');
    if (globalInput && ['ArrowDown', 'Enter'].includes(event.key)) {
      const firstResult = document.querySelector('[data-command-option]');
      if (firstResult) {
        event.preventDefault();
        if (event.key === 'Enter') firstResult.click();
        else firstResult.focus();
      }
    }
    if (commandOption && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      const options = [...document.querySelectorAll('[data-command-option]')];
      const currentIndex = options.indexOf(commandOption);
      const nextIndex = event.key === 'Home' ? 0
        : event.key === 'End' ? options.length - 1
          : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      event.preventDefault();
      options[nextIndex]?.focus();
    }
    if (commandOption && event.key === 'Escape') {
      event.preventDefault();
      document.querySelector('[data-search="global"]')?.focus();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      document.querySelector('[data-search="global"]')?.focus();
    }
    if (event.key === 'Escape') {
      if (state.modal) closeModal();
      else {
        state.sidebarOpen = false;
        state.globalQuery = '';
        render();
      }
    }
    if (event.key === 'Tab' && state.modal) {
      const dialog = document.querySelector('.modal-shell[role="dialog"]');
      const focusable = [...(dialog?.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || [])]
        .filter((element) => element.offsetParent !== null && !element.classList.contains('modal-backdrop'));
      if (focusable.length) {
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      const form = event.target.closest('form[data-form="reply"]');
      if (form) {
        event.preventDefault();
        form.requestSubmit();
      }
    }
  });

  window.addEventListener('popstate', () => {
    if (!state.user) return;
    const section = sectionFromLocation();
    if (section !== state.section) openSection(section, { history: 'none' });
  });

  window.addEventListener('beforeunload', (event) => {
    if (!state.modalDirty && !state.pageDirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  async function boot() {
    render();
    if (state.inviteMode) return;
    if (!configured() || !state.token) { state.restoringSession = false; render(); return; }
    try {
      state.user = (await api('/api/admin/session')).data;
      if (await prepareMfa()) return;
      await finishAuthenticatedBoot();
    } catch (error) {
      state.restoringSession = false;
      if (error?.status === 401) {
        await signOut();
        showNotice('Sua sessão expirou. Entre novamente.', 'error');
        return;
      }
      if (!state.user) {
        sessionStorage.removeItem('koregastro_admin_token');
        state.token = '';
        render();
        showNotice(error?.status === 403 ? 'Este usuário não possui acesso administrativo.' : 'Não foi possível validar o acesso agora. Tente novamente.', 'error', false);
        return;
      }
      render();
      showNotice(error?.message || 'Parte dos dados não pôde ser carregada. Tente atualizar a área.', 'error', false);
    }
  }

  boot();
})();
