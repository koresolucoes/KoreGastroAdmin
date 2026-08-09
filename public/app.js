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
    admins: null,
    health: null,
    logs: null,
    notice: null
  };

  const sections = [
    ['overview', 'Visão geral'], ['tenants', 'Clientes e lojas'], ['plans', 'Planos'],
    ['support', 'Atendimento'], ['catalog', 'Cardápios'], ['provision', 'Provisionamento'],
    ['health', 'Saúde'], ['logs', 'Logs'], ['administrators', 'Administradores']
  ];

  const escape = (value = '') => String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
  const date = (value) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
  const apiUrl = (path) => `${String(config.apiBaseUrl || '').replace(/\/$/, '')}${path}`;
  const configured = () => Boolean(config.supabaseUrl && config.supabaseAnonKey);

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
    const session = await api('/api/admin/session');
    state.user = session.data;
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
    state.loading = true; render();
    try {
      const [dashboard, tenants, plans] = await Promise.all([
        api('/api/admin/dashboard'), api('/api/admin/restaurants'), api('/api/admin/plans')
      ]);
      state.dashboard = dashboard.data;
      state.tenants = tenants.data || [];
      state.plans = plans.data || [];
      if (!state.selectedTenant && state.tenants[0]) state.selectedTenant = state.tenants[0].id;
    } finally {
      state.loading = false; render();
    }
  }

  async function loadSection(section = state.section) {
    if (section === 'support' && !state.tickets) state.tickets = (await api('/api/admin/tickets')).data || [];
    if (section === 'catalog' && state.selectedTenant) state.menu = (await api(`/api/admin/tenant-menu?tenantId=${encodeURIComponent(state.selectedTenant)}`)).data || [];
    if (section === 'administrators' && !state.admins) state.admins = (await api('/api/admin/administrators')).data || [];
    if (section === 'health' && !state.health) state.health = await api('/api/admin/health');
    if (section === 'logs' && !state.logs) state.logs = (await api('/api/admin/logs')).data || [];
  }

  function loginView() {
    return `<section class="login-shell">
      <form class="login-card" data-form="login">
        <p class="eyebrow">KOREGASTRO</p>
        <h1>Administração central</h1>
        <p class="muted">Entre com uma conta cadastrada em <code>system_admins</code>.</p>
        <label>E-mail<input type="email" name="email" autocomplete="email" required /></label>
        <label>Senha<input type="password" name="password" autocomplete="current-password" required /></label>
        <button class="primary" type="submit">Entrar com segurança</button>
      </form>
    </section>`;
  }

  function missingConfigView() {
    return `<section class="login-shell"><div class="login-card"><p class="eyebrow">CONFIGURAÇÃO PENDENTE</p><h1>Painel pronto para conectar</h1><p class="muted">Configure <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> antes do deploy. As chaves administrativas ficam apenas no servidor.</p></div></section>`;
  }

  function nav() {
    return `<aside class="sidebar"><div class="brand"><span class="brand-mark">K</span><span>KoreGastro<small>Admin</small></span></div>
      <nav>${sections.map(([key, label]) => `<button class="nav-item ${state.section === key ? 'active' : ''}" data-action="section" data-section="${key}">${label}</button>`).join('')}</nav>
      <div class="sidebar-footer"><span>${escape(state.user?.email)}</span><button class="quiet" data-action="logout">Sair</button></div>
    </aside>`;
  }

  function status(value) {
    const labels = { active: 'Ativa', trialing: 'Trial', past_due: 'Vencida', canceled: 'Cancelada', open: 'Aberto', in_progress: 'Em atendimento', resolved: 'Resolvido' };
    return `<span class="status status-${escape(value || 'unknown')}">${labels[value] || escape(value || 'Sem status')}</span>`;
  }

  function overview() {
    const data = state.dashboard || {};
    return `<section class="page"><header class="page-header"><div><p class="eyebrow">CENTRAL SAAS</p><h1>Visão geral</h1><p class="muted">Indicadores consolidados do KoreGastro.</p></div><button class="secondary" data-action="refresh">Atualizar</button></header>
      <div class="metrics">
        <article><span>Clientes</span><strong>${data.tenants ?? '—'}</strong><small>tenants cadastrados</small></article>
        <article><span>Assinaturas ativas</span><strong>${data.activeSubscriptions ?? '—'}</strong><small>${data.subscriptions?.trialing || 0} em trial</small></article>
        <article><span>MRR estimado</span><strong>${money(data.mrr)}</strong><small>ARR: ${money((data.mrr || 0) * 12)}</small></article>
        <article><span>Chamados abertos</span><strong>${data.openTickets ?? '—'}</strong><small>suporte pendente</small></article>
      </div>
      <div class="panel split"><div><h2>Distribuição de assinaturas</h2>${Object.entries(data.subscriptions || {}).map(([key, value]) => `<div class="stat-line"><span>${status(key)}</span><strong>${value}</strong></div>`).join('') || '<p class="empty">Nenhuma assinatura encontrada.</p>'}</div>
      <div><h2>Ações rápidas</h2><div class="quick-actions"><button data-action="section" data-section="provision">Provisionar cliente</button><button data-action="section" data-section="support">Atender chamados</button><button data-action="section" data-section="plans">Gerenciar planos</button></div></div></div>
    </section>`;
  }

  function tenants() {
    return `<section class="page"><header class="page-header"><div><p class="eyebrow">TENANTS</p><h1>Clientes e lojas</h1><p class="muted">Assinaturas e unidades vinculadas à mesma base Supabase.</p></div><button class="secondary" data-action="refresh">Atualizar</button></header>
      <div class="panel table-wrap"><table><thead><tr><th>Cliente</th><th>Lojas</th><th>Assinatura</th><th>Vencimento</th><th></th></tr></thead><tbody>
      ${(state.tenants || []).map((tenant) => { const subscription = tenant.subscriptions?.[0] || {}; return `<tr><td><strong>${escape(tenant.full_name)}</strong><small>${escape(tenant.email)}</small></td><td>${tenant.stores?.length ? tenant.stores.map((store) => escape(store.name)).join(', ') : '—'}</td><td>${status(subscription.status)}</td><td>${date(subscription.current_period_end)}</td><td><button class="link-button" data-action="edit-subscription" data-id="${tenant.id}">Editar acesso</button></td></tr>`; }).join('') || '<tr><td colspan="5" class="empty">Nenhum cliente encontrado.</td></tr>'}
      </tbody></table></div></section>`;
  }

  function plans() {
    return `<section class="page"><header class="page-header"><div><p class="eyebrow">CATÁLOGO COMERCIAL</p><h1>Planos e permissões</h1><p class="muted">Crie planos e vincule permissões por rota.</p></div></header>
      <div class="panel"><h2>Novo plano</h2><form class="form-grid" data-form="plan"><label>Nome<input name="name" required placeholder="Profissional" /></label><label>Identificador<input name="slug" required placeholder="profissional" /></label><label>Preço mensal<input name="price" type="number" step="0.01" min="0" required /></label><label>Trial (dias)<input name="trial" type="number" min="0" value="30" /></label><label>Máximo de lojas<input name="stores" type="number" min="1" value="1" /></label><label class="wide">Permissões (separadas por vírgula)<input name="permissions" placeholder="/dashboard, /pos, /reports" /></label><button class="primary" type="submit">Criar plano</button></form></div>
      <div class="card-grid">${state.plans.map((plan) => `<article class="plan-card"><div><h2>${escape(plan.name)}</h2><p>${money(plan.price)} / mês</p></div><div><small>Trial: ${plan.trial_period_days || 0} dias · até ${plan.max_stores || 1} loja(s)</small><p class="muted">${(plan.plan_permissions || []).map((permission) => escape(permission.permission_key)).join(', ') || 'Sem permissões vinculadas'}</p></div><button class="danger-link" data-action="delete-plan" data-id="${plan.id}">Excluir plano</button></article>`).join('') || '<p class="empty">Nenhum plano encontrado.</p>'}</div>
    </section>`;
  }

  function support() {
    const tickets = state.tickets || [];
    return `<section class="page"><header class="page-header"><div><p class="eyebrow">SUPORTE</p><h1>Central de atendimento</h1><p class="muted">Responda e atualize chamados de clientes.</p></div><button class="secondary" data-action="reload-tickets">Atualizar</button></header>
      <div class="ticket-list">${tickets.map((ticket) => `<article class="ticket-card"><div class="ticket-head"><div><h2>${escape(ticket.subject || 'Sem assunto')}</h2><p>${escape(ticket.client_name)} · ${escape(ticket.store_name || 'Geral')}</p></div>${status(ticket.status)}</div><div class="messages">${(ticket.messages || []).map((message) => `<p class="message ${message.sender_type === 'admin' ? 'mine' : ''}"><strong>${message.sender_type === 'admin' ? 'Admin' : 'Cliente'}</strong>${escape(message.text)}<small>${date(message.created_at)}</small></p>`).join('') || '<p class="empty">Ainda não há mensagens.</p>'}</div><form data-form="reply" data-ticket="${ticket.id}" class="reply-row"><input name="text" required placeholder="Escreva uma resposta" /><select name="status"><option value="in_progress">Em atendimento</option><option value="resolved">Resolvido</option><option value="open">Aberto</option></select><button class="primary" type="submit">Enviar</button></form></article>`).join('') || '<div class="panel empty">Nenhum chamado encontrado.</div>'}</div></section>`;
  }

  function catalog() {
    const options = state.tenants.map((tenant) => `<option value="${tenant.id}" ${tenant.id === state.selectedTenant ? 'selected' : ''}>${escape(tenant.full_name)} — ${escape(tenant.email)}</option>`).join('');
    return `<section class="page"><header class="page-header"><div><p class="eyebrow">CATÁLOGO</p><h1>Inspector de cardápios</h1><p class="muted">Disponibilize ou pause itens de um tenant.</p></div><select data-action="select-tenant">${options}</select></header>
      <div class="panel table-wrap"><table><thead><tr><th>Produto</th><th>Categoria</th><th>Preço</th><th>Disponibilidade</th><th></th></tr></thead><tbody>${state.menu.map((item) => `<tr><td><strong>${escape(item.name)}</strong></td><td>${escape(item.categories?.name || 'Geral')}</td><td>${money(item.price)}</td><td>${item.is_available ? 'Disponível' : 'Pausado'}</td><td><button class="link-button" data-action="toggle-menu" data-id="${item.id}" data-available="${item.is_available}">${item.is_available ? 'Pausar' : 'Disponibilizar'}</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Selecione um cliente para ver os itens.</td></tr>'}</tbody></table></div></section>`;
  }

  function provision() {
    return `<section class="page"><header class="page-header"><div><p class="eyebrow">ONBOARDING</p><h1>Provisionar tenant</h1><p class="muted">Cria loja, perfil, assinatura de trial, salão e mesas iniciais.</p></div></header><div class="panel"><form class="form-grid" data-form="provision"><label>ID do usuário<input name="userId" required placeholder="UUID do usuário no Supabase Auth" /></label><label>Nome da loja<input name="storeName" required /></label><label>CNPJ<input name="cnpj" /></label><label>Telefone<input name="phone" /></label><label class="wide">Endereço<input name="address" /></label><label>Plano<select name="planId"><option value="">Menor preço cadastrado</option>${state.plans.map((plan) => `<option value="${plan.id}">${escape(plan.name)} — ${money(plan.price)}</option>`).join('')}</select></label><button class="primary" type="submit">Provisionar com trial de 30 dias</button></form></div></section>`;
  }

  function health() {
    const data = state.health || {};
    return `<section class="page"><header class="page-header"><div><p class="eyebrow">OBSERVABILIDADE</p><h1>Saúde do sistema</h1><p class="muted">Verificação da conexão principal do painel.</p></div><button class="secondary" data-action="reload-health">Atualizar</button></header><div class="panel"><div class="health-summary"><strong class="${data.status === 'healthy' ? 'healthy' : 'degraded'}">${escape(data.status || 'Carregando')}</strong><span>${data.latencyMs ?? '—'} ms</span></div>${Object.entries(data.checks || {}).map(([name, check]) => `<div class="check"><strong>${escape(name)}</strong><span>${escape(check.status)}${check.latencyMs ? ` · ${check.latencyMs} ms` : ''}</span><small>${escape(check.message || '')}</small></div>`).join('')}</div></section>`;
  }

  function logs() {
    return `<section class="page"><header class="page-header"><div><p class="eyebrow">AUDITORIA</p><h1>Logs do sistema</h1><p class="muted">Últimos 150 eventos registrados.</p></div><button class="secondary" data-action="reload-logs">Atualizar</button></header><div class="panel table-wrap"><table><thead><tr><th>Data</th><th>Evento</th><th>Descrição</th></tr></thead><tbody>${(state.logs || []).map((log) => `<tr><td>${date(log.created_at)}</td><td>${escape(log.action || log.event_type || 'Evento')}</td><td>${escape(log.description || log.details || '—')}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Nenhum log encontrado.</td></tr>'}</tbody></table></div></section>`;
  }

  function administrators() {
    return `<section class="page"><header class="page-header"><div><p class="eyebrow">ACESSO</p><h1>Administradores</h1><p class="muted">Somente e-mails em <code>system_admins</code> conseguem entrar.</p></div></header><div class="panel"><form class="inline-form" data-form="admin"><input name="email" type="email" required placeholder="novo.admin@empresa.com" /><button class="primary" type="submit">Adicionar administrador</button></form><div class="admin-list">${(state.admins || []).map((admin) => `<div><span><strong>${escape(admin.email)}</strong><small>${date(admin.created_at)}${admin.protected ? ' · administrador raiz' : ''}</small></span>${admin.protected ? '' : `<button class="danger-link" data-action="delete-admin" data-email="${escape(admin.email)}">Remover</button>`}</div>`).join('') || '<p class="empty">Nenhum administrador encontrado.</p>'}</div></section>`;
  }

  function activePage() {
    const pages = { overview, tenants, plans, support, catalog, provision, health, logs, administrators };
    return pages[state.section]();
  }

  function shell() {
    return `<div class="app-shell">${nav()}<main class="content">${state.notice ? `<div class="notice ${state.notice.type}">${escape(state.notice.text)}</div>` : ''}${state.loading ? '<div class="loading">Atualizando dados…</div>' : ''}${activePage()}</main></div>`;
  }

  function render() {
    if (!configured()) { app.innerHTML = missingConfigView(); return; }
    app.innerHTML = state.user ? shell() : loginView();
  }

  async function safe(action) {
    try { await action(); } catch (error) { showNotice(error.message || 'Ocorreu um erro.', 'error'); }
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
    if (form.dataset.form === 'plan') {
      await api('/api/admin/plans', { method: 'POST', body: { plan: { name: values.name, slug: values.slug, price: Number(values.price), trial_period_days: Number(values.trial), max_stores: Number(values.stores) }, permissions: String(values.permissions || '').split(',').map((item) => item.trim()).filter(Boolean) } });
      state.plans = (await api('/api/admin/plans')).data || []; showNotice('Plano criado.'); return;
    }
    if (form.dataset.form === 'reply') {
      await api('/api/admin/messages', { method: 'POST', body: { ticket_id: form.dataset.ticket, text: values.text, status_update: values.status } });
      state.tickets = (await api('/api/admin/tickets')).data || []; showNotice('Resposta enviada.'); return;
    }
    if (form.dataset.form === 'provision') {
      const result = await api('/api/admin/provision-tenant', { method: 'POST', body: values });
      await loadCore();
      showNotice(`Tenant provisionado. Chave externa gerada: ${result.tenant.apiKey}`, 'success'); return;
    }
    if (form.dataset.form === 'admin') {
      await api('/api/admin/administrators', { method: 'POST', body: values });
      state.admins = (await api('/api/admin/administrators')).data || []; showNotice('Administrador adicionado.');
    }
  }));

  document.addEventListener('click', (event) => safe(async () => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'logout') return signOut();
    if (action === 'section') { state.section = target.dataset.section; await loadSection(); render(); return; }
    if (action === 'refresh') { await loadCore(); await loadSection(); return; }
    if (action === 'reload-tickets') { state.tickets = null; await loadSection('support'); render(); return; }
    if (action === 'reload-health') { state.health = null; await loadSection('health'); render(); return; }
    if (action === 'reload-logs') { state.logs = null; await loadSection('logs'); render(); return; }
    if (action === 'toggle-menu') {
      await api('/api/admin/tenant-menu', { method: 'PUT', body: { id: target.dataset.id, updates: { is_available: target.dataset.available !== 'true' } } });
      await loadSection('catalog'); render(); return;
    }
    if (action === 'edit-subscription') {
      const tenant = state.tenants.find((item) => item.id === target.dataset.id); const current = tenant?.subscriptions?.[0] || {};
      const nextStatus = prompt('Status: active, trialing, past_due ou canceled', current.status || 'active');
      if (!nextStatus) return;
      const planChoices = state.plans.map((plan) => `${plan.id} (${plan.name})`).join('\n');
      const nextPlan = prompt(`ID do plano (deixe vazio para manter):\n${planChoices}`, current.plan_id || '');
      await api('/api/admin/subscriptions', { method: 'POST', body: { userId: tenant.id, status: nextStatus, planId: nextPlan || undefined } });
      await loadCore(); showNotice('Assinatura atualizada.'); return;
    }
    if (action === 'delete-plan') {
      if (!confirm('Excluir este plano? Assinaturas vinculadas podem impedir a exclusão.')) return;
      await api('/api/admin/plans', { method: 'DELETE', body: { id: target.dataset.id } });
      state.plans = (await api('/api/admin/plans')).data || []; showNotice('Plano excluído.'); return;
    }
    if (action === 'delete-admin') {
      if (!confirm(`Remover ${target.dataset.email} do painel?`)) return;
      await api('/api/admin/administrators', { method: 'DELETE', body: { email: target.dataset.email } });
      state.admins = (await api('/api/admin/administrators')).data || []; showNotice('Administrador removido.');
    }
  }));

  document.addEventListener('change', (event) => safe(async () => {
    const select = event.target.closest('[data-action="select-tenant"]');
    if (!select) return;
    state.selectedTenant = select.value;
    await loadSection('catalog'); render();
  }));

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