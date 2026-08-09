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
    tickets: null,
    ticketSummary: null,
    ticketMeta: null,
    menu: [],
    selectedTenant: '',
    selectedTicketId: '',
    admins: null,
    health: null,
    logs: null,
    notice: null,
    modal: null,
    sidebarOpen: false,
    globalQuery: '',
    filters: { customer: '', subscription: '', subscriptionStatus: 'all', ticket: '', ticketStatus: 'active' }
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
  const subscriptionOf = (tenant) => tenant?.subscription || tenant?.subscriptions?.[0] || null;
  const initials = (value = '') => value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'C';
  const normalize = (value = '') => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const includes = (haystack, needle) => normalize(haystack).includes(normalize(needle));
  const toInputDate = (value) => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toISOString().slice(0, 10) : '';

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
      active: 'Ativa', trialing: 'Em trial', past_due: 'Inadimplente', canceled: 'Cancelada', unpaid: 'Não paga',
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
      Object.assign(state, { token: '', user: null, dashboard: null, tenants: [], customerSummary: null, customerMeta: null, plans: [], tickets: null, ticketSummary: null, ticketMeta: null, menu: [], admins: null, health: null, logs: null });
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
      state.tickets = tickets.data || [];
      state.ticketSummary = tickets.summary || null;
      state.ticketMeta = tickets.meta || null;
      if (!state.selectedTenant && state.tenants[0]) state.selectedTenant = state.tenants[0].accountId || state.tenants[0].id;
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
    if (section === 'catalog' && state.selectedTenant) state.menu = (await api(`/api/admin/tenant-menu?tenantId=${encodeURIComponent(state.selectedTenant)}`)).data || [];
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
        <button data-action="filtered-section" data-section="subscriptions" data-filter="trialing"><span>TRIALS ENCERRANDO</span><strong>${data.trialsEnding7Days || 0}</strong><small>nos próximos 7 dias</small></button>
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
      <div class="data-toolbar"><div class="search-field"><span>⌕</span><input data-search="subscription" value="${escape(query)}" placeholder="Buscar cliente, e-mail ou loja" /></div><select data-filter="subscriptionStatus" aria-label="Filtrar status"><option value="all" ${filter === 'all' ? 'selected' : ''}>Todos os status</option><option value="active" ${filter === 'active' ? 'selected' : ''}>Ativas</option><option value="trialing" ${filter === 'trialing' ? 'selected' : ''}>Em trial</option><option value="past_due" ${filter === 'past_due' ? 'selected' : ''}>Inadimplentes</option><option value="unpaid" ${filter === 'unpaid' ? 'selected' : ''}>Não pagas</option><option value="canceled" ${filter === 'canceled' ? 'selected' : ''}>Canceladas</option></select><span class="result-count">${rows.length} resultado(s)</span></div>
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
    const planCards = state.plans.map((plan) => {
      const subscribers = state.tenants.filter((tenant) => tenant.subscriptions?.some((subscription) => String(subscription.plan_id) === String(plan.id) && subscription.status === 'active')).length;
      const permissions = (plan.plan_permissions || []).map((permission) => permission.permission_key);
      return `<article class="plan-card"><header><span><small>PLANO</small><h2>${escape(plan.name)}</h2></span><button class="more-button" aria-label="Opções">•••</button></header><div class="plan-price"><strong>${money(plan.price)}</strong><span>/ mês</span></div><div class="plan-stats"><span><strong>${subscribers}</strong><small>assinantes ativos</small></span><span><strong>${plan.max_stores || 1}</strong><small>loja(s) incluída(s)</small></span></div><div class="permission-list">${permissions.slice(0, 5).map((key) => `<span>✓ ${escape(key)}</span>`).join('') || '<span class="muted">Nenhuma permissão vinculada</span>'}${permissions.length > 5 ? `<small>+ ${permissions.length - 5} permissões</small>` : ''}</div><footer><span>${plan.trial_period_days || 0} dias de trial</span><button class="danger-link" data-action="delete-plan" data-id="${plan.id}">Excluir plano</button></footer></article>`;
    }).join('');
    return `<section class="page">${pageHeader('ESTRATÉGIA COMERCIAL', 'Planos e permissões', 'Defina o catálogo comercial e o que cada assinatura pode acessar.', `<button class="primary" data-action="open-plan">＋ Criar plano</button>`)}<div class="plan-grid">${planCards || '<div class="panel empty">Nenhum plano cadastrado.</div>'}</div></section>`;
  }

  function catalog() {
    const selected = state.tenants.find((tenant) => String(tenant.id) === String(state.selectedTenant));
    const options = state.tenants.map((tenant) => `<option value="${tenant.id}" ${String(tenant.id) === String(state.selectedTenant) ? 'selected' : ''}>${escape(tenant.full_name)} — ${escape(tenant.stores?.[0]?.name || tenant.email)}</option>`).join('');
    const available = state.menu.filter((item) => item.is_available).length;
    return `<section class="page">${pageHeader('OPERAÇÃO DO PRODUTO', 'Inspetor de cardápios', 'Consulte e controle a disponibilidade dos itens de cada cliente.', `<select class="tenant-select" data-action="select-tenant" aria-label="Selecionar cliente">${options}</select>`)}
      <div class="summary-strip"><div><span>Cliente selecionado</span><strong>${escape(selected?.full_name || '—')}</strong></div><div><span>Itens no cardápio</span><strong>${state.menu.length}</strong></div><div><span>Disponíveis</span><strong>${available}</strong></div><div><span>Pausados</span><strong>${state.menu.length - available}</strong></div></div>
      <div class="panel table-wrap"><table><thead><tr><th>Produto</th><th>Categoria</th><th>Preço</th><th>Disponibilidade</th><th></th></tr></thead><tbody>${state.menu.map((item) => `<tr><td><strong>${escape(item.name)}</strong><small>ID ${escape(String(item.id).slice(0, 8))}</small></td><td>${escape(item.categories?.name || 'Geral')}</td><td><strong>${money(item.price)}</strong></td><td><span class="availability ${item.is_available ? 'on' : 'off'}"><i></i>${item.is_available ? 'Disponível' : 'Pausado'}</span></td><td><button class="row-action" data-action="toggle-menu" data-id="${item.id}" data-available="${item.is_available}">${item.is_available ? 'Pausar item' : 'Disponibilizar'}</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Este cliente ainda não possui itens no cardápio.</td></tr>'}</tbody></table></div>
    </section>`;
  }

  function provision() {
    return `<section class="page onboarding-page">${pageHeader('NOVO CLIENTE', 'Onboarding ChefOS', 'Crie a estrutura inicial completa para uma nova operação.', '')}
      <div class="onboarding-layout"><aside class="onboarding-steps"><span class="active"><i>1</i><strong>Identidade</strong><small>Conta existente no Auth</small></span><span><i>2</i><strong>Plano e acesso</strong><small>Trial conforme o plano</small></span><span><i>3</i><strong>Estrutura inicial</strong><small>Loja, salão e mesas</small></span><div class="onboarding-note"><strong>Fluxo seguro para reenvio</strong><p>A API reaproveita loja e assinatura existentes. Se uma etapa falhar, corrija a causa e envie novamente sem duplicar a estrutura principal.</p></div></aside>
        <form class="panel onboarding-form" data-form="provision"><div class="integration-warning compact-warning"><span>i</span><div><strong>A conta precisa existir primeiro</strong><p>Crie ou convide o proprietário no Supabase Auth e cole abaixo o UUID da conta — não o ID da loja.</p></div></div><div class="form-section"><span class="section-number">01</span><div><h2>Cliente e operação</h2><p class="muted">A API valida a identidade antes de criar qualquer dado.</p></div></div><div class="form-grid"><label>ID da conta (UUID)<input name="accountId" required minlength="36" maxlength="36" placeholder="00000000-0000-0000-0000-000000000000" /></label><label>Nome da operação<input name="storeName" required maxlength="180" placeholder="Ex.: Bistrô Central" /></label><label>CNPJ<input name="cnpj" maxlength="30" placeholder="00.000.000/0001-00" /></label><label>Telefone<input name="phone" maxlength="40" placeholder="(00) 00000-0000" /></label><label class="wide">Endereço<input name="address" maxlength="300" placeholder="Rua, número, bairro e cidade" /></label></div><hr/><div class="form-section"><span class="section-number">02</span><div><h2>Plano inicial</h2><p class="muted">O período de trial segue a configuração real do plano selecionado.</p></div></div><label>Plano ChefOS<select name="planId"><option value="">Selecionar automaticamente o plano de entrada</option>${state.plans.map((plan) => `<option value="${plan.id}">${escape(plan.name)} — ${money(plan.price)}/mês · ${plan.trial_period_days || 0} dias de trial</option>`).join('')}</select></label><footer><span><i>✓</i> Loja, perfil, acesso, salão, 6 mesas e chave UUID via API</span><button class="primary" type="submit">Provisionar estrutura →</button></footer></form>
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
    return `<div class="modal-shell" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button class="modal-backdrop" data-action="close-modal" aria-label="Fechar"></button><form class="modal-card" data-form="subscription"><header><div><p class="eyebrow">GESTÃO DE ACESSO</p><h2 id="modal-title">Assinatura de ${escape(tenant.full_name)}</h2><p>${escape(tenant.email)}</p></div><button type="button" class="icon-button" data-action="close-modal" aria-label="Fechar">×</button></header><div class="modal-body"><input type="hidden" name="accountId" value="${accountId}"/><div class="modal-alert"><strong>Atenção à cobrança</strong><p>Esta ação altera o acesso interno. A recorrência do Mercado Pago ainda precisa ser gerenciada separadamente.</p></div><label>Status<select name="status" required><option value="active" ${subscription.status === 'active' ? 'selected' : ''}>Ativa</option><option value="trialing" ${subscription.status === 'trialing' ? 'selected' : ''}>Em trial</option><option value="past_due" ${subscription.status === 'past_due' ? 'selected' : ''}>Inadimplente</option><option value="unpaid" ${subscription.status === 'unpaid' ? 'selected' : ''}>Não paga</option><option value="canceled" ${subscription.status === 'canceled' ? 'selected' : ''}>Cancelada</option></select></label><label>Plano<select name="planId" required>${state.plans.map((plan) => `<option value="${plan.id}" ${String(subscription.plan_id) === String(plan.id) ? 'selected' : ''}>${escape(plan.name)} — ${money(plan.price)}/mês</option>`).join('')}</select></label><label>Fim do período atual<input name="currentPeriodEnd" type="date" value="${toInputDate(subscription.current_period_end)}" ${subscription.id ? '' : 'required'} /></label><label>Motivo da alteração<textarea name="reason" required minlength="5" maxlength="500" placeholder="Ex.: pagamento confirmado manualmente pelo financeiro"></textarea></label><div class="modal-summary"><span><small>SAÚDE DO ACESSO</small><strong>${entitlement(subscription)}</strong></span><span><small>VALOR DO PLANO</small><strong>${money(planById(subscription.plan_id)?.price)}</strong></span></div></div><footer><button type="button" class="secondary" data-action="close-modal">Cancelar</button><button class="primary" type="submit">Salvar com auditoria</button></footer></form></div>`;
  }

  function tenantModal(tenant) {
    const subscription = subscriptionOf(tenant) || {};
    const plan = planById(subscription.plan_id);
    const accountId = tenant.accountId || tenant.id;
    const missingLabels = { store: 'Criar loja principal', company_profile: 'Completar perfil da empresa', company_data: 'Completar dados fiscais da empresa', subscription: 'Configurar assinatura' };
    return `<div class="modal-shell drawer-shell" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><button class="modal-backdrop" data-action="close-modal" aria-label="Fechar"></button><aside class="detail-drawer"><header><div class="avatar large">${initials(tenant.full_name)}</div><button class="icon-button" data-action="close-modal" aria-label="Fechar">×</button></header><div class="drawer-title"><p class="eyebrow">VISÃO 360º DO CLIENTE</p><h2 id="drawer-title">${escape(tenant.full_name)}</h2><p>${escape(tenant.email)}</p><div class="drawer-signals">${subscription ? status(subscription.status) : status('unknown')}${entitlement(subscription)}${onboarding(tenant)}</div></div><div class="detail-grid"><span><small>PLANO</small><strong>${escape(plan?.name || 'Sem plano')}</strong></span><span><small>VALOR CONTRATADO</small><strong>${money(plan?.price)}</strong></span><span><small>CLIENTE DESDE</small><strong>${day(tenant.created_at)}</strong></span><span><small>ÚLTIMO ACESSO</small><strong>${relative(tenant.last_sign_in_at || tenant.updated_at)}</strong></span><span><small>CHAMADOS ABERTOS</small><strong>${tenant.support?.openTickets || 0}</strong></span><span><small>PRIORITÁRIOS</small><strong>${tenant.support?.urgentTickets || 0}</strong></span></div>${tenant.onboarding?.missing?.length ? `<section class="drawer-checklist"><div class="panel-heading"><h3>Próximas ações</h3><span class="count-badge">${tenant.onboarding.missing.length}</span></div>${tenant.onboarding.missing.map((item) => `<div><i>!</i><span><strong>${escape(missingLabels[item] || item)}</strong><small>Necessário para concluir o onboarding</small></span></div>`).join('')}</section>` : '<div class="drawer-all-clear"><i>✓</i><span><strong>Onboarding completo</strong><small>Estrutura mínima pronta para operar.</small></span></div>'}<section><div class="panel-heading"><h3>Operações</h3><span class="count-badge">${tenant.stores?.length || 0}</span></div><div class="store-list">${(tenant.stores || []).map((store) => `<div><span>◫</span><span><strong>${escape(store.name)}</strong><small>ID ${escape(String(store.storeId || store.id).slice(0, 8))} · criada em ${day(store.created_at)}</small></span></div>`).join('') || '<p class="empty">Nenhuma operação vinculada.</p>'}</div></section><footer><button class="secondary" data-action="edit-subscription" data-id="${accountId}">Gerenciar assinatura</button><button class="primary" data-action="tenant-catalog" data-id="${accountId}">Ver cardápio</button></footer></aside></div>`;
  }

  function planModal() {
    return `<div class="modal-shell" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button class="modal-backdrop" data-action="close-modal" aria-label="Fechar"></button><form class="modal-card large-modal" data-form="plan"><header><div><p class="eyebrow">CATÁLOGO COMERCIAL</p><h2 id="modal-title">Criar novo plano</h2><p>Configure preço, limites e acesso do plano.</p></div><button type="button" class="icon-button" data-action="close-modal" aria-label="Fechar">×</button></header><div class="modal-body form-grid"><label>Nome do plano<input name="name" required placeholder="Profissional" /></label><label>Identificador<input name="slug" required placeholder="profissional" /></label><label>Preço mensal<input name="price" type="number" step="0.01" min="0" required placeholder="199,00" /></label><label>Trial (dias)<input name="trial" type="number" min="0" value="30" /></label><label>Máximo de lojas<input name="stores" type="number" min="1" value="1" /></label><label class="wide">Permissões separadas por vírgula<input name="permissions" placeholder="/dashboard, /pos, /reports" /></label></div><footer><button type="button" class="secondary" data-action="close-modal">Cancelar</button><button class="primary" type="submit">Criar plano</button></footer></form></div>`;
  }

  function modalView() {
    if (!state.modal) return '';
    if (state.modal.type === 'subscription') return subscriptionModal(state.tenants.find((tenant) => String(tenant.id) === String(state.modal.id)));
    if (state.modal.type === 'tenant') return tenantModal(state.tenants.find((tenant) => String(tenant.id) === String(state.modal.id)));
    if (state.modal.type === 'plan') return planModal();
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
      await api('/api/admin/plans', { method: 'POST', body: { plan: { name: values.name, slug: values.slug, price: Number(values.price), trial_period_days: Number(values.trial), max_stores: Number(values.stores) }, permissions: String(values.permissions || '').split(',').map((item) => item.trim()).filter(Boolean) } });
      state.plans = (await api('/api/admin/plans')).data || [];
      state.modal = null;
      showNotice('Plano criado com sucesso.');
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
      showNotice(`${result.idempotent ? 'Estrutura existente validada' : 'Cliente provisionado'}. Chave de integração: ${result.tenant.apiKey}`);
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
    if (action === 'open-provision') return openSection('provision');
    if (action === 'open-tenant') { state.globalQuery = ''; state.modal = { type: 'tenant', id: target.dataset.id }; render(); return; }
    if (action === 'edit-subscription') { state.modal = { type: 'subscription', id: target.dataset.id }; render(); return; }
    if (action === 'tenant-catalog') { state.modal = null; state.selectedTenant = target.dataset.id; return openSection('catalog'); }
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
      await api('/api/admin/tenant-menu', { method: 'PUT', body: { id: target.dataset.id, updates: { is_available: target.dataset.available !== 'true' } } });
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
    const input = event.target.closest('[data-search]');
    if (!input) return;
    const key = input.dataset.search;
    if (key === 'global') state.globalQuery = input.value;
    else state.filters[key] = input.value;
    render(key);
  });

  document.addEventListener('change', (event) => safe(async () => {
    const filter = event.target.closest('[data-filter]');
    if (filter) { state.filters[filter.dataset.filter] = filter.value; render(); return; }
    const select = event.target.closest('[data-action="select-tenant"]');
    if (!select) return;
    state.selectedTenant = select.value;
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
