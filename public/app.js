(() => {
  'use strict';

  const config = window.KORE_ADMIN_CONFIG || {};
  const app = document.querySelector('#app');
  const state = {
    token: sessionStorage.getItem('koregastro_admin_token') || '',
    user: null,
    section: 'overview',
    loading: false,
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
    health: null,
    logs: null,
    notice: null,
    modal: null,
    sidebarOpen: false,
    globalQuery: '',
    filters: { customer: '', subscription: '', subscriptionStatus: 'all', ticket: '', ticketStatus: 'active', catalog: '', catalogCategory: 'all', catalogStatus: 'all' }
  };

  const navigation = [
    { label: 'Operação', items: [
      ['overview', 'Visão geral', '⌂'], ['subscriptions', 'Assinaturas', '◎'],
      ['tenants', 'Clientes', '◫'], ['support', 'Suporte', '✦']
    ] },
    { label: 'Produto', items: [
      ['plans', 'Planos', '◇'], ['catalog', 'Cardápios', '≡'], ['provision', 'Onboarding', '+']
    ] },
    { label: 'Sistema', items: [
      ['health', 'Saúde', '♥'], ['logs', 'Auditoria', '≋'], ['administrators', 'Acessos', '⚙']
    ] }
  ];
  const sectionLabels = Object.fromEntries(navigation.flatMap((group) => group.items.map(([key, label]) => [key, label])));

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
  const toInputDate = (value) => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toISOString().slice(0, 10) : '';

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

  function showNotice(text, type = 'success') {
    state.notice = { text, type };
    render();
    window.setTimeout(() => {
      if (state.notice?.text === text) { state.notice = null; render(); }
    }, 5000);
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
    if (!response.ok) throw new Error(body.error || 'Não foi possível concluir a operação.');
    return body;
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
    state.user = (await api('/api/admin/session')).data;
  }

  async function signOut() {
    try {
      await fetch(`${String(config.supabaseUrl).replace(/\/$/, '')}/auth/v1/logout`, {
        method: 'POST', headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${state.token}` }
      });
    } finally {
      sessionStorage.removeItem('koregastro_admin_token');
      Object.assign(state, { token: '', user: null, dashboard: null, tenants: [], customerSummary: null, customerMeta: null, plans: [], permissionCatalog: [], tickets: null, ticketSummary: null, ticketMeta: null, menu: [], menuCategories: [], menuMeta: null, selectedTenant: '', selectedStore: '', admins: null, health: null, logs: null });
      render();
    }
  }

  async function loadCore() {
    state.loading = true;
    render();
    try {
      const [dashboard, customers, plans, tickets] = await Promise.all([
        api('/api/admin/dashboard'), api('/api/admin/customers?pageSize=500'), api('/api/admin/plans'), api('/api/admin/tickets')
      ]);
      state.dashboard = dashboard.data;
      state.tenants = customers.data || [];
      state.customerSummary = customers.summary || null;
      state.customerMeta = customers.meta || null;
      state.plans = plans.data || [];
      state.permissionCatalog = plans.permissionCatalog || [];
      state.tickets = tickets.data || [];
      state.ticketSummary = tickets.summary || null;
      state.ticketMeta = tickets.meta || null;
      if (!state.selectedTenant && state.tenants[0]) state.selectedTenant = state.tenants[0].accountId || state.tenants[0].id;
      const selectedCustomer = state.tenants.find((tenant) => String(tenant.accountId || tenant.id) === String(state.selectedTenant));
      if (!selectedCustomer?.stores?.some((store) => String(store.storeId || store.id) === String(state.selectedStore))) {
        state.selectedStore = selectedCustomer?.stores?.[0]?.storeId || selectedCustomer?.stores?.[0]?.id || '';
      }
      if (!state.selectedTicketId && state.tickets[0]) state.selectedTicketId = state.tickets[0].id;
    } finally {
      state.loading = false;
      render();
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
    if (section === 'administrators' && (force || !state.admins)) state.admins = (await api('/api/admin/administrators')).data || [];
    if (section === 'health' && (force || !state.health)) state.health = await api('/api/admin/health');
    if (section === 'logs' && (force || !state.logs)) state.logs = (await api('/api/admin/logs')).data || [];
  }

  function loginView() {
    return `<section class="login-shell">
      <div class="login-brand"><span class="brand-mark">C</span><strong>ChefOS</strong><small>Control Center</small></div>
      <form class="login-card" data-form="login">
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

  function missingConfigView() {
    return `<section class="login-shell"><div class="login-card"><p class="eyebrow">CONFIGURAÇÃO PENDENTE</p><h1>Painel pronto para conectar</h1><p class="muted">Configure <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> antes do deploy.</p></div></section>`;
  }

  function sidebar() {
    const groups = navigation.map((group) => `<div class="nav-group"><span class="nav-label">${group.label}</span>${group.items.map(([key, label, glyph]) => {
      const badge = key === 'support' && (state.dashboard?.openTickets || 0) ? `<b>${state.dashboard.openTickets}</b>` : '';
      return `<button class="nav-item ${state.section === key ? 'active' : ''}" data-action="section" data-section="${key}"><span class="nav-glyph" aria-hidden="true">${glyph}</span><span>${label}</span>${badge}</button>`;
    }).join('')}</div>`).join('');
    return `<aside class="sidebar ${state.sidebarOpen ? 'open' : ''}" aria-label="Navegação principal">
      <div class="brand"><span class="brand-mark">C</span><span>ChefOS<small>Control Center</small></span><button class="icon-button sidebar-close" data-action="toggle-sidebar" aria-label="Fechar menu">×</button></div>
      <nav>${groups}</nav>
      <div class="sidebar-footer">
        <div class="system-pill"><i></i><span><strong>Sistema operacional</strong><small>Todos os serviços ativos</small></span></div>
        <div class="user-card"><span class="avatar">${initials(state.user?.email)}</span><span><strong>${escape(state.user?.email?.split('@')[0])}</strong><small>${escape(state.user?.email)}</small></span><button class="quiet" data-action="logout">Sair</button></div>
      </div>
    </aside>`;
  }

  function commandResults() {
    if (state.globalQuery.trim().length < 2) return '';
    const query = state.globalQuery.trim();
    const sectionResults = Object.entries(sectionLabels).filter(([, label]) => includes(label, query)).slice(0, 4);
    const tenantResults = state.tenants.filter((tenant) => includes(`${tenant.full_name} ${tenant.email} ${(tenant.stores || []).map((store) => store.name).join(' ')}`, query)).slice(0, 5);
    if (!sectionResults.length && !tenantResults.length) return `<div class="command-results"><p>Nenhum resultado para “${escape(query)}”.</p></div>`;
    return `<div class="command-results">
      ${sectionResults.length ? `<small>NAVEGAÇÃO</small>${sectionResults.map(([key, label]) => `<button data-action="command-section" data-section="${key}"><span class="command-icon">↗</span><span><strong>${label}</strong><em>Abrir seção</em></span></button>`).join('')}` : ''}
      ${tenantResults.length ? `<small>CLIENTES</small>${tenantResults.map((tenant) => `<button data-action="open-tenant" data-id="${tenant.id}"><span class="avatar small">${initials(tenant.full_name)}</span><span><strong>${escape(tenant.full_name)}</strong><em>${escape(tenant.email)}</em></span></button>`).join('')}` : ''}
    </div>`;
  }

  function topbar() {
    return `<header class="topbar">
      <button class="icon-button menu-button" data-action="toggle-sidebar" aria-label="Abrir menu">☰</button>
      <div class="breadcrumbs"><span>ChefOS</span><b>/</b><strong>${sectionLabels[state.section]}</strong></div>
      <div class="global-search"><span>⌕</span><input data-search="global" value="${escape(state.globalQuery)}" placeholder="Buscar cliente, loja ou seção..." aria-label="Busca global" /><kbd>Ctrl K</kbd>${commandResults()}</div>
      <button class="top-action" data-action="open-provision"><span>＋</span>Novo cliente</button>
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
      ${pageHeader('PAINEL EXECUTIVO', `${greeting}, equipe ChefOS.`, `Pulso operacional atualizado ${relative(data.generatedAt)}.`, `<button class="secondary" data-action="refresh">↻ Atualizar dados</button><button class="primary" data-action="open-provision">＋ Novo cliente</button>`)}
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
    const actions = `<button class="secondary" data-action="export" data-kind="subscriptions">↓ Exportar CSV</button><button class="primary" data-action="open-provision">＋ Provisionar cliente</button>`;
    return `<section class="page">
      ${pageHeader('RECEITA E ACESSO', 'Assinaturas', 'Controle planos, vencimentos e o acesso de cada operação ChefOS.', actions)}
      <div class="integration-warning"><span>!</span><div><strong>Alterações de acesso são internas</strong><p>O conector de recorrência do Mercado Pago ainda não está habilitado; mudanças aqui não cancelam nem alteram cobranças no provedor.</p></div></div>
      <div class="summary-strip"><div><span>Receita contratada nesta visão</span><strong>${money(contractedMonthly)}</strong></div><div><span>Assinaturas exibidas</span><strong>${rows.length}</strong></div><div><span>Vencem em 7 dias</span><strong>${dueSoon}</strong></div><div class="danger-text"><span>Ativas com período vencido</span><strong>${expired}</strong></div></div>
      <div class="data-toolbar"><div class="search-field"><span>⌕</span><input data-search="subscription" value="${escape(query)}" placeholder="Buscar cliente, e-mail ou loja" /></div><select data-filter="subscriptionStatus" aria-label="Filtrar status"><option value="all" ${filter === 'all' ? 'selected' : ''}>Todos os status</option><option value="active" ${filter === 'active' ? 'selected' : ''}>Ativas</option><option value="trialing" ${filter === 'trialing' ? 'selected' : ''}>Em teste</option><option value="past_due" ${filter === 'past_due' ? 'selected' : ''}>Inadimplentes</option><option value="unpaid" ${filter === 'unpaid' ? 'selected' : ''}>Não pagas</option><option value="canceled" ${filter === 'canceled' ? 'selected' : ''}>Canceladas</option></select><span class="result-count">${rows.length} resultado(s)</span></div>
      <div class="panel table-wrap"><table><thead><tr><th>Cliente / operação</th><th>Plano</th><th>Status</th><th>Saúde do acesso</th><th>Valor mensal</th><th>Período atual</th><th></th></tr></thead><tbody>
        ${rows.map(({ tenant, subscription }) => { const plan = planById(subscription.plan_id); const accountId = tenant.accountId || tenant.id; return `<tr><td><button class="customer-cell" data-action="open-tenant" data-id="${accountId}"><span class="avatar small">${initials(tenant.full_name)}</span><span><strong>${escape(tenant.full_name)}</strong><small>${escape(tenant.stores?.[0]?.name || tenant.email)}</small></span></button></td><td><strong>${escape(plan?.name || 'Sem plano')}</strong><small>${plan ? `${plan.max_stores || 1} loja(s)` : 'Defina um plano'}</small></td><td>${status(subscription.status)}</td><td>${entitlement(subscription)}</td><td><strong>${money(plan?.price)}</strong><small>valor do plano</small></td><td><strong>${day(subscription.current_period_end)}</strong><small>${relative(subscription.current_period_end)}</small></td><td><button class="row-action" data-action="edit-subscription" data-id="${accountId}">Gerenciar</button></td></tr>`; }).join('') || '<tr><td colspan="7" class="empty">Nenhuma assinatura encontrada com estes filtros.</td></tr>'}
      </tbody></table></div>
    </section>`;
  }

  function tenants() {
    const query = state.filters.customer;
    const rows = state.tenants.filter((tenant) => !query || includes(`${tenant.full_name} ${tenant.email} ${tenant.stores?.map((store) => store.name).join(' ')}`, query));
    const summary = state.customerSummary || {};
    const actions = `<button class="secondary" data-action="export" data-kind="customers">↓ Exportar CSV</button><button class="primary" data-action="open-provision">＋ Novo cliente</button>`;
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
    const selected = (state.tickets || []).find((ticket) => String(ticket.id) === String(state.selectedTicketId));
    const messages = selected?.messages || [];
    const summary = state.ticketSummary || {};
    return `<section class="page support-page">
      ${pageHeader('ATENDIMENTO AO CLIENTE', 'Central de suporte', 'Priorize, responda e acompanhe cada conversa até a resolução.', `<button class="secondary" data-action="reload-tickets">↻ Atualizar fila</button>`)}
      <div class="support-kpis"><div><span>FILA ATIVA</span><strong>${summary.active || 0}</strong><small>chamados para atender</small></div><div><span>PRIORIDADE ALTA</span><strong>${summary.priority || 0}</strong><small>altos e urgentes</small></div><div class="${summary.waitingOver24Hours ? 'danger-text' : ''}"><span>SLA &gt; 24H</span><strong>${summary.waitingOver24Hours || 0}</strong><small>sem atualização</small></div><div><span>TOTAL NA BASE</span><strong>${summary.total || 0}</strong><small>até ${state.ticketMeta?.limit || 250} mais recentes</small></div></div>
      <div class="support-workspace panel">
        <aside class="ticket-queue">
          <div class="queue-head"><div><h2>Caixa de entrada</h2><span>${tickets.filter((ticket) => !['resolved', 'closed'].includes(ticket.status)).length} pendente(s)</span></div><div class="search-field compact"><span>⌕</span><input data-search="ticket" value="${escape(state.filters.ticket)}" placeholder="Buscar chamado" /></div><div class="filter-tabs"><button class="${state.filters.ticketStatus === 'active' ? 'active' : ''}" data-action="ticket-filter" data-value="active">Ativos</button><button class="${state.filters.ticketStatus === 'open' ? 'active' : ''}" data-action="ticket-filter" data-value="open">Novos</button><button class="${state.filters.ticketStatus === 'completed' ? 'active' : ''}" data-action="ticket-filter" data-value="completed">Finalizados</button><button class="${state.filters.ticketStatus === 'all' ? 'active' : ''}" data-action="ticket-filter" data-value="all">Todos</button></div></div>
          <div class="queue-list">${tickets.map((ticket) => `<button class="queue-item ${String(ticket.id) === String(state.selectedTicketId) ? 'active' : ''}" data-action="select-ticket" data-id="${ticket.id}"><div><span class="avatar small">${initials(ticket.client_name)}</span><strong>${escape(ticket.client_name)}</strong><time>${relative(ticket.updated_at || ticket.created_at)}</time></div><h3>${escape(ticket.subject || 'Sem assunto')}</h3><p>${escape(ticket.messages?.at(-1)?.text || ticket.store_name || 'Aguardando primeira mensagem')}</p><footer>${priority(ticket.priority)}${sla(ticket)}</footer></button>`).join('') || '<p class="empty">Nenhum chamado nesta fila.</p>'}</div>
        </aside>
        <section class="conversation">${selected ? `<header class="conversation-head"><div><span class="avatar">${initials(selected.client_name)}</span><span><h2>${escape(selected.subject || 'Sem assunto')}</h2><p>${escape(selected.client_name)} · ${escape(selected.store_name || 'Geral')}</p></span></div><div>${priority(selected.priority)}${status(selected.status)}${!['resolved', 'closed'].includes(selected.status) ? `<button class="secondary small-button" data-action="resolve-ticket" data-id="${selected.id}">✓ Resolver</button>` : ''}</div></header>
          <div class="conversation-meta"><span><small>CRIADO</small><strong>${date(selected.created_at)}</strong></span><span><small>ÚLTIMA ATUALIZAÇÃO</small><strong>${relative(selected.updated_at || selected.created_at)}</strong></span><span><small>TEMPO NA FILA</small><strong>${sla(selected)}</strong></span><span><small>MENSAGENS</small><strong>${selected.messageCount ?? messages.length}</strong></span></div>
          <div class="messages">${messages.map((message) => `<article class="message ${message.sender_type === 'admin' ? 'mine' : ''}"><span class="message-avatar">${message.sender_type === 'admin' ? 'C' : initials(selected.client_name)}</span><div><header><strong>${message.sender_type === 'admin' ? 'Equipe ChefOS' : escape(selected.client_name)}</strong><time>${date(message.created_at)}</time></header><p>${escape(message.text)}</p></div></article>`).join('') || '<div class="empty-conversation"><i>✦</i><strong>Conversa ainda vazia</strong><small>Envie a primeira resposta para iniciar o atendimento.</small></div>'}</div>
          <form data-form="reply" data-ticket="${selected.id}" class="composer"><textarea name="text" required maxlength="10000" placeholder="Escreva uma resposta para ${escape(selected.client_name)}..."></textarea><div class="composer-hint">Ctrl + Enter para enviar · a resposta fica registrada na auditoria</div><footer><label>Atualizar como <select name="status"><option value="in_progress">Em atendimento</option><option value="resolved">Resolvido</option><option value="open">Aberto</option></select></label><button class="primary" type="submit">Enviar resposta →</button></footer></form>` : '<div class="empty-conversation full"><i>✦</i><strong>Selecione um chamado</strong><small>A conversa completa aparecerá aqui.</small></div>'}</section>
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
      return `<article class="plan-card ${plan.isMostPopular ? 'featured' : ''}"><header><span><div class="plan-labels"><small>${plan.recurring ? 'ASSINATURA' : 'ACESSO ÚNICO'}</small>${plan.isMostPopular ? '<b>MAIS POPULAR</b>' : ''}</div><h2>${escape(plan.name)}</h2><p>${escape(plan.description || 'Sem descrição comercial.')}</p></span><button class="row-action" data-action="edit-plan" data-id="${plan.id}">Editar</button></header><div class="plan-price"><strong>${money(plan.price)}</strong><span>${plan.recurring ? '/ mês' : ' pagamento único'}</span></div>${billingState}<div class="plan-stats"><span><strong>${subscribers}</strong><small>acessos ativos</small></span><span><strong>${plan.max_stores || 1}</strong><small>loja(s) incluída(s)</small></span><span><strong>${permissions.length}</strong><small>módulos</small></span></div><div class="permission-list">${permissions.slice(0, 5).map((key) => `<span>✓ ${escape(permissionLabel(key))}</span>`).join('') || '<span class="muted">Nenhum módulo incluído</span>'}${permissions.length > 5 ? `<small>+ ${permissions.length - 5} módulos incluídos</small>` : ''}</div><footer><span>${plan.trial_period_days || 0} dias de teste</span><div><button class="text-button" data-action="duplicate-plan" data-id="${plan.id}">Duplicar</button><button class="danger-link" data-action="delete-plan" data-id="${plan.id}" ${linkedSubscriptions ? 'disabled title="Plano com assinaturas vinculadas"' : ''}>Excluir</button></div></footer></article>`;
    }).join('');
    return `<section class="page">${pageHeader('ESTRATÉGIA COMERCIAL', 'Planos e módulos', 'Modele preço, recorrência, limites e acesso sem editar o banco manualmente.', `<button class="primary" data-action="open-plan">＋ Criar plano</button>`)}
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
      <div class="data-toolbar"><div class="search-field"><span>⌕</span><input data-search="catalog" value="${escape(query)}" placeholder="Buscar item, categoria ou código" /></div><select data-filter="catalogCategory" aria-label="Filtrar categoria"><option value="all">Todas as categorias</option>${state.menuCategories.map((item) => `<option value="${item.id}" ${String(category) === String(item.id) ? 'selected' : ''}>${escape(item.name)}</option>`).join('')}</select><select data-filter="catalogStatus" aria-label="Filtrar disponibilidade"><option value="all" ${availability === 'all' ? 'selected' : ''}>Todos os itens</option><option value="available" ${availability === 'available' ? 'selected' : ''}>Disponíveis</option><option value="paused" ${availability === 'paused' ? 'selected' : ''}>Pausados</option></select><button class="primary" data-action="open-catalog-item" ${state.selectedStore ? '' : 'disabled'}>＋ Novo item</button><span class="result-count">${rows.length} resultado(s)</span></div>
      <div class="panel table-wrap"><table><thead><tr><th>Produto</th><th>Categoria</th><th>Preço</th><th>Preparo</th><th>Disponibilidade</th><th></th></tr></thead><tbody>${rows.map((item) => `<tr><td><strong>${escape(item.name)}</strong><small>${escape(item.description || item.external_code || `ID ${String(item.id).slice(0, 8)}`)}</small></td><td>${escape(item.categories?.name || 'Geral')}</td><td><strong>${money(item.price)}</strong></td><td><strong>${item.prep_time_in_minutes || 0} min</strong></td><td><span class="availability ${item.is_available ? 'on' : 'off'}"><i></i>${item.is_available ? 'Disponível' : 'Pausado'}</span></td><td><div class="row-actions"><button class="row-action" data-action="edit-catalog-item" data-id="${item.id}">Editar</button><button class="row-action" data-action="toggle-menu" data-id="${item.id}" data-available="${item.is_available}">${item.is_available ? 'Pausar' : 'Ativar'}</button></div></td></tr>`).join('') || `<tr><td colspan="6" class="empty">${state.selectedStore ? 'Nenhum item encontrado nesta operação.' : 'Selecione um cliente com loja para gerenciar o cardápio.'}</td></tr>`}</tbody></table></div>
    </section>`;
  }

  function provision() {
    return `<section class="page onboarding-page">${pageHeader('NOVO CLIENTE', 'Onboarding ChefOS', 'Crie a conta, a operação e o acesso inicial em um único fluxo.', '')}
      <div class="onboarding-layout"><aside class="onboarding-steps"><span class="active"><i>1</i><strong>Criar acesso</strong><small>Nome, e-mail e senha</small></span><span><i>2</i><strong>Configurar operação</strong><small>Empresa e loja principal</small></span><span><i>3</i><strong>Ativar plano</strong><small>Teste, módulos e estrutura</small></span><div class="onboarding-note"><strong>Sem UUID manual</strong><p>A API cria a conta no Supabase Auth e usa o identificador internamente. Se o e-mail já existir, a conta é reutilizada sem trocar sua senha.</p></div></aside>
        <form class="panel onboarding-form" data-form="provision"><div class="onboarding-intro"><span>✦</span><div><strong>Ativação completa em uma ação</strong><p>Ao finalizar, o cliente poderá entrar no ChefOS com o e-mail e a senha inicial definidos abaixo.</p></div></div><div class="form-section"><span class="section-number">01</span><div><h2>Acesso do proprietário</h2><p class="muted">Estes dados criam a conta real do cliente.</p></div></div><div class="form-grid"><label>Nome completo<input name="fullName" required maxlength="160" autocomplete="off" placeholder="Ex.: Mariana Costa" /></label><label>E-mail de acesso<input name="email" type="email" required maxlength="254" autocomplete="off" placeholder="mariana@restaurante.com" /></label><label class="wide password-field">Senha inicial<span><input name="initialPassword" type="text" required minlength="10" maxlength="128" autocomplete="off" placeholder="Mínimo de 10 caracteres" /><button type="button" class="secondary" data-action="generate-password">Gerar senha segura</button></span><small>Guarde esta senha para entregar ao cliente. Ela não será salva no painel.</small></label></div><hr/><div class="form-section"><span class="section-number">02</span><div><h2>Empresa e operação</h2><p class="muted">Dados usados na loja principal e no perfil empresarial.</p></div></div><div class="form-grid"><label>Nome da operação<input name="storeName" required maxlength="180" placeholder="Ex.: Bistrô Central" /></label><label>CNPJ<input name="cnpj" required maxlength="30" placeholder="00.000.000/0001-00" /></label><label>Telefone<input name="phone" maxlength="40" placeholder="(00) 00000-0000" /></label><label>Endereço<input name="address" maxlength="300" placeholder="Rua, número, bairro e cidade" /></label></div><hr/><div class="form-section"><span class="section-number">03</span><div><h2>Plano e ativação</h2><p class="muted">O período de teste e os limites seguem o plano selecionado.</p></div></div><label>Plano ChefOS<select name="planId" required><option value="">Selecione o plano</option>${state.plans.map((plan) => `<option value="${plan.id}">${escape(plan.name)} — ${money(plan.price)}${plan.recurring ? '/mês' : ''} · ${plan.trial_period_days || 0} dias de teste</option>`).join('')}</select></label><label class="confirmation-check"><input type="checkbox" name="confirm" required /><span><strong>Confirmo a criação desta conta e estrutura</strong><small>Será criado o usuário, perfil, loja, assinatura, módulos, salão e seis mesas.</small></span></label><footer><span><i>✓</i> Todo o fluxo usa APIs administrativas auditadas</span><button class="primary" type="submit">Criar cliente e ativar ChefOS →</button></footer></form>
      </div></section>`;
  }

  function health() {
    const data = state.health || {};
    const healthy = data.status === 'healthy';
    return `<section class="page">${pageHeader('OBSERVABILIDADE', 'Saúde do sistema', 'Conectividade, ambiente e desempenho dos serviços administrativos.', `<button class="secondary" data-action="reload-health">↻ Executar verificação</button>`)}
      <div class="health-hero ${healthy ? 'healthy' : 'degraded'}"><div><i>${healthy ? '✓' : '!'}</i><span><small>STATUS GERAL</small><strong>${healthy ? 'Tudo operacional' : 'Atenção necessária'}</strong><p>${healthy ? 'Os serviços principais responderam normalmente.' : 'Uma ou mais verificações precisam de atenção.'}</p></span></div><span><small>LATÊNCIA TOTAL</small><strong>${data.latencyMs ?? '—'} ms</strong></span></div>
      <div class="check-grid">${Object.entries(data.checks || {}).map(([name, check]) => `<article class="panel check-card"><header><span class="check-icon ${check.status}">${check.status === 'ok' ? '✓' : '!'}</span>${status(check.status === 'ok' ? 'active' : 'past_due')}</header><h2>${escape(name)}</h2><p>${escape(check.message || '')}</p><footer><span>Latência</span><strong>${check.latencyMs ?? '—'} ms</strong></footer></article>`).join('') || '<div class="panel empty">Execute a verificação para carregar os serviços.</div>'}</div>
      ${data.system ? `<div class="panel system-info"><div><span>Node.js</span><strong>${escape(data.system.nodeVersion)}</strong></div><div><span>Uptime</span><strong>${data.system.uptimeSeconds}s</strong></div><div><span>Memória</span><strong>${data.system.memoryUsageMB} MB</strong></div><div><span>Última verificação</span><strong>${date(data.timestamp)}</strong></div></div>` : ''}
    </section>`;
  }

  function logs() {
    return `<section class="page">${pageHeader('GOVERNANÇA', 'Auditoria do sistema', 'Últimos eventos registrados pelas operações administrativas.', `<button class="secondary" data-action="reload-logs">↻ Atualizar eventos</button>`)}
      <div class="panel timeline">${(state.logs || []).map((log) => `<article><span class="timeline-dot"></span><div><header><strong>${escape(log.action || log.event_type || 'Evento')}</strong><time>${date(log.created_at)}</time></header><p>${escape(typeof log.details === 'object' ? JSON.stringify(log.details) : log.description || log.details || 'Sem descrição adicional')}</p></div></article>`).join('') || '<p class="empty">Nenhum evento de auditoria encontrado.</p>'}</div>
    </section>`;
  }

  function administrators() {
    return `<section class="page">${pageHeader('SEGURANÇA E ACESSO', 'Administradores', 'Controle quem pode operar o Control Center do ChefOS.', '')}
      <div class="access-layout"><div class="panel"><div class="panel-heading"><div><p class="eyebrow">EQUIPE</p><h2>Acessos ativos</h2></div><span class="count-badge">${state.admins?.length || 0}</span></div><div class="admin-list">${(state.admins || []).map((admin) => `<div><span class="avatar">${initials(admin.email)}</span><span><strong>${escape(admin.email)}</strong><small>${admin.protected ? 'Administrador raiz' : 'Administrador'} · desde ${day(admin.created_at)}</small></span>${admin.protected ? '<span class="root-badge">Protegido</span>' : `<button class="danger-link" data-action="delete-admin" data-email="${escape(admin.email)}">Remover</button>`}</div>`).join('') || '<p class="empty">Nenhum administrador encontrado.</p>'}</div></div>
        <form class="panel invite-card" data-form="admin"><span class="invite-icon">＋</span><p class="eyebrow">NOVO ACESSO</p><h2>Adicionar administrador</h2><p class="muted">O usuário precisa existir no Supabase Auth para conseguir entrar.</p><label>E-mail corporativo<input name="email" type="email" required placeholder="nome@chefos.online" /></label><button class="primary" type="submit">Autorizar acesso</button></form></div>
    </section>`;
  }

  function activePage() {
    const pages = { overview, subscriptions, tenants, support, plans, catalog, provision, health, logs, administrators };
    return pages[state.section]();
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
    return `<div class="modal-shell drawer-shell" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><button class="modal-backdrop" data-action="close-modal" aria-label="Fechar"></button><aside class="detail-drawer"><header><div class="avatar large">${initials(tenant.full_name)}</div><button class="icon-button" data-action="close-modal" aria-label="Fechar">×</button></header><div class="drawer-title"><p class="eyebrow">VISÃO 360º DO CLIENTE</p><h2 id="drawer-title">${escape(tenant.full_name)}</h2><p>${escape(tenant.email)}</p><div class="drawer-signals">${subscription ? status(subscription.status) : status('unknown')}${entitlement(subscription)}${onboarding(tenant)}</div></div><div class="detail-grid"><span><small>PLANO</small><strong>${escape(plan?.name || 'Sem plano')}</strong></span><span><small>VALOR CONTRATADO</small><strong>${money(plan?.price)}</strong></span><span><small>CLIENTE DESDE</small><strong>${day(tenant.created_at)}</strong></span><span><small>ÚLTIMO ACESSO</small><strong>${relative(tenant.last_sign_in_at || tenant.updated_at)}</strong></span><span><small>CHAMADOS ABERTOS</small><strong>${tenant.support?.openTickets || 0}</strong></span><span><small>PRIORITÁRIOS</small><strong>${tenant.support?.urgentTickets || 0}</strong></span></div>${tenant.onboarding?.missing?.length ? `<section class="drawer-checklist"><div class="panel-heading"><h3>Próximas ações</h3><span class="count-badge">${tenant.onboarding.missing.length}</span></div>${tenant.onboarding.missing.map((item) => `<div><i>!</i><span><strong>${escape(missingLabels[item] || item)}</strong><small>Necessário para concluir o onboarding</small></span></div>`).join('')}</section>` : '<div class="drawer-all-clear"><i>✓</i><span><strong>Onboarding completo</strong><small>Estrutura mínima pronta para operar.</small></span></div>'}<section><div class="panel-heading"><h3>Operações</h3><span class="count-badge">${tenant.stores?.length || 0}</span></div><div class="store-list">${(tenant.stores || []).map((store) => `<div><span>◫</span><span><strong>${escape(store.name)}</strong><small>ID ${escape(String(store.storeId || store.id).slice(0, 8))} · criada em ${day(store.created_at)}</small></span></div>`).join('') || '<p class="empty">Nenhuma operação vinculada.</p>'}</div></section><footer><button class="secondary" data-action="edit-subscription" data-id="${accountId}">Gerenciar assinatura</button><button class="primary" data-action="tenant-catalog" data-id="${accountId}">Ver cardápio</button></footer></aside></div>`;
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
    return `<div class="modal-shell" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button class="modal-backdrop" data-action="close-modal" aria-label="Fechar"></button><section class="modal-card onboarding-success"><header><div><p class="eyebrow">ATIVAÇÃO CONCLUÍDA</p><h2 id="modal-title">Cliente pronto para entrar</h2><p>${auth.userCreated ? 'A conta e a estrutura ChefOS foram criadas.' : 'A conta existente foi reutilizada e a estrutura foi validada.'}</p></div><button type="button" class="icon-button" data-action="close-modal" aria-label="Fechar">×</button></header><div class="modal-body"><div class="success-mark">✓</div><div class="credential-list"><div><span><small>E-MAIL DE ACESSO</small><strong>${escape(auth.email || '')}</strong></span><button class="row-action" data-action="copy-onboarding" data-copy="email">Copiar</button></div>${auth.userCreated ? `<div><span><small>SENHA INICIAL</small><strong>${escape(state.modal.password || '')}</strong></span><button class="row-action" data-action="copy-onboarding" data-copy="password">Copiar</button></div>` : '<div class="credential-note"><i>i</i><span><strong>Senha preservada</strong><small>O e-mail já existia; a senha informada não foi aplicada.</small></span></div>'}<div><span><small>OPERAÇÃO</small><strong>${escape(tenant.storeName || '')}</strong></span></div><div><span><small>PLANO INICIAL</small><strong>${escape(plan?.name || 'Plano configurado')}</strong></span></div><div><span><small>CHAVE DE INTEGRAÇÃO</small><strong class="technical-value">${escape(tenant.apiKey || '')}</strong></span><button class="row-action" data-action="copy-onboarding" data-copy="apiKey">Copiar</button></div></div><div class="security-reminder"><strong>Entregue as credenciais por um canal seguro</strong><p>A senha inicial só permanece nesta tela enquanto o modal estiver aberto.</p></div></div><footer><button class="secondary" data-action="close-modal">Fechar</button><button class="primary" data-action="view-provisioned-customer" data-id="${tenant.accountId || ''}">Abrir visão do cliente</button></footer></section></div>`;
  }

  function modalView() {
    if (!state.modal) return '';
    if (state.modal.type === 'subscription') return subscriptionModal(state.tenants.find((tenant) => String(tenant.id) === String(state.modal.id)));
    if (state.modal.type === 'tenant') return tenantModal(state.tenants.find((tenant) => String(tenant.id) === String(state.modal.id)));
    if (state.modal.type === 'plan') return planModal();
    if (state.modal.type === 'catalog-item') return catalogItemModal();
    if (state.modal.type === 'onboarding-success') return onboardingSuccessModal();
    return '';
  }

  function shell() {
    return `<div class="app-shell">${sidebar()}<div class="workspace">${topbar()}<main class="content">${state.notice ? `<div class="notice ${state.notice.type}" role="status"><span>${state.notice.type === 'error' ? '!' : '✓'}</span>${escape(state.notice.text)}<button data-action="dismiss-notice" aria-label="Fechar">×</button></div>` : ''}${state.loading ? '<div class="loading"><i></i>Atualizando operação...</div>' : ''}${activePage()}</main></div>${state.sidebarOpen ? '<button class="sidebar-backdrop" data-action="toggle-sidebar" aria-label="Fechar menu"></button>' : ''}${modalView()}</div>`;
  }

  function render(focusKey = '') {
    if (!configured()) { app.innerHTML = missingConfigView(); return; }
    app.innerHTML = state.user ? shell() : loginView();
    if (focusKey) {
      const input = document.querySelector(`[data-search="${focusKey}"]`);
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }
    document.body.classList.toggle('modal-open', Boolean(state.modal));
  }

  async function safe(action) {
    try { await action(); } catch (error) { state.loading = false; showNotice(error.message || 'Ocorreu um erro.', 'error'); }
  }

  function openSection(section) {
    state.section = section;
    state.sidebarOpen = false;
    state.globalQuery = '';
    state.loading = true;
    render();
    return loadSection(section).finally(() => { state.loading = false; render(); });
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

  document.addEventListener('submit', (event) => safe(async () => {
    const form = event.target.closest('form');
    if (!form) return;
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    if (form.dataset.form === 'login') {
      state.loading = true; render();
      await signIn(values.email, values.password);
      await loadCore();
      return;
    }
    if (form.dataset.form === 'subscription') {
      const currentPeriodEnd = values.currentPeriodEnd ? new Date(`${values.currentPeriodEnd}T23:59:59`).toISOString() : undefined;
      const result = await api('/api/admin/subscriptions', { method: 'POST', body: { accountId: values.accountId, status: values.status, planId: values.planId, currentPeriodEnd, reason: values.reason } });
      state.modal = null;
      await loadCore();
      showNotice(result.warning || 'Assinatura atualizada e registrada na auditoria.');
      return;
    }
    if (form.dataset.form === 'plan') {
      const editing = Boolean(values.id);
      const permissions = [...new Set(new FormData(form).getAll('permissions').map((key) => String(key)).filter(Boolean))];
      await api('/api/admin/plans', { method: editing ? 'PUT' : 'POST', body: { id: values.id || undefined, plan: { name: values.name, slug: values.slug, description: values.description, price: Number(values.price), trial_period_days: Number(values.trial), max_stores: Number(values.stores), recurring: values.recurring === 'on', isMostPopular: values.popular === 'on', preapproval_plan_id: values.preapprovalPlanId, mp_reason: values.mpReason }, permissions } });
      const plans = await api('/api/admin/plans');
      state.plans = plans.data || [];
      state.permissionCatalog = plans.permissionCatalog || state.permissionCatalog;
      state.modal = null;
      showNotice(editing ? 'Plano atualizado com sucesso.' : 'Plano criado com sucesso.');
      return;
    }
    if (form.dataset.form === 'catalog-item') {
      const item = { name: values.name, category: values.category, price: Number(values.price), prep_time_in_minutes: Number(values.prepTime), description: values.description, external_code: values.externalCode, is_available: values.available === 'on' };
      await api('/api/admin/tenant-menu', { method: values.id ? 'PUT' : 'POST', body: { storeId: state.selectedStore, id: values.id || undefined, item } });
      state.modal = null;
      await loadSection('catalog');
      showNotice(values.id ? 'Item atualizado no cardápio.' : 'Item adicionado ao cardápio.');
      return;
    }
    if (form.dataset.form === 'reply') {
      await api('/api/admin/messages', { method: 'POST', body: { ticket_id: form.dataset.ticket, text: values.text, status_update: values.status } });
      const tickets = await api('/api/admin/tickets');
      state.tickets = tickets.data || [];
      state.ticketSummary = tickets.summary || null;
      state.ticketMeta = tickets.meta || null;
      showNotice('Resposta enviada ao cliente.');
      return;
    }
    if (form.dataset.form === 'provision') {
      state.loading = true; render();
      const result = await api('/api/admin/provision-tenant', { method: 'POST', body: values });
      await loadCore();
      state.modal = { type: 'onboarding-success', data: result, password: values.initialPassword };
      render();
      return;
    }
    if (form.dataset.form === 'admin') {
      await api('/api/admin/administrators', { method: 'POST', body: values });
      state.admins = (await api('/api/admin/administrators')).data || [];
      showNotice('Administrador autorizado.');
    }
  }));

  document.addEventListener('click', (event) => safe(async () => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'logout') return signOut();
    if (action === 'section' || action === 'command-section') return openSection(target.dataset.section);
    if (action === 'filtered-section') { state.filters.subscriptionStatus = target.dataset.filter; return openSection(target.dataset.section); }
    if (action === 'toggle-sidebar') { state.sidebarOpen = !state.sidebarOpen; render(); return; }
    if (action === 'refresh') return loadCore();
    if (action === 'dismiss-notice') { state.notice = null; render(); return; }
    if (action === 'close-modal') { state.modal = null; render(); return; }
    if (action === 'open-plan') { state.modal = { type: 'plan' }; render(); return; }
    if (action === 'edit-plan') { state.modal = { type: 'plan', id: target.dataset.id }; render(); return; }
    if (action === 'duplicate-plan') { state.modal = { type: 'plan', id: target.dataset.id, duplicate: true }; render(); return; }
    if (action === 'select-all-permissions' || action === 'clear-permissions') {
      const form = target.closest('form');
      form?.querySelectorAll('input[type="checkbox"][name="permissions"]').forEach((checkbox) => { checkbox.checked = action === 'select-all-permissions'; });
      updatePermissionSummary(form);
      return;
    }
    if (action === 'toggle-permission-group') {
      const form = target.closest('form');
      const checkboxes = [...target.closest('[data-permission-group]')?.querySelectorAll('input[name="permissions"]') || []];
      const shouldSelect = checkboxes.some((checkbox) => !checkbox.checked);
      checkboxes.forEach((checkbox) => { checkbox.checked = shouldSelect; });
      updatePermissionSummary(form);
      return;
    }
    if (action === 'open-catalog-item') { state.modal = { type: 'catalog-item' }; render(); return; }
    if (action === 'edit-catalog-item') { state.modal = { type: 'catalog-item', id: target.dataset.id }; render(); return; }
    if (action === 'generate-password') {
      const input = target.closest('form')?.querySelector('[name="initialPassword"]');
      if (input) { input.value = randomPassword(); input.focus(); input.select(); }
      return;
    }
    if (action === 'copy-onboarding') {
      const values = { email: state.modal?.data?.auth?.email, password: state.modal?.password, apiKey: state.modal?.data?.tenant?.apiKey };
      await navigator.clipboard.writeText(String(values[target.dataset.copy] || ''));
      showNotice('Informação copiada com segurança.');
      return;
    }
    if (action === 'view-provisioned-customer') { state.modal = { type: 'tenant', id: target.dataset.id }; render(); return; }
    if (action === 'open-provision') return openSection('provision');
    if (action === 'open-tenant') { state.globalQuery = ''; state.modal = { type: 'tenant', id: target.dataset.id }; render(); return; }
    if (action === 'edit-subscription') { state.modal = { type: 'subscription', id: target.dataset.id }; render(); return; }
    if (action === 'tenant-catalog') {
      state.modal = null;
      state.selectedTenant = target.dataset.id;
      const tenant = state.tenants.find((item) => String(item.accountId || item.id) === String(target.dataset.id));
      state.selectedStore = tenant?.stores?.[0]?.storeId || tenant?.stores?.[0]?.id || '';
      return openSection('catalog');
    }
    if (action === 'export') { downloadCsv(target.dataset.kind); return; }
    if (action === 'ticket-filter') { state.filters.ticketStatus = target.dataset.value; render(); return; }
    if (action === 'select-ticket') { state.selectedTicketId = target.dataset.id; render(); return; }
    if (action === 'open-ticket') { state.selectedTicketId = target.dataset.id; return openSection('support'); }
    if (action === 'reload-tickets') { state.loading = true; render(); await loadSection('support', true); state.loading = false; render(); return; }
    if (action === 'resolve-ticket') {
      await api('/api/admin/tickets', { method: 'PUT', body: { id: target.dataset.id, updates: { status: 'resolved' } } });
      const tickets = await api('/api/admin/tickets');
      state.tickets = tickets.data || [];
      state.ticketSummary = tickets.summary || null;
      state.ticketMeta = tickets.meta || null;
      showNotice('Chamado marcado como resolvido.');
      return;
    }
    if (action === 'reload-health') { state.health = null; state.loading = true; render(); await loadSection('health', true); state.loading = false; render(); return; }
    if (action === 'reload-logs') { state.logs = null; state.loading = true; render(); await loadSection('logs', true); state.loading = false; render(); return; }
    if (action === 'toggle-menu') {
      await api('/api/admin/tenant-menu', { method: 'PUT', body: { storeId: state.selectedStore, id: target.dataset.id, item: { is_available: target.dataset.available !== 'true' } } });
      await loadSection('catalog'); render(); showNotice('Disponibilidade atualizada.'); return;
    }
    if (action === 'delete-plan') {
      if (!confirm('Excluir este plano? Assinaturas vinculadas podem impedir a exclusão.')) return;
      await api('/api/admin/plans', { method: 'DELETE', body: { id: target.dataset.id } });
      state.plans = (await api('/api/admin/plans')).data || []; showNotice('Plano excluído.'); return;
    }
    if (action === 'delete-admin') {
      if (!confirm(`Remover ${target.dataset.email} do Control Center?`)) return;
      await api('/api/admin/administrators', { method: 'DELETE', body: { email: target.dataset.email } });
      state.admins = (await api('/api/admin/administrators')).data || []; showNotice('Acesso removido.');
    }
  }));

  document.addEventListener('input', (event) => {
    const permissionSearch = event.target.closest('[data-permission-search]');
    if (permissionSearch) { filterPermissionOptions(permissionSearch); return; }
    const input = event.target.closest('[data-search]');
    if (!input) return;
    const key = input.dataset.search;
    if (key === 'global') state.globalQuery = input.value;
    else state.filters[key] = input.value;
    render(key);
  });

  document.addEventListener('change', (event) => safe(async () => {
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

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      document.querySelector('[data-search="global"]')?.focus();
    }
    if (event.key === 'Escape') {
      state.modal = null;
      state.sidebarOpen = false;
      state.globalQuery = '';
      render();
    }
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      const form = event.target.closest('form[data-form="reply"]');
      if (form) {
        event.preventDefault();
        form.requestSubmit();
      }
    }
  });

  async function boot() {
    render();
    if (!configured() || !state.token) return;
    try {
      state.user = (await api('/api/admin/session')).data;
      await loadCore();
    } catch {
      await signOut();
      showNotice('Sua sessão expirou. Entre novamente.', 'error');
    }
  }

  boot();
})();
