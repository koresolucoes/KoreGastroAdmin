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
    plans: [],
    tickets: null,
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
    { label: 'Opera√ß√£o', items: [
      ['overview', 'Vis√£o geral', '‚åÇ'], ['subscriptions', 'Assinaturas', '‚óé'],
      ['tenants', 'Clientes', '‚ó´'], ['support', 'Suporte', '‚ú¶']
    ] },
    { label: 'Produto', items: [
      ['plans', 'Planos', '‚óá'], ['catalog', 'Card√°pios', '‚â°'], ['provision', 'Onboarding', '+']
    ] },
    { label: 'Sistema', items: [
      ['health', 'Sa√∫de', '‚ô•'], ['logs', 'Auditoria', '‚âã'], ['administrators', 'Acessos', '‚öô']
    ] }
  ];
  const sectionLabels = Object.fromEntries(navigation.flatMap((group) => group.items.map(([key, label]) => [key, label])));

  const escape = (value = '') => String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
  const date = (value) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '‚Äî';
  const day = (value) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(value)) : '‚Äî';
  const shortNumber = (value) => new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value || 0));
  const apiUrl = (path) => `${String(config.apiBaseUrl || '').replace(/\/$/, '')}${path}`;
  const configured = () => Boolean(config.supabaseUrl && config.supabaseAnonKey);
  const planById = (id) => state.plans.find((plan) => String(plan.id) === String(id));
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
      active: 'Ativa', trialing: 'Em trial', past_due: 'Inadimplente', canceled: 'Cancelada',
      open: 'Aberto', in_progress: 'Em atendimento', resolved: 'Resolvido', unknown: 'Sem status'
    };
    const safe = value || 'unknown';
    return `<span class="status status-${escape(safe)}"><i></i>${labels[safe] || escape(safe)}</span>`;
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
    if (!response.ok) throw new Error(body.error || 'N√£o foi poss√≠vel concluir a opera√ß√£o.');
    return body;
  }

  async function signIn(email, password) {
    const response = await fetch(`${String(config.supabaseUrl).replace(/\/$/, '')}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${config.supabaseAnonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.access_token) throw new Error(body.error_description || 'Credenciais inv√°lidas.');
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
      Object.assign(state, { token: '', user: null, dashboard: null, tenants: [], plans: [], tickets: null, menu: [], admins: null, health: null, logs: null });
      render();
    }
  }

  async function loadCore() {
    state.loading = true;
    render();
    try {
      const [dashboard, tenants, plans, tickets] = await Promise.all([
        api('/api/admin/dashboard'), api('/api/admin/restaurants'), api('/api/admin/plans'), api('/api/admin/tickets')
      ]);
      state.dashboard = dashboard.data;
      state.tenants = tenants.data || [];
      state.plans = plans.data || [];
      state.tickets = tickets.data || [];
      if (!state.selectedTenant && state.tenants[0]) state.selectedTenant = state.tenants[0].id;
      if (!state.selectedTicketId && state.tickets[0]) state.selectedTicketId = state.tickets[0].id;
    } finally {
      state.loading = false;
      render();
    }
  }

  async function loadSection(section = state.section, force = false) {
    if (section === 'support' && (force || !state.tickets)) state.tickets = (await api('/api/admin/tickets')).data || [];
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
        <p class="muted">Gerencie toda a opera√ß√£o ChefOS com uma conta autorizada.</p>
        <label>E-mail<input type="email" name="email" autocomplete="email" placeholder="admin@chefos.online" required /></label>
        <label>Senha<input type="password" name="password" autocomplete="current-password" placeholder="Sua senha" required /></label>
        <button class="primary wide-button" type="submit">Entrar no Control Center</button>
        <small class="secure-note"><i></i>Sess√£o protegida pelo Supabase</small>
      </form>
    </section>`;
  }

  function missingConfigView() {
    return `<section class="login-shell"><div class="login-card"><p class="eyebrow">CONFIGURA√á√ÉO PENDENTE</p><h1>Painel pronto para conectar</h1><p class="muted">Configure <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> antes do deploy.</p></div></section>`;
  }

  function sidebar() {
    const groups = navigation.map((group) => `<div class="nav-group"><span class="nav-label">${group.label}</span>${group.items.map(([key, label, glyph]) => {
      const badge = key === 'support' && (state.dashboard?.openTickets || 0) ? `<b>${state.dashboard.openTickets}</b>` : '';
      return `<button class="nav-item ${state.section === key ? 'active' : ''}" data-action="section" data-section="${key}"><span class="nav-glyph" aria-hidden="true">${glyph}</span><span>${label}</span>${badge}</button>`;
    }).join('')}</div>`).join('');
    return `<aside class="sidebar ${state.sidebarOpen ? 'open' : ''}" aria-label="Navega√ß√£o principal">
      <div class="brand"><span class="brand-mark">C</span><span>ChefOS<small>Control Center</small></span><button class="icon-button sidebar-close" data-action="toggle-sidebar" aria-label="Fechar menu">√ó</button></div>
      <nav>${groups}</nav>
      <div class="sidebar-footer">
        <div class="system-pill"><i></i><span><strong>Sistema operacional</strong><small>Todos os servi√ßos ativos</small></span></div>
        <div class="user-card"><span class="avatar">${initials(state.user?.email)}</span><span><strong>${escape(state.user?.email?.split('@')[0])}</strong><small>${escape(state.user?.email)}</small></span><button class="quiet" data-action="logout">Sair</button></div>
      </div>
    </aside>`;
  }

  function commandResults() {
    if (state.globalQuery.trim().length < 2) return '';
    const query = state.globalQuery.trim();
    const sectionResults = Object.entries(sectionLabels).filter(([, label]) => includes(label, query)).slice(0, 4);
    const tenantResults = state.tenants.filter((tenant) => includes(`${tenant.full_name} ${tenant.email} ${(tenant.stores || []).map((store) => store.name).join(' ')}`, query)).slice(0, 5);
    if (!sectionResults.length && !tenantResults.length) return `<div class="command-results"><p>Nenhum resultado para ‚Äú${escape(query)}‚Äù.</p></div>`;
    return `<div class="command-results">
      ${sectionResults.length ? `<small>NAVEGA√á√ÉO</small>${sectionResults.map(([key, label]) => `<button data-action="command-section" data-section="${key}"><span class="command-icon">‚Üó</span><span><strong>${label}</strong><em>Abrir se√ß√£o</em></span></button>`).join('')}` : ''}
      ${tenantResults.length ? `<small>CLIENTES</small>${tenantResults.map((tenant) => `<button data-action="open-tenant" data-id="${tenant.id}"><span class="avatar small">${initials(tenant.full_name)}</span><span><strong>${escape(tenant.full_name)}</strong><em>${escape(tenant.email)}</em></span></button>`).join('')}` : ''}
    </div>`;
  }

  function topbar() {
    return `<header class="topbar">
      <button class="icon-button menu-button" data-action="toggle-sidebar" aria-label="Abrir menu">‚ò∞</button>
      <div class="breadcrumbs"><span>ChefOS</span><b>/</b><strong>${sectionLabels[state.section]}</strong></div>
      <div class="global-search"><span>‚åï</span><input data-search="global" value="${escape(state.globalQuery)}" placeholder="Buscar cliente, loja ou se√ß√£o..." aria-label="Busca global" /><kbd>Ctrl K</kbd>${commandResults()}</div>
      <button class="top-action" data-action="open-provision"><span>Ôºã</span>Novo cliente</button>
    </header>`;
  }

  function pageHeader(eyebrow, title, description, actions = '') {
    return `<header class="page-header"><div><p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p class="muted">${description}</p></div>${actions ? `<div class="header-actions">${actions}</div>` : ''}</header>`;
  }

  function metric(label, value, detail, tone = '', glyph = '‚Üó') {
    return `<article class="metric-card ${tone}"><div><span>${label}</span><i aria-hidden="true">${glyph}</i></div><strong>${value}</strong><small>${detail}</small></article>`;
  }

  function overview() {
    const data = state.dashboard || {};
    const subscriptions = data.subscriptions || {};
    const totalSubscriptions = Object.values(subscriptions).reduce((sum, value) => sum + Number(value || 0), 0);
    const activeRate = totalSubscriptions ? Math.round(((subscriptions.active || 0) / totalSubscriptions) * 100) : 0;
    const recent = [...state.tenants].sort((a, b) => new Date(b.created_at || b.updated_at) - new Date(a.created_at || a.updated_at)).slice(0, 5);
    const attentionTickets = (state.tickets || []).filter((ticket) => ticket.status !== 'resolved').slice(0, 4);
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
    const alerts = [];
    if (data.atRiskSubscriptions) alerts.push(`<button data-action="filtered-section" data-section="subscriptions" data-filter="past_due"><i class="alert-dot danger"></i><span><strong>${data.atRiskSubscriptions} assinatura(s) inadimplente(s)</strong><small>Precisam de acompanhamento financeiro</small></span><b>Ver agora ‚Üí</b></button>`);
    if (data.urgentTickets) alerts.push(`<button data-action="section" data-section="support"><i class="alert-dot warning"></i><span><strong>${data.urgentTickets} chamado(s) priorit√°rio(s)</strong><small>Fila de atendimento requer aten√ß√£o</small></span><b>Abrir fila ‚Üí</b></button>`);
    if (!alerts.length) alerts.push(`<div class="all-clear"><i>‚úì</i><span><strong>Opera√ß√£o sob controle</strong><small>Nenhuma pend√™ncia cr√≠tica identificada agora.</small></span></div>`);

    return `<section class="page overview-page">
      ${pageHeader('PAINEL EXECUTIVO', `${greeting}, equipe ChefOS.`, 'Aqui est√° o pulso da sua opera√ß√£o neste momento.', `<button class="secondary" data-action="refresh">‚Üª Atualizar dados</button><button class="primary" data-action="open-provision">Ôºã Novo cliente</button>`)}
      <div class="metrics executive-metrics">
        ${metric('Receita recorrente', money(data.mrr), `${money(data.arr)} de ARR estimado`, 'accent', 'R$')}
        ${metric('Assinaturas ativas', shortNumber(data.activeSubscriptions), `${activeRate}% da base assinante`, 'success', '‚Üó')}
        ${metric('Clientes ChefOS', shortNumber(data.tenants), `${data.stores || 0} opera√ß√µes cadastradas`, '', '‚ó´')}
        ${metric('Chamados abertos', shortNumber(data.openTickets), `${data.inProgressTickets || 0} em atendimento`, data.urgentTickets ? 'warning' : '', '‚ú¶')}
      <Ûm5∂âûÀk∫wµÁqÕï±ïç–ÅπÖµîÙâ¡±Öπ%êàÅ…ï≈’•…ïê¯ëÌÕ—Ö—îπ¡±ÖπÃπµÖ¿†°¡±Ö∏§ÄÙ¯ÅÄÒΩ¡—•Ω∏ÅŸÖ±’îÙàëÌ¡±Ö∏π•ëÙàÄëÌM—…•πú°Õ’âÕç…•¡—•Ω∏π¡±Öπ}•ê§ÄÙÙÙÅM—…•πú°¡±Ö∏π•ê§Ä¸ÄùÕï±ïç—ïêúÄËÄúùÙ¯ëÌïÕçÖ¡î°¡±Ö∏ππÖµî•ÙÉäPÄëÌµΩπï‰°¡±Ö∏π¡…•çî•ÙΩ∑©ÃΩΩ¡—•Ω∏˘Ä§π©Ω•∏†úú•ÙΩÕï±ïç–¯Ω±Öâï∞¯Ò±Öâï∞˘AÀÕ·•µÑÅ…ïπΩŸáüçºÒ•π¡’–ÅπÖµîÙâç’……ïπ—Aï…•ΩëπêàÅ—Â¡îÙâëÖ—îàÅŸÖ±’îÙàëÌ—Ω%π¡’—Ö—î°Õ’âÕç…•¡—•Ω∏πç’……ïπ—}¡ï…•Ωë}ïπê•ÙàÄº¯Ω±Öâï∞¯Òë•ÿÅç±ÖÕÃÙâµΩëÖ∞µÕ’µµÖ…‰à¯ÒÕ¡Ö∏¯ÒÕµÖ±∞˘=AIULΩÕµÖ±∞¯ÒÕ—…Ωπú¯ëÌ—ïπÖπ–πÕ—Ω…ïÃ¸π±ïπù—†ÅÒÄ¡ÙΩÕ—…Ωπú¯ΩÕ¡Ö∏¯ÒÕ¡Ö∏¯ÒÕµÖ±∞˘Y1=HÅQU0ΩÕµÖ±∞¯ÒÕ—…Ωπú¯ëÌµΩπï‰°¡±Öπ	Â%ê°Õ’âÕç…•¡—•Ω∏π¡±Öπ}•ê§¸π¡…•çî•ÙΩÕ—…Ωπú¯ΩÕ¡Ö∏¯Ωë•ÿ¯Ωë•ÿ¯ÒôΩΩ—ï»¯Òâ’——Ω∏Å—Â¡îÙââ’——Ω∏àÅç±ÖÕÃÙâÕïçΩπëÖ…‰àÅëÖ—ÑµÖç—•Ω∏Ùâç±ΩÕîµµΩëÖ∞à˘Öπçï±Ö»Ωâ’——Ω∏¯Òâ’——Ω∏Åç±ÖÕÃÙâ¡…•µÖ…‰àÅ—Â¡îÙâÕ’âµ•–à˘MÖ±ŸÖ»ÅÖ±—ï…áü’ïÃΩâ’——Ω∏¯ΩôΩΩ—ï»¯ΩôΩ…¥¯Ωë•ÿ˘ÄÏ(ÄÅÙ((ÄÅô’πç—•Ω∏Å—ïπÖπ—5ΩëÖ∞°—ïπÖπ–§ÅÏ(ÄÄÄÅçΩπÕ–ÅÕ’âÕç…•¡—•Ω∏ÄÙÅ—ïπÖπ–πÕ’âÕç…•¡—•ΩπÃ¸πl¡tÅÒÅÌÙÏ(ÄÄÄÅçΩπÕ–Å¡±Ö∏ÄÙÅ¡±Öπ	Â%ê°Õ’âÕç…•¡—•Ω∏π¡±Öπ}•ê§Ï(ÄÄÄÅ…ï—’…∏ÅÄÒë•ÿÅç±ÖÕÃÙâµΩëÖ∞µÕ°ï±∞Åë…Ö›ï»µÕ°ï±∞àÅ…Ω±îÙâë•Ö±ΩúàÅÖ…•ÑµµΩëÖ∞Ùâ—…’îàÅÖ…•Ñµ±Öâï±±ïëâ‰Ùâë…Ö›ï»µ—•—±îà¯Òâ’——Ω∏Åç±ÖÕÃÙâµΩëÖ∞µâÖç≠ë…Ω¿àÅëÖ—ÑµÖç—•Ω∏Ùâç±ΩÕîµµΩëÖ∞àÅÖ…•Ñµ±Öâï∞Ùâïç°Ö»à¯Ωâ’——Ω∏¯ÒÖÕ•ëîÅç±ÖÕÃÙâëï—Ö•∞µë…Ö›ï»à¯Ò°ïÖëï»¯Òë•ÿÅç±ÖÕÃÙâÖŸÖ—Ö»Å±Ö…ùîà¯ëÌ•π•—•Ö±Ã°—ïπÖπ–πô’±±}πÖµî•ÙΩë•ÿ¯Òâ’——Ω∏Åç±ÖÕÃÙâ•çΩ∏µâ’——Ω∏àÅëÖ—ÑµÖç—•Ω∏Ùâç±ΩÕîµµΩëÖ∞àÅÖ…•Ñµ±Öâï∞Ùâïç°Ö»à˚\Ωâ’——Ω∏¯Ω°ïÖëï»¯Òë•ÿÅç±ÖÕÃÙâë…Ö›ï»µ—•—±îà¯Ò¿Åç±ÖÕÃÙâïÂïâ…Ω‹à˘1%9QÅ!=LΩ¿¯Ò†»Å•êÙâë…Ö›ï»µ—•—±îà¯ëÌïÕçÖ¡î°—ïπÖπ–πô’±±}πÖµî•ÙΩ†»¯Ò¿¯ëÌïÕçÖ¡î°—ïπÖπ–πïµÖ•∞•ÙΩ¿¯ëÌÕ—Ö—’Ã°Õ’âÕç…•¡—•Ω∏πÕ—Ö—’Ã•ÙΩë•ÿ¯Òë•ÿÅç±ÖÕÃÙâëï—Ö•∞µù…•êà¯ÒÕ¡Ö∏¯ÒÕµÖ±∞˘A19<ΩÕµÖ±∞¯ÒÕ—…Ωπú¯ëÌïÕçÖ¡î°¡±Ö∏¸ππÖµîÅÒÄùMï¥Å¡±Öπºú•ÙΩÕ—…Ωπú¯ΩÕ¡Ö∏¯ÒÕ¡Ö∏¯ÒÕµÖ±∞˘Y1=HÅ59M0ΩÕµÖ±∞¯ÒÕ—…Ωπú¯ëÌµΩπï‰°¡±Ö∏¸π¡…•çî•ÙΩÕ—…Ωπú¯ΩÕ¡Ö∏¯ÒÕ¡Ö∏¯ÒÕµÖ±∞˘1%9QÅMΩÕµÖ±∞¯ÒÕ—…Ωπú¯ëÌëÖ‰°—ïπÖπ–πç…ïÖ—ïë}Ö–•ÙΩÕ—…Ωπú¯ΩÕ¡Ö∏¯ÒÕ¡Ö∏¯ÒÕµÖ±∞˚i1Q%5<ÅMM<ΩÕµÖ±∞¯ÒÕ—…Ωπú¯ëÌ…ï±Ö—•Ÿî°—ïπÖπ–π±ÖÕ—}Õ•ùπ}•π}Ö–ÅÒÅ—ïπÖπ–π’¡ëÖ—ïë}Ö–•ÙΩÕ—…Ωπú¯ΩÕ¡Ö∏¯Ωë•ÿ¯ÒÕïç—•Ω∏¯Òë•ÿÅç±ÖÕÃÙâ¡Öπï∞µ°ïÖë•πúà¯Ò†Ã˘=¡ï…áü’ïÃΩ†Ã¯ÒÕ¡Ö∏Åç±ÖÕÃÙâçΩ’π–µâÖëùîà¯ëÌ—ïπÖπ–πÕ—Ω…ïÃ¸π±ïπù—†ÅÒÄ¡ÙΩÕ¡Ö∏¯Ωë•ÿ¯Òë•ÿÅç±ÖÕÃÙâÕ—Ω…îµ±•Õ–à¯ëÏ°—ïπÖπ–πÕ—Ω…ïÃÅÒÅmt§πµÖ¿†°Õ—Ω…î§ÄÙ¯ÅÄÒë•ÿ¯ÒÕ¡Ö∏˚ä^¨ΩÕ¡Ö∏¯ÒÕ¡Ö∏¯ÒÕ—…Ωπú¯ëÌïÕçÖ¡î°Õ—Ω…îππÖµî•ÙΩÕ—…Ωπú¯ÒÕµÖ±∞˘…•ÖëÑÅï¥ÄëÌëÖ‰°Õ—Ω…îπç…ïÖ—ïë}Ö–•ÙΩÕµÖ±∞¯ΩÕ¡Ö∏¯Ωë•ÿ˘Ä§π©Ω•∏†úú§ÅÒÄúÒ¿Åç±ÖÕÃÙâïµ¡—‰à˘9ïπ°’µÑÅΩ¡ï…áüçºÅŸ•πç’±ÖëÑ∏Ω¿¯ùÙΩë•ÿ¯ΩÕïç—•Ω∏¯ÒôΩΩ—ï»¯Òâ’——Ω∏Åç±ÖÕÃÙâÕïçΩπëÖ…‰àÅëÖ—ÑµÖç—•Ω∏Ùâïë•–µÕ’âÕç…•¡—•Ω∏àÅëÖ—Ñµ•êÙàëÌ—ïπÖπ–π•ëÙà˘ï…ïπç•Ö»ÅÖÕÕ•πÖ—’…ÑΩâ’——Ω∏¯Òâ’——Ω∏Åç±ÖÕÃÙâ¡…•µÖ…‰àÅëÖ—ÑµÖç—•Ω∏Ùâ—ïπÖπ–µçÖ—Ö±ΩúàÅëÖ—Ñµ•êÙàëÌ—ïπÖπ–π•ëÙà˘Yï»ÅçÖ…ìÖ¡•ºΩâ’——Ω∏¯ΩôΩΩ—ï»¯ΩÖÕ•ëî¯Ωë•ÿ˘ÄÏ(ÄÅÙ((ÄÅô’πç—•Ω∏Å¡±Öπ5ΩëÖ∞†§ÅÏ(ÄÄÄÅ…ï—’…∏ÅÄÒë•ÿÅç±ÖÕÃÙâµΩëÖ∞µÕ°ï±∞àÅ…Ω±îÙâë•Ö±ΩúàÅÖ…•ÑµµΩëÖ∞Ùâ—…’îàÅÖ…•Ñµ±Öâï±±ïëâ‰ÙâµΩëÖ∞µ—•—±îà¯Òâ’——Ω∏Åç±ÖÕÃÙâµΩëÖ∞µâÖç≠ë…Ω¿àÅëÖ—ÑµÖç—•Ω∏Ùâç±ΩÕîµµΩëÖ∞àÅÖ…•Ñµ±Öâï∞Ùâïç°Ö»à¯Ωâ’——Ω∏¯ÒôΩ…¥Åç±ÖÕÃÙâµΩëÖ∞µçÖ…êÅ±Ö…ùîµµΩëÖ∞àÅëÖ—ÑµôΩ…¥Ùâ¡±Ö∏à¯Ò°ïÖëï»¯Òë•ÿ¯Ò¿Åç±ÖÕÃÙâïÂïâ…Ω‹à˘S1=<Å=5I%0Ω¿¯Ò†»Å•êÙâµΩëÖ∞µ—•—±îà˘…•Ö»ÅπΩŸºÅ¡±ÖπºΩ†»¯Ò¿˘Ωπô•ù’…îÅ¡…óùº∞Å±•µ•—ïÃÅîÅÖçïÕÕºÅëºÅ¡±Öπº∏Ω¿¯Ωë•ÿ¯Òâ’——Ω∏Å—Â¡îÙââ’——Ω∏àÅç±ÖÕÃÙâ•çΩ∏µâ’——Ω∏àÅëÖ—ÑµÖç—•Ω∏Ùâç±ΩÕîµµΩëÖ∞àÅÖ…•Ñµ±Öâï∞Ùâïç°Ö»à˚\Ωâ’——Ω∏¯Ω°ïÖëï»¯Òë•ÿÅç±ÖÕÃÙâµΩëÖ∞µâΩë‰ÅôΩ…¥µù…•êà¯Ò±Öâï∞˘9ΩµîÅëºÅ¡±ÖπºÒ•π¡’–ÅπÖµîÙâπÖµîàÅ…ï≈’•…ïêÅ¡±Öçï°Ω±ëï»ÙâA…Ωô•ÕÕ•ΩπÖ∞àÄº¯Ω±Öâï∞¯Ò±Öâï∞˘%ëïπ—•ô•çÖëΩ»Ò•π¡’–ÅπÖµîÙâÕ±’úàÅ…ï≈’•…ïêÅ¡±Öçï°Ω±ëï»Ùâ¡…Ωô•ÕÕ•ΩπÖ∞àÄº¯Ω±Öâï∞¯Ò±Öâï∞˘A…óùºÅµïπÕÖ∞Ò•π¡’–ÅπÖµîÙâ¡…•çîàÅ—Â¡îÙâπ’µâï»àÅÕ—ï¿Ùà¿∏¿ƒàÅµ•∏Ùà¿àÅ…ï≈’•…ïêÅ¡±Öçï°Ω±ëï»Ùàƒ‰‰∞¿¿àÄº¯Ω±Öâï∞¯Ò±Öâï∞˘Q…•Ö∞Ä°ë•ÖÃ§Ò•π¡’–ÅπÖµîÙâ—…•Ö∞àÅ—Â¡îÙâπ’µâï»àÅµ•∏Ùà¿àÅŸÖ±’îÙàÃ¿àÄº¯Ω±Öâï∞¯Ò±Öâï∞˘7Ö·•µºÅëîÅ±Ω©ÖÃÒ•π¡’–ÅπÖµîÙâÕ—Ω…ïÃàÅ—Â¡îÙâπ’µâï»àÅµ•∏ÙàƒàÅŸÖ±’îÙàƒàÄº¯Ω±Öâï∞¯Ò±Öâï∞Åç±ÖÕÃÙâ›•ëîà˘Aï…µ•Õœ’ïÃÅÕï¡Ö…ÖëÖÃÅ¡Ω»Å€µ…ù’±ÑÒ•π¡’–ÅπÖµîÙâ¡ï…µ•ÕÕ•ΩπÃàÅ¡±Öçï°Ω±ëï»ÙàΩëÖÕ°âΩÖ…ê∞ÄΩ¡ΩÃ∞ÄΩ…ï¡Ω…—ÃàÄº¯Ω±Öâï∞¯Ωë•ÿ¯ÒôΩΩ—ï»¯Òâ’——Ω∏Å—Â¡îÙââ’——Ω∏àÅç±ÖÕÃÙâÕïçΩπëÖ…‰àÅëÖ—ÑµÖç—•Ω∏Ùâç±ΩÕîµµΩëÖ∞à˘Öπçï±Ö»Ωâ’——Ω∏¯Òâ’——Ω∏Åç±ÖÕÃÙâ¡…•µÖ…‰àÅ—Â¡îÙâÕ’âµ•–à˘…•Ö»Å¡±ÖπºΩâ’——Ω∏¯ΩôΩΩ—ï»¯ΩôΩ…¥¯Ωë•ÿ˘ÄÏ(ÄÅÙ((ÄÅô’πç—•Ω∏ÅµΩëÖ±Y•ï‹†§ÅÏ(ÄÄÄÅ•òÄ†ÖÕ—Ö—îπµΩëÖ∞§Å…ï—’…∏ÄúúÏ(ÄÄÄÅ•òÄ°Õ—Ö—îπµΩëÖ∞π—Â¡îÄÙÙÙÄùÕ’âÕç…•¡—•Ω∏ú§Å…ï—’…∏ÅÕ’âÕç…•¡—•Ωπ5ΩëÖ∞°Õ—Ö—îπ—ïπÖπ—Ãπô•πê†°—ïπÖπ–§ÄÙ¯ÅM—…•πú°—ïπÖπ–π•ê§ÄÙÙÙÅM—…•πú°Õ—Ö—îπµΩëÖ∞π•ê§§§Ï(ÄÄÄÅ•òÄ°Õ—Ö—îπµΩëÖ∞π—Â¡îÄÙÙÙÄù—ïπÖπ–ú§Å…ï—’…∏Å—ïπÖπ—5ΩëÖ∞°Õ—Ö—îπ—ïπÖπ—Ãπô•πê†°—ïπÖπ–§ÄÙ¯ÅM—…•πú°—ïπÖπ–π•ê§ÄÙÙÙÅM—…•πú°Õ—Ö—îπµΩëÖ∞π•ê§§§Ï(ÄÄÄÅ•òÄ°Õ—Ö—îπµΩëÖ∞π—Â¡îÄÙÙÙÄù¡±Ö∏ú§Å…ï—’…∏Å¡±Öπ5ΩëÖ∞†§Ï(ÄÄÄÅ…ï—’…∏ÄúúÏ(ÄÅÙ((ÄÅô’πç—•Ω∏ÅÕ°ï±∞†§ÅÏ(ÄÄÄÅ…ï—’…∏ÅÄÒë•ÿÅç±ÖÕÃÙâÖ¡¿µÕ°ï±∞à¯ëÌÕ•ëïâÖ»†•ÙÒë•ÿÅç±ÖÕÃÙâ›Ω…≠Õ¡Öçîà¯ëÌ—Ω¡âÖ»†•ÙÒµÖ•∏Åç±ÖÕÃÙâçΩπ—ïπ–à¯ëÌÕ—Ö—îππΩ—•çîÄ¸ÅÄÒë•ÿÅç±ÖÕÃÙâπΩ—•çîÄëÌÕ—Ö—îππΩ—•çîπ—Â¡ïÙàÅ…Ω±îÙâÕ—Ö—’Ãà¯ÒÕ¡Ö∏¯ëÌÕ—Ö—îππΩ—•çîπ—Â¡îÄÙÙÙÄùï……Ω»úÄ¸ÄúÑúÄËÄüärLùÙΩÕ¡Ö∏¯ëÌïÕçÖ¡î°Õ—Ö—îππΩ—•çîπ—ï·–•ÙÒâ’——Ω∏ÅëÖ—ÑµÖç—•Ω∏Ùâë•Õµ•ÕÃµπΩ—•çîàÅÖ…•Ñµ±Öâï∞Ùâïç°Ö»à˚\Ωâ’——Ω∏¯Ωë•ÿ˘ÄÄËÄúùÙëÌÕ—Ö—îπ±ΩÖë•πúÄ¸ÄúÒë•ÿÅç±ÖÕÃÙâ±ΩÖë•πúà¯Ò§¯Ω§˘—’Ö±•ÈÖπëºÅΩ¡ï…áüçº∏∏∏Ωë•ÿ¯úÄËÄúùÙëÌÖç—•ŸïAÖùî†•ÙΩµÖ•∏¯Ωë•ÿ¯ëÌÕ—Ö—îπÕ•ëïâÖ…=¡ï∏Ä¸ÄúÒâ’——Ω∏Åç±ÖÕÃÙâÕ•ëïâÖ»µâÖç≠ë…Ω¿àÅëÖ—ÑµÖç—•Ω∏Ùâ—Ωùù±îµÕ•ëïâÖ»àÅÖ…•Ñµ±Öâï∞Ùâïç°Ö»Åµïπ‘à¯Ωâ’——Ω∏¯úÄËÄúùÙëÌµΩëÖ±Y•ï‹†•ÙΩë•ÿ˘ÄÏ(ÄÅÙ((ÄÅô’πç—•Ω∏Å…ïπëï»°ôΩç’Õ-ï‰ÄÙÄúú§ÅÏ(ÄÄÄÅ•òÄ†ÖçΩπô•ù’…ïê†§§ÅÏÅÖ¡¿π•ππï…!Q50ÄÙÅµ•ÕÕ•πùΩπô•ùY•ï‹†§ÏÅ…ï—’…∏ÏÅÙ(ÄÄÄÅÖ¡¿π•ππï…!Q50ÄÙÅÕ—Ö—îπ’Õï»Ä¸ÅÕ°ï±∞†§ÄËÅ±Ωù•πY•ï‹†§Ï(ÄÄÄÅ•òÄ°ôΩç’Õ-ï‰§ÅÏ(ÄÄÄÄÄÅçΩπÕ–Å•π¡’–ÄÙÅëΩç’µïπ–π≈’ï…ÂMï±ïç—Ω»°ÅmëÖ—ÑµÕïÖ…ç†ÙàëÌôΩç’Õ-ïÂÙâuÄ§Ï(ÄÄÄÄÄÅ•òÄ°•π¡’–§ÅÏÅ•π¡’–πôΩç’Ã†§ÏÅ•π¡’–πÕï—Mï±ïç—•ΩπIÖπùî°•π¡’–πŸÖ±’îπ±ïπù—†∞Å•π¡’–πŸÖ±’îπ±ïπù—†§ÏÅÙ(ÄÄÄÅÙ(ÄÄÄÅëΩç’µïπ–πâΩë‰πç±ÖÕÕ1•Õ–π—Ωùù±î†ùµΩëÖ∞µΩ¡ï∏ú∞Å	ΩΩ±ïÖ∏°Õ—Ö—îπµΩëÖ∞§§Ï(ÄÅÙ((ÄÅÖÕÂπåÅô’πç—•Ω∏ÅÕÖôî°Öç—•Ω∏§ÅÏ(ÄÄÄÅ—…‰ÅÏÅÖ›Ö•–ÅÖç—•Ω∏†§ÏÅÙÅçÖ—ç†Ä°ï……Ω»§ÅÏÅÕ—Ö—îπ±ΩÖë•πúÄÙÅôÖ±ÕîÏÅÕ°Ω›9Ω—•çî°ï……Ω»πµïÕÕÖùîÅÒÄù=çΩ……ï‘Å’¥Åï……º∏ú∞Äùï……Ω»ú§ÏÅÙ(ÄÅÙ((ÄÅô’πç—•Ω∏ÅΩ¡ïπMïç—•Ω∏°Õïç—•Ω∏§ÅÏ(ÄÄÄÅÕ—Ö—îπÕïç—•Ω∏ÄÙÅÕïç—•Ω∏Ï(ÄÄÄÅÕ—Ö—îπÕ•ëïâÖ…=¡ï∏ÄÙÅôÖ±ÕîÏ(ÄÄÄÅÕ—Ö—îπù±ΩâÖ±E’ï…‰ÄÙÄúúÏ(ÄÄÄÅÕ—Ö—îπ±ΩÖë•πúÄÙÅ—…’îÏ(ÄÄÄÅ…ïπëï»†§Ï(ÄÄÄÅ…ï—’…∏Å±ΩÖëMïç—•Ω∏°Õïç—•Ω∏§πô•πÖ±±‰††§ÄÙ¯ÅÏÅÕ—Ö—îπ±ΩÖë•πúÄÙÅôÖ±ÕîÏÅ…ïπëï»†§ÏÅÙ§Ï(ÄÅÙ((ÄÅô’πç—•Ω∏ÅëΩ›π±ΩÖëÕÿ°≠•πê§ÅÏ(ÄÄÄÅçΩπÕ–ÅÕΩ’…çïQïπÖπ—ÃÄÙÅ≠•πêÄÙÙÙÄùÕ’âÕç…•¡—•ΩπÃú(ÄÄÄÄÄÄ¸ÅÕ—Ö—îπ—ïπÖπ—Ãπô•±—ï»†°—ïπÖπ–§ÄÙ¯ÅÏ(ÄÄÄÄÄÄÄÅçΩπÕ–ÅÕ’âÕç…•¡—•Ω∏ÄÙÅ—ïπÖπ–πÕ’âÕç…•¡—•ΩπÃ¸πl¡tÅÒÅÌÙÏ(ÄÄÄÄÄÄÄÅçΩπÕ–Å≈’ï…‰ÄÙÅÕ—Ö—îπô•±—ï…ÃπÕ’âÕç…•¡—•Ω∏Ï(ÄÄÄÄÄÄÄÅ…ï—’…∏Ä†Ö≈’ï…‰ÅÒÅ•πç±’ëïÃ°ÄëÌ—ïπÖπ–πô’±±}πÖµïÙÄëÌ—ïπÖπ–πïµÖ•±ÙÄëÌ—ïπÖπ–πÕ—Ω…ïÃ¸πµÖ¿†°Õ—Ω…î§ÄÙ¯ÅÕ—Ω…îππÖµî§π©Ω•∏†úÄú•ıÄ∞Å≈’ï…‰§§(ÄÄÄÄÄÄÄÄÄÄòòÄ°Õ—Ö—îπô•±—ï…ÃπÕ’âÕç…•¡—•ΩπM—Ö—’ÃÄÙÙÙÄùÖ±∞úÅÒÅÕ’âÕç…•¡—•Ω∏πÕ—Ö—’ÃÄÙÙÙÅÕ—Ö—îπô•±—ï…ÃπÕ’âÕç…•¡—•ΩπM—Ö—’Ã§Ï(ÄÄÄÄÄÅÙ§(ÄÄÄÄÄÄËÅÕ—Ö—îπ—ïπÖπ—Ãπô•±—ï»†°—ïπÖπ–§ÄÙ¯ÄÖÕ—Ö—îπô•±—ï…Ãπç’Õ—Ωµï»ÅÒÅ•πç±’ëïÃ°ÄëÌ—ïπÖπ–πô’±±}πÖµïÙÄëÌ—ïπÖπ–πïµÖ•±ÙÄëÌ—ïπÖπ–πÕ—Ω…ïÃ¸πµÖ¿†°Õ—Ω…î§ÄÙ¯ÅÕ—Ω…îππÖµî§π©Ω•∏†úÄú•ıÄ∞ÅÕ—Ö—îπô•±—ï…Ãπç’Õ—Ωµï»§§Ï(ÄÄÄÅçΩπÕ–Å…Ω›ÃÄÙÅ≠•πêÄÙÙÙÄùÕ’âÕç…•¡—•ΩπÃú(ÄÄÄÄÄÄ¸Åmlù±•ïπ—îú∞ÄùµÖ•∞ú∞Äù1Ω©Ñú∞ÄùA±Öπºú∞ÄùM—Ö—’Ãú∞ÄùYÖ±Ω»ÅµïπÕÖ∞ú∞ÄùIïπΩŸáüçºùt∞Ä∏∏πÕΩ’…çïQïπÖπ—ÃπµÖ¿†°—ïπÖπ–§ÄÙ¯ÅÏÅçΩπÕ–ÅÕ’âÕç…•¡—•Ω∏ÄÙÅ—ïπÖπ–πÕ’âÕç…•¡—•ΩπÃ¸πl¡tÅÒÅÌÙÏÅçΩπÕ–Å¡±Ö∏ÄÙÅ¡±Öπ	Â%ê°Õ’âÕç…•¡—•Ω∏π¡±Öπ}•ê§ÏÅ…ï—’…∏Åm—ïπÖπ–πô’±±}πÖµî∞Å—ïπÖπ–πïµÖ•∞∞Å—ïπÖπ–πÕ—Ω…ïÃ¸πl¡t¸ππÖµîÅÒÄúú∞Å¡±Ö∏¸ππÖµîÅÒÄúú∞ÅÕ’âÕç…•¡—•Ω∏πÕ—Ö—’ÃÅÒÄúú∞Å¡±Ö∏¸π¡…•çîÅÒÄ¿∞ÅÕ’âÕç…•¡—•Ω∏πç’……ïπ—}¡ï…•Ωë}ïπêÅÒÄúùtÏÅÙ•t(ÄÄÄÄÄÄËÅmlù±•ïπ—îú∞ÄùµÖ•∞ú∞Äù1Ω©ÖÃú∞ÄùM—Ö—’Ãú∞Äù…•ÖëºÅï¥ú∞Äüi±—•µºÅÖçïÕÕºùt∞Ä∏∏πÕΩ’…çïQïπÖπ—ÃπµÖ¿†°—ïπÖπ–§ÄÙ¯Åm—ïπÖπ–πô’±±}πÖµî∞Å—ïπÖπ–πïµÖ•∞∞Å—ïπÖπ–πÕ—Ω…ïÃ¸πµÖ¿†°Õ—Ω…î§ÄÙ¯ÅÕ—Ω…îππÖµî§π©Ω•∏†úÅÄú§ÅÒÄúú∞Å—ïπÖπ–πÕ’âÕç…•¡—•ΩπÃ¸πl¡t¸πÕ—Ö—’ÃÅÒÄúú∞Å—ïπÖπ–πç…ïÖ—ïë}Ö–ÅÒÄúú∞Å—ïπÖπ–π±ÖÕ—}Õ•ùπ}•π}Ö–ÅÒÄúùt•tÏ(ÄÄÄÅçΩπÕ–ÅçÕÿÄÙÅ…Ω›ÃπµÖ¿†°…Ω‹§ÄÙ¯Å…Ω‹πµÖ¿†°çï±∞§ÄÙ¯ÅÄàëÌM—…•πú°çï±∞Ä¸¸Äúú§π…ï¡±Öçï±∞†úàú∞Äúààú•ÙâÄ§π©Ω•∏†úÏú§§π©Ω•∏†ùq∏ú§Ï(ÄÄÄÅçΩπÕ–Åâ±ΩàÄÙÅπï‹Å	±Ωà°mÅq’ëÌçÕŸıÅt∞ÅÏÅ—Â¡îËÄù—ï·–ΩçÕÿÌç°Ö…Õï–ı’—ò¥‡úÅÙ§Ï(ÄÄÄÅçΩπÕ–Å’…∞ÄÙÅUI0πç…ïÖ—ï=â©ïç—UI0°â±Ωà§Ï(ÄÄÄÅçΩπÕ–Å±•π¨ÄÙÅëΩç’µïπ–πç…ïÖ—ï±ïµïπ–†ùÑú§Ï(ÄÄÄÅ±•π¨π°…ïòÄÙÅ’…∞Ï(ÄÄÄÅ±•π¨πëΩ›π±ΩÖêÄÙÅÅç°ïôΩÃ¥ëÌ≠•πëÙ¥ëÌπï‹ÅÖ—î†§π—Ω%M=M—…•πú†§πÕ±•çî†¿∞Äƒ¿•ÙπçÕŸÄÏ(ÄÄÄÅ±•π¨πç±•ç¨†§Ï(ÄÄÄÅUI0π…ïŸΩ≠ï=â©ïç—UI0°’…∞§Ï(ÄÄÄÅÕ°Ω›9Ω—•çî†ù…≈’•ŸºÅMXÅ¡…ï¡Ö…ÖëºÅçΩ¥ÅÕ’çïÕÕº∏ú§Ï(ÄÅÙ((ÄÅëΩç’µïπ–πÖëëŸïπ—1•Õ—ïπï»†ùÕ’âµ•–ú∞Ä°ïŸïπ–§ÄÙ¯ÅÕÖôî°ÖÕÂπåÄ†§ÄÙ¯ÅÏ(ÄÄÄÅçΩπÕ–ÅôΩ…¥ÄÙÅïŸïπ–π—Ö…ùï–πç±ΩÕïÕ–†ùôΩ…¥ú§Ï(ÄÄÄÅ•òÄ†ÖôΩ…¥§Å…ï—’…∏Ï(ÄÄÄÅïŸïπ–π¡…ïŸïπ—ïôÖ’±–†§Ï(ÄÄÄÅçΩπÕ–ÅŸÖ±’ïÃÄÙÅ=â©ïç–πô…Ωµπ—…•ïÃ°πï‹ÅΩ…µÖ—Ñ°ôΩ…¥§§Ï(ÄÄÄÅ•òÄ°ôΩ…¥πëÖ—ÖÕï–πôΩ…¥ÄÙÙÙÄù±Ωù•∏ú§ÅÏ(ÄÄÄÄÄÅÕ—Ö—îπ±ΩÖë•πúÄÙÅ—…’îÏÅ…ïπëï»†§Ï(ÄÄÄÄÄÅÖ›Ö•–ÅÕ•ùπ%∏°ŸÖ±’ïÃπïµÖ•∞∞ÅŸÖ±’ïÃπ¡ÖÕÕ›Ω…ê§Ï(ÄÄÄÄÄÅÖ›Ö•–Å±ΩÖëΩ…î†§Ï(ÄÄÄÄÄÅ…ï—’…∏Ï(ÄÄÄÅÙ(ÄÄÄÅ•òÄ°ôΩ…¥πëÖ—ÖÕï–πôΩ…¥ÄÙÙÙÄùÕ’âÕç…•¡—•Ω∏ú§ÅÏ(ÄÄÄÄÄÅçΩπÕ–Åç’……ïπ—Aï…•ΩëπêÄÙÅŸÖ±’ïÃπç’……ïπ—Aï…•ΩëπêÄ¸Åπï‹ÅÖ—î°ÄëÌŸÖ±’ïÃπç’……ïπ—Aï…•ΩëπëıP»ÃË‘‰Ë‘ÂÄ§π—Ω%M=M—…•πú†§ÄËÅ’πëïô•πïêÏ(ÄÄÄÄÄÅÖ›Ö•–ÅÖ¡§†úΩÖ¡§ΩÖëµ•∏ΩÕ’âÕç…•¡—•ΩπÃú∞ÅÏÅµï—°ΩêËÄùA=MPú∞ÅâΩë‰ËÅÏÅ’Õï…%êËÅŸÖ±’ïÃπ’Õï…%ê∞ÅÕ—Ö—’ÃËÅŸÖ±’ïÃπÕ—Ö—’Ã∞Å¡±Öπ%êËÅŸÖ±’ïÃπ¡±Öπ%ê∞Åç’……ïπ—Aï…•ΩëπêÅÙÅÙ§Ï(ÄÄÄÄÄÅÕ—Ö—îπµΩëÖ∞ÄÙÅπ’±∞Ï(ÄÄÄÄÄÅÖ›Ö•–Å±ΩÖëΩ…î†§Ï(ÄÄÄÄÄÅÕ°Ω›9Ω—•çî†ùÕÕ•πÖ—’…ÑÅÖ—’Ö±•ÈÖëÑÅçΩ¥ÅÕ’çïÕÕº∏ú§Ï(ÄÄÄÄÄÅ…ï—’…∏Ï(ÄÄÄÅÙ(ÄÄÄÅ•òÄ°ôΩ…¥πëÖ—ÖÕï–πôΩ…¥ÄÙÙÙÄù¡±Ö∏ú§ÅÏ(ÄÄÄÄÄÅÖ›Ö•–ÅÖ¡§†úΩÖ¡§ΩÖëµ•∏Ω¡±ÖπÃú∞ÅÏÅµï—°ΩêËÄùA=MPú∞ÅâΩë‰ËÅÏÅ¡±Ö∏ËÅÏÅπÖµîËÅŸÖ±’ïÃππÖµî∞ÅÕ±’úËÅŸÖ±’ïÃπÕ±’ú∞Å¡…•çîËÅ9’µâï»°ŸÖ±’ïÃπ¡…•çî§∞Å—…•Ö±}¡ï…•Ωë}ëÖÂÃËÅ9’µâï»°ŸÖ±’ïÃπ—…•Ö∞§∞ÅµÖ·}Õ—Ω…ïÃËÅ9’µâï»°ŸÖ±’ïÃπÕ—Ω…ïÃ§ÅÙ∞Å¡ï…µ•ÕÕ•ΩπÃËÅM—…•πú°ŸÖ±’ïÃπ¡ï…µ•ÕÕ•ΩπÃÅÒÄúú§πÕ¡±•–†ú∞ú§πµÖ¿†°•—ï¥§ÄÙ¯Å•—ï¥π—…•¥†§§πô•±—ï»°	ΩΩ±ïÖ∏§ÅÙÅÙ§Ï(ÄÄÄÄÄÅÕ—Ö—îπ¡±ÖπÃÄÙÄ°Ö›Ö•–ÅÖ¡§†úΩÖ¡§ΩÖëµ•∏Ω¡±ÖπÃú§§πëÖ—ÑÅÒÅmtÏ(ÄÄÄÄÄÅÕ—Ö—îπµΩëÖ∞ÄÙÅπ’±∞Ï(ÄÄÄÄÄÅÕ°Ω›9Ω—•çî†ùA±ÖπºÅç…•ÖëºÅçΩ¥ÅÕ’çïÕÕº∏ú§Ï(ÄÄÄÄÄÅ…ï—’…∏Ï(ÄÄÄÅÙ(ÄÄÄÅ•òÄ°ôΩ…¥πëÖ—ÖÕï–πôΩ…¥ÄÙÙÙÄù…ï¡±‰ú§ÅÏ(ÄÄÄÄÄÅÖ›Ö•–ÅÖ¡§†úΩÖ¡§ΩÖëµ•∏ΩµïÕÕÖùïÃú∞ÅÏÅµï—°ΩêËÄùA=MPú∞ÅâΩë‰ËÅÏÅ—•ç≠ï—}•êËÅôΩ…¥πëÖ—ÖÕï–π—•ç≠ï–∞Å—ï·–ËÅŸÖ±’ïÃπ—ï·–∞ÅÕ—Ö—’Õ}’¡ëÖ—îËÅŸÖ±’ïÃπÕ—Ö—’ÃÅÙÅÙ§Ï(ÄÄÄÄÄÅÕ—Ö—îπ—•ç≠ï—ÃÄÙÄ°Ö›Ö•–ÅÖ¡§†úΩÖ¡§ΩÖëµ•∏Ω—•ç≠ï—Ãú§§πëÖ—ÑÅÒÅmtÏ(ÄÄÄÄÄÅÕ°Ω›9Ω—•çî†ùIïÕ¡ΩÕ—ÑÅïπŸ•ÖëÑÅÖºÅç±•ïπ—î∏ú§Ï(ÄÄÄÄÄÅ…ï—’…∏Ï(ÄÄÄÅÙ(ÄÄÄÅ•òÄ°ôΩ…¥πëÖ—ÖÕï–πôΩ…¥ÄÙÙÙÄù¡…ΩŸ•Õ•Ω∏ú§ÅÏ(ÄÄÄÄÄÅÕ—Ö—îπ±ΩÖë•πúÄÙÅ—…’îÏÅ…ïπëï»†§Ï(ÄÄÄÄÄÅçΩπÕ–Å…ïÕ’±–ÄÙÅÖ›Ö•–ÅÖ¡§†úΩÖ¡§ΩÖëµ•∏Ω¡…ΩŸ•Õ•Ω∏µ—ïπÖπ–ú∞ÅÏÅµï—°ΩêËÄùA=MPú∞ÅâΩë‰ËÅŸÖ±’ïÃÅÙ§Ï(ÄÄÄÄÄÅÖ›Ö•–Å±ΩÖëΩ…î†§Ï(ÄÄÄÄÄÅÕ°Ω›9Ω—•çî°Å±•ïπ—îÅç…•Öëº∏Å°ÖŸîÅëîÅ•π—ïù…áüçºËÄëÌ…ïÕ’±–π—ïπÖπ–πÖ¡•-ïÂıÄ§Ï(ÄÄÄÄÄÅ…ï—’…∏Ï(ÄÄÄÅÙ(ÄÄÄÅ•òÄ°ôΩ…¥πëÖ—ÖÕï–πôΩ…¥ÄÙÙÙÄùÖëµ•∏ú§ÅÏ(ÄÄÄÄÄÅÖ›Ö•–ÅÖ¡§†úΩÖ¡§ΩÖëµ•∏ΩÖëµ•π•Õ—…Ö—Ω…Ãú∞ÅÏÅµï—°ΩêËÄùA=MPú∞ÅâΩë‰ËÅŸÖ±’ïÃÅÙ§Ï(ÄÄÄÄÄÅÕ—Ö—îπÖëµ•πÃÄÙÄ°Ö›Ö•–ÅÖ¡§†úΩÖ¡§ΩÖëµ•∏ΩÖëµ•π•Õ—…Ö—Ω…Ãú§§πëÖ—ÑÅÒÅmtÏ(ÄÄÄÄÄÅÕ°Ω›9Ω—•çî†ùëµ•π•Õ—…ÖëΩ»ÅÖ’—Ω…•ÈÖëº∏ú§Ï(ÄÄÄÅÙ(ÄÅÙ§§Ï((ÄÅëΩç’µïπ–πÖëëŸïπ—1•Õ—ïπï»†ùç±•ç¨ú∞Ä°ïŸïπ–§ÄÙ¯ÅÕÖôî°ÖÕÂπåÄ†§ÄÙ¯ÅÏ(ÄÄÄÅçΩπÕ–Å—Ö…ùï–ÄÙÅïŸïπ–π—Ö…ùï–πç±ΩÕïÕ–†ùmëÖ—ÑµÖç—•Ωπtú§Ï(ÄÄÄÅ•òÄ†Ö—Ö…ùï–§Å…ï—’…∏Ï(ÄÄÄÅçΩπÕ–ÅÖç—•Ω∏ÄÙÅ—Ö…ùï–πëÖ—ÖÕï–πÖç—•Ω∏Ï(ÄÄÄÅ•òÄ°Öç—•Ω∏ÄÙÙÙÄù±ΩùΩ’–ú§Å…ï—’…∏ÅÕ•ùπ=’–†§Ï(ÄÄÄÅ•òÄ°Öç—•Ω∏ÄÙÙÙÄùÕïç—•Ω∏úÅÒÅÖç—•Ω∏ÄÙÙÙÄùçΩµµÖπêµÕïç—•Ω∏ú§Å…ï—’…∏ÅΩ¡ïπMïç—•Ω∏°—Ö…ùï–πëÖ—ÖÕï–πÕïç—•Ω∏§Ï(ÄÄÄÅ•òÄ°Öç—•Ω∏ÄÙÙÙÄùô•±—ï…ïêµÕïç—•Ω∏ú§ÅÏÅÕ—Ö—îπô•±—ï…ÃπÕ’âÕç…•¡—•ΩπM—Ö—’ÃÄÙÅ—Ö…ùï–πëÖ—ÖÕï–πô•±—ï»ÏÅ…ï—’…∏ÅΩ¡ïπMïç—•Ω∏°—Ö…ùï–πëÖ—ÖÕï–πÕïç—•Ω∏§ÏÅÙ(ÄÄÄÅ•òÄ°Öç—•Ω∏ÄÙÙÙÄù—Ωùù±îµÕ•ëïâÖ»ú§ÅÏÅÕ—Ö—îπÕ•ëïâÖ…=¡ï∏ÄÙÄÖÕ—Ö—îπÕ•ëïâÖ…=¡ï∏ÏÅ…ïπëï»†§ÏÅ…ï—’…∏ÏÅÙ(ÄÄÄÅ•òÄ°Öç—•Ω∏ÄÙÙÙÄù…ïô…ïÕ†ú§Å…ï—’…∏Å±ΩÖëΩ…î†§Ï(ÄÄÄÅ•òÄ°Öç—•Ω∏ÄÙÙÙÄùë•Õµ•ÕÃµπΩ—•çîú§ÅÏÅÕ—Ö—îππΩ—•çîÄÙÅπ’±∞ÏÅ…ïπëï»†§ÏÅ…ï—’…∏ÏÅÙ(ÄÄÄÅ•òÄ°Öç—•Ω∏ÄÙÙÙÄùç±ΩÕîµµΩëÖ∞ú§ÅÏÅÕ—Ö—îπµΩëÖ∞ÄÙÅπ’±∞ÏÅ…ïπëï»†§ÏÅ…ï—’…∏ÏÅÙ(ÄÄÄÅ•òÄ°Öç—•Ω∏ÄÙÙÙÄùΩ¡ï∏µ¡±Ö∏ú§ÅÏÅÕ—Ö—îπµΩëÖ∞ÄÙÅÏÅ—Â¡îËÄù¡±Ö∏úÅÙÏÅ…ïπëï»†§ÏÅ…ï—’…∏ÏÅÙ(ÄÄÄÅ•òÄ°Öç—•Ω∏ÄÙÙÙÄùΩ¡ï∏µ¡…ΩŸ•Õ•Ω∏ú§Å…ï—’…∏ÅΩ¡ïπMïç—•Ω∏†ù¡…ΩŸ•Õ•Ω∏ú§Ï(ÄÄÄÅ•òÄ°Öç—•Ω∏ÄÙÙÙÄùΩ¡ï∏µ—ïπÖπ–ú§ÅÏÅÕ—Ö—îπù±ΩâÖ±E’ï…‰ÄÙÄúúÏÅÕ—Ö—îπµΩëÖ∞ÄÙÅÏÅ—Â¡îËÄù—ïπÖπ–ú∞Å•êËÅ—Ö…ùï–πëÖ—ÖÕï–π•êÅÙÏÅ…ïπëï»†§ÏÅ…ï—’…∏ÏÅÙ(ÄÄÄÅ•òÄ°Öç—•Ω∏ÄÙÙÙÄùïë•–µÕ’âÕç…•¡—•Ω∏ú§ÅÏÅÕ—Ö—îπµΩëÖ∞ÄÙÅÏÅ—Â¡îËÄùÕ’âÕç…•¡—•Ω∏ú∞Å•êËÅ—Ö…ùï–πëÖ—ÖÕï–π•êÅÙÏÅ…ïπëï»†§ÏÅ…ï—’…∏ÏÅÙ(ÄÄÄÅ•òÄ°Öç—•Ω∏ÄÙÙÙÄù—ïπÖπ–µçÖ—Ö±Ωúú§ÅÏÅÕ—Ö—îπµΩëÖ∞ÄÙÅπ’±∞ÏÅÕ—Ö—îπÕï±ïç—ïëQïπÖπ–ÄÙÅ—Ö…ùï–πëÖ—ÖÕï–π•êÏÅ…ï—’…∏ÅΩ¡ïπMïç—•Ω∏†ùçÖ—Ö±Ωúú§ÏÅÙ(ÄÄÄÅ•òÄ°Öç—•Ω∏ÄÙÙÙÄùï·¡Ω…–ú§ÅÏÅëΩ›π±ΩÖëÕÿ°—Ö…ùï–πëÖ—ÖÕï–π≠•πê§ÏÅ…ï—’…∏ÏÅÙ(ÄÄÄÅ•òÄ°Öç—•Ω∏ÄÙÙÙÄù—•ç≠ï–µô•±—ï»ú§ÅÏÅÕ—Ö—îπô•±—ï…Ãπ—•ç≠ï—M—Ö—’ÃÄÙÅ—Ö…ùï–πëÖ—ÖÕï–πŸÖ±’îÏÅ…ïπëï»†§ÏÅ…ï—’…∏ÏÅÙ(ÄÄÄÅ•òÄ°Öç—•Ω∏ÄÙÙÙÄùÕï±ïç–µ—•ç≠ï–ú§ÅÏÅÕ—Ö—îπÕï±ïç—ïëQ•ç≠ï—%êÄÙÅ—Ö…ùï–πëÖ—ÖÕï–π•êÏÅ…ïπëï»†§ÏÅ…ï—’…∏ÏÅÙ(ÄÄÄÅ•òÄ°Öç—•Ω∏ÄÙÙÙÄùΩ¡ï∏µ—•ç≠ï–ú§ÅÏÅÕ—Ö—îπÕï±ïç—ïëQ•ç≠ï—%êÄÙÅ—Ö…ùï–πëÖ—ÖÕï–π•êÏÅ…ï—’…∏ÅΩ¡ïπMïç—•Ω∏†ùÕ’¡¡Ω…–ú§ÏÅÙ(ÄÄÄÅ•òÄ°Öç—•Ω∏ÄÙÙÙÄù…ï±ΩÖêµ—•ç≠ï—Ãú§ÅÏÅÕ—Ö—îπ±ΩÖë•πúÄÙÅ—…’îÏÅ…ïπëï»†§ÏÅÖ›Ö•–Å±ΩÖëMïç—•Ω∏†ùÕ’¡¡Ω…–ú∞Å—…’î§ÏÅÕ—Ö—îπ±ΩÖë•πúÄÙÅôÖ±ÕîÏÅ…ïπëï»†§ÏÅ…ï—’…∏ÏÅÙ(ÄÄÄÅ•òÄ°Öç—•Ω∏ÄÙÙÙÄù…ïÕΩ±Ÿîµ—•ç≠ï–ú§ÅÏ(ÄÄÄÄÄÅÖ›Ö•–ÅÖ¡§†úΩÖ¡§ΩÖëµ•∏Ω—•ç≠ï—Ãú∞ÅÏÅµï—°ΩêËÄùAUPú∞ÅâΩë‰ËÅÏÅ•êËÅ—Ö…ùï–πëÖ—ÖÕï–π•ê∞Å’¡ëÖ—ïÃËÅÏÅÕ—Ö—’ÃËÄù…ïÕΩ±ŸïêúÅÙÅÙÅÙ§Ï(ÄÄÄÄÄÅÕ—Ö—îπ—•ç≠ï—ÃÄÙÄ°Ö›Ö•–ÅÖ¡§†úΩÖ¡§ΩÖëµ•∏Ω—•ç≠ï—Ãú§§πëÖ—ÑÅÒÅmtÏ(ÄÄÄÄÄÅÕ°Ω›9Ω—•çî†ù°ÖµÖëºÅµÖ…çÖëºÅçΩµºÅ…ïÕΩ±Ÿ•ëº∏ú§Ï(ÄÄÄÄÄÅ…ï—’…∏Ï(ÄÄÄÅÙ(ÄÄÄÅ•òÄ°Öç—•Ω∏ÄÙÙÙÄù…ï±ΩÖêµ°ïÖ±—†ú§ÅÏÅÕ—Ö—îπ°ïÖ±—†ÄÙÅπ’±∞ÏÅÕ—Ö—îπ±ΩÖë•πúÄÙÅ—…’îÏÅ…ïπëï»†§ÏÅÖ›Ö•–Å±ΩÖëMïç—•Ω∏†ù°ïÖ±—†ú∞Å—…’î§ÏÅÕ—Ö—îπ±ΩÖë•πúÄÙÅôÖ±ÕîÏÅ…ïπëï»†§ÏÅ…ï—’…∏ÏÅÙ(ÄÄÄÅ•òÄ°Öç—•Ω∏ÄÙÙÙÄù…ï±ΩÖêµ±ΩùÃú§ÅÏÅÕ—Ö—îπ±ΩùÃÄÙÅπ’±∞ÏÅÕ—Ö—îπ±ΩÖë•πúÄÙÅ—…’îÏÅ…ïπëï»†§ÏÅÖ›Ö•–Å±ΩÖëMïç—•Ω∏†ù±ΩùÃú∞Å—…’î§ÏÅÕ—Ö—îπ±ΩÖë•πúÄÙÅôÖ±ÕîÏÅ…ïπëï»†§ÏÅ…ï—’…∏ÏÅÙ(ÄÄÄÅ•òÄ°Öç—•Ω∏ÄÙÙÙÄù—Ωùù±îµµïπ‘ú§ÅÏ(ÄÄÄÄÄÅÖ›Ö•–ÅÖ¡§†úΩÖ¡§ΩÖëµ•∏Ω—ïπÖπ–µµïπ‘ú∞ÅÏÅµï—°ΩêËÄùAUPú∞ÅâΩë‰ËÅÏÅ•êËÅ—Ö…ùï–πëÖ—ÖÕï–π•ê∞Å’¡ëÖ—ïÃËÅÏÅ•Õ}ÖŸÖ•±Öâ±îËÅ—Ö…ùï–πëÖ—ÖÕï–πÖŸÖ•±Öâ±îÄÑÙÙÄù—…’îúÅÙÅÙÅÙ§Ï(ÄÄÄÄÄÅÖ›Ö•–Å±ΩÖëMïç—•Ω∏†ùçÖ—Ö±Ωúú§ÏÅ…ïπëï»†§ÏÅÕ°Ω›9Ω—•çî†ù•Õ¡Ωπ•â•±•ëÖëîÅÖ—’Ö±•ÈÖëÑ∏ú§ÏÅ…ï—’…∏Ï(ÄÄÄÅÙ(ÄÄÄÅ•òÄ°Öç—•Ω∏ÄÙÙÙÄùëï±ï—îµ¡±Ö∏ú§ÅÏ(ÄÄÄÄÄÅ•òÄ†ÖçΩπô•…¥†ù·ç±’•»ÅïÕ—îÅ¡±Öπº¸ÅÕÕ•πÖ—’…ÖÃÅŸ•πç’±ÖëÖÃÅ¡Ωëï¥Å•µ¡ïë•»ÅÑÅï·ç±’œçº∏ú§§Å…ï—’…∏Ï(ÄÄÄÄÄÅÖ›Ö•–ÅÖ¡§†úΩÖ¡§ΩÖëµ•∏Ω¡±ÖπÃú∞ÅÏÅµï—°ΩêËÄù1Qú∞ÅâΩë‰ËÅÏÅ•êËÅ—Ö…ùï–πëÖ—ÖÕï–π•êÅÙÅÙ§Ï(ÄÄÄÄÄÅÕ—Ö—îπ¡±ÖπÃÄÙÄ°Ö›Ö•–ÅÖ¡§†úΩÖ¡§ΩÖëµ•∏Ω¡±ÖπÃú§§πëÖ—ÑÅÒÅmtÏÅÕ°Ω›9Ω—•çî†ùA±ÖπºÅï·ç±◊µëº∏ú§ÏÅ…ï—’…∏Ï(ÄÄÄÅÙ(ÄÄÄÅ•òÄ°Öç—•Ω∏ÄÙÙÙÄùëï±ï—îµÖëµ•∏ú§ÅÏ(ÄÄÄÄÄÅ•òÄ†ÖçΩπô•…¥°ÅIïµΩŸï»ÄëÌ—Ö…ùï–πëÖ—ÖÕï–πïµÖ•±ÙÅëºÅΩπ—…Ω∞Åïπ—ï»˝Ä§§Å…ï—’…∏Ï(ÄÄÄÄÄÅÖ›Ö•–ÅÖ¡§†úΩÖ¡§ΩÖëµ•∏ΩÖëµ•π•Õ—…Ö—Ω…Ãú∞ÅÏÅµï—°ΩêËÄù1Qú∞ÅâΩë‰ËÅÏÅïµÖ•∞ËÅ—Ö…ùï–πëÖ—ÖÕï–πïµÖ•∞ÅÙÅÙ§Ï(ÄÄÄÄÄÅÕ—Ö—îπÖëµ•πÃÄÙÄ°Ö›Ö•–ÅÖ¡§†úΩÖ¡§ΩÖëµ•∏ΩÖëµ•π•Õ—…Ö—Ω…Ãú§§πëÖ—ÑÅÒÅmtÏÅÕ°Ω›9Ω—•çî†ùçïÕÕºÅ…ïµΩŸ•ëº∏ú§Ï(ÄÄÄÅÙ(ÄÅÙ§§Ï((ÄÅëΩç’µïπ–πÖëëŸïπ—1•Õ—ïπï»†ù•π¡’–ú∞Ä°ïŸïπ–§ÄÙ¯ÅÏ(ÄÄÄÅçΩπÕ–Å•π¡’–ÄÙÅïŸïπ–π—Ö…ùï–πç±ΩÕïÕ–†ùmëÖ—ÑµÕïÖ…ç°tú§Ï(ÄÄÄÅ•òÄ†Ö•π¡’–§Å…ï—’…∏Ï(ÄÄÄÅçΩπÕ–Å≠ï‰ÄÙÅ•π¡’–πëÖ—ÖÕï–πÕïÖ…ç†Ï(ÄÄÄÅ•òÄ°≠ï‰ÄÙÙÙÄùù±ΩâÖ∞ú§ÅÕ—Ö—îπù±ΩâÖ±E’ï…‰ÄÙÅ•π¡’–πŸÖ±’îÏ(ÄÄÄÅï±ÕîÅÕ—Ö—îπô•±—ï…Õm≠ïÂtÄÙÅ•π¡’–πŸÖ±’îÏ(ÄÄÄÅ…ïπëï»°≠ï‰§Ï(ÄÅÙ§Ï((ÄÅëΩç’µïπ–πÖëëŸïπ—1•Õ—ïπï»†ùç°Öπùîú∞Ä°ïŸïπ–§ÄÙ¯ÅÕÖôî°ÖÕÂπåÄ†§ÄÙ¯ÅÏ(ÄÄÄÅçΩπÕ–Åô•±—ï»ÄÙÅïŸïπ–π—Ö…ùï–πç±ΩÕïÕ–†ùmëÖ—Ñµô•±—ï…tú§Ï(ÄÄÄÅ•òÄ°ô•±—ï»§ÅÏÅÕ—Ö—îπô•±—ï…Õmô•±—ï»πëÖ—ÖÕï–πô•±—ï…tÄÙÅô•±—ï»πŸÖ±’îÏÅ…ïπëï»†§ÏÅ…ï—’…∏ÏÅÙ(ÄÄÄÅçΩπÕ–ÅÕï±ïç–ÄÙÅïŸïπ–π—Ö…ùï–πç±ΩÕïÕ–†ùmëÖ—ÑµÖç—•Ω∏ÙâÕï±ïç–µ—ïπÖπ–âtú§Ï(ÄÄÄÅ•òÄ†ÖÕï±ïç–§Å…ï—’…∏Ï(ÄÄÄÅÕ—Ö—îπÕï±ïç—ïëQïπÖπ–ÄÙÅÕï±ïç–πŸÖ±’îÏ(ÄÄÄÅÕ—Ö—îπ±ΩÖë•πúÄÙÅ—…’îÏÅ…ïπëï»†§Ï(ÄÄÄÅÖ›Ö•–Å±ΩÖëMïç—•Ω∏†ùçÖ—Ö±Ωúú§Ï(ÄÄÄÅÕ—Ö—îπ±ΩÖë•πúÄÙÅôÖ±ÕîÏÅ…ïπëï»†§Ï(ÄÅÙ§§Ï((ÄÅëΩç’µïπ–πÖëëŸïπ—1•Õ—ïπï»†ù≠ïÂëΩ›∏ú∞Ä°ïŸïπ–§ÄÙ¯ÅÏ(ÄÄÄÅ•òÄ†°ïŸïπ–πç—…±-ï‰ÅÒÅïŸïπ–πµï—Ö-ï‰§ÄòòÅïŸïπ–π≠ï‰π—Ω1Ω›ï…ÖÕî†§ÄÙÙÙÄù¨ú§ÅÏ(ÄÄÄÄÄÅïŸïπ–π¡…ïŸïπ—ïôÖ’±–†§Ï(ÄÄÄÄÄÅëΩç’µïπ–π≈’ï…ÂMï±ïç—Ω»†ùmëÖ—ÑµÕïÖ…ç†Ùâù±ΩâÖ∞âtú§¸πôΩç’Ã†§Ï(ÄÄÄÅÙ(ÄÄÄÅ•òÄ°ïŸïπ–π≠ï‰ÄÙÙÙÄùÕçÖ¡îú§ÅÏ(ÄÄÄÄÄÅÕ—Ö—îπµΩëÖ∞ÄÙÅπ’±∞Ï(ÄÄÄÄÄÅÕ—Ö—îπÕ•ëïâÖ…=¡ï∏ÄÙÅôÖ±ÕîÏ(ÄÄÄÄÄÅÕ—Ö—îπù±ΩâÖ±E’ï…‰ÄÙÄúúÏ(ÄÄÄÄÄÅ…ïπëï»†§Ï(ÄÄÄÅÙ(ÄÅÙ§Ï((ÄÅÖÕÂπåÅô’πç—•Ω∏ÅâΩΩ–†§ÅÏ(ÄÄÄÅ…ïπëï»†§Ï(ÄÄÄÅ•òÄ†ÖçΩπô•ù’…ïê†§ÅÒÄÖÕ—Ö—îπ—Ω≠ï∏§Å…ï—’…∏Ï(ÄÄÄÅ—…‰ÅÏ(ÄÄÄÄÄÅÕ—Ö—îπ’Õï»ÄÙÄ°Ö›Ö•–ÅÖ¡§†úΩÖ¡§ΩÖëµ•∏ΩÕïÕÕ•Ω∏ú§§πëÖ—ÑÏ(ÄÄÄÄÄÅÖ›Ö•–Å±ΩÖëΩ…î†§Ï(ÄÄÄÅÙÅçÖ—ç†ÅÏ(ÄÄÄÄÄÅÖ›Ö•–ÅÕ•ùπ=’–†§Ï(ÄÄÄÄÄÅÕ°Ω›9Ω—•çî†ùM’ÑÅÕïÕœçºÅï·¡•…Ω‘∏Åπ—…îÅπΩŸÖµïπ—î∏ú∞Äùï……Ω»ú§Ï(ÄÄÄÅÙ(ÄÅÙ((ÄÅâΩΩ–†§Ï)Ù§†§Ï(