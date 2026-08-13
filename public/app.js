(() => {
  'use strict';

  const config = window.KORE_ADMIN_CONFIG || {};
  const app = document.querySelector('#app');
  const authHash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const inviteToken = authHash.get('type') === 'invite' ? authHash.get('access_token') : '';
  const state = {
    token: inviteToken || sessionStorage.getItem('koregastro_admin_token') || '',
    inviteMode: Boolean(inviteToken),
    mfaMode: null,
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
    adminSummary: null,
    adminRoles: [],
    adminMeta: null,
    health: null,
    logs: null,
    betaApplications: null,
    betaSummary: null,
    workCards: null,
    workMeta: null,
    workView: 'radar',
    notice: null,
    modal: null,
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

  const navigation = [
    { label: 'OperaÃ§Ã£o', items: [
      ['overview', 'VisÃ£o geral', 'âŒ‚'], ['workboard', 'Kanban operacional', 'â–¦'], ['subscriptions', 'Assinaturas', 'â—Ž'],
      ['tenants', 'Clientes', 'â—«'], ['beta', 'Programa beta', 'â˜…'], ['support', 'Suporte', 'âœ¦']
    ] },
    { label: 'Produto', items: [
      ['plans', 'Planos', 'â—‡'], ['catalog', 'CardÃ¡pios', 'â‰¡'], ['provision', 'Onboarding', '+']
    ] },
    { label: 'Sistema', items: [
      ['health', 'SaÃºde', 'â™¥'], ['logs', 'Auditoria', 'â‰‹'], ['administrators', 'Acessos', 'âš™']
    ] }
  ];
  const sectionLabels = Object.fromEntries(navigation.flatMap((group) => group.items.map(([key, label]) => [key, label])));

  const escape = (value = '') => String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value || 0));
  const date = (value) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : 'â€”';
  const day = (value) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(value)) : 'â€”';
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
  const BETA_STAGE_LABELS = { new: 'Nova', review: 'Em anÃ¡lise', contact: 'Contato', interview: 'Entrevista', approved: 'Aprovada', onboarding: 'Onboarding', active: 'Beta ativo', completed: 'ConcluÃ­da', converted: 'Convertida', closed: 'Encerrada' };
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
  const roleLabel = (role) => ({ owner: 'ProprietÃ¡rio', platform_admin: 'Administrador', finance: 'Financeiro', support: 'Suporte', auditor: 'Auditor' }[role] || role || 'Administrador');
  const accessStatusLabel = (value) => ({ invited: 'Convite pendente', active: 'Ativo', suspended: 'Suspenso', revoked: 'Revogado' }[value] || value || 'Desconhecido');
  const healthStatusLabel = (value) => ({ ok: 'Operacional', attention: 'AtenÃ§Ã£o', degraded: 'Degradado', critical: 'CrÃ­tico', unknown: 'Desconhecido', healthy: 'Operacional' }[value] || value);
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
    if (count) count.textContent = `${selectedCount} mÃ³dulo(s) selecionado(s)`;
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
      active: 'Ativa', trialing: 'Em teste', past_due: 'Inadimplente', canceled: 'Cancelada', unpaid: 'NÃ£o paga',
      open: 'Aberto', in_progress: 'Em atendimento', resolved: 'Resolvido', closed: 'Fechado', unknown: 'Sem status'
    };
    const safe = value || 'unknown';
    return `<span class="status status-${escape(safe)}"><i></i>${labels[safe] || escape(safe)}</span>`;
  }

  function entitlement(subscription) {
    if (!subscription) return '<span class="health-signal neutral"><i></i>Sem assinatura</span>';
    if (subscription.periodExpired) return '<span class="health-signal danger"><i></i>PerÃ­odo vencido</span>';
    if (subscription.entitlementActive) return '<span class="health-signal success"><i></i>Acesso vigente</span>';
    return '<span class="health-signal warning"><i></i>Acesso restrito</span>';
  }

  function onboarding(tenant) {
    const missing = tenant?.onboarding?.missing || [];
    if (!missing.length) return '<span class="health-signal success"><i></i>Completo</span>';
    const labels = { store: 'loja', company_profile: 'perfil empresarial', company_data: 'dados fiscais', subscription: 'assinatura' };
    return `<span class="health-signal warning" title="Faltando: ${escape(missing.map((item) => labels[item] || item).join(', '))}"><i></i>${missing.length} pendÃªncia(s)</span>`;
  }

  function sla(ticket) {
    if (!ticket || ['resolved', 'closed'].includes(ticket.status)) return '<span class="sla sla-done">ConcluÃ­do</span>';
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
    const labels = { onboarding: 'Onboarding', active: 'Beta ativo', completed: 'ConcluÃ­do', converted: 'Convertido', closed: 'Encerrado' };
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
    if (!participant?.activated_at) return '<span class="health-signal warning"><i></i>Aguardando ativaÃ§Ã£o</span>';
    const remaining = betaRemainingDays(participant);
    if (remaining === null) return '<span class="health-signal warning"><i></i>Sem data de encerramento</span>';
    if (remaining < 0) return `<span class="health-signal danger"><i></i>Beta encerrado hÃ¡ ${Math.abs(remaining)} dia(s)</span>`;
    if (remaining <= 7) return `<span class="health-signal danger"><i></i>${remaining} dia(s) restantes</span>`;
    if (remaining <= 21) return `<span class="health-signal warning"><i></i>${remaining} dia(s) restantes</span>`;
    return `<span class="health-signal success"><i></i>${remaining} dia(s) restantes</span>`;
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
    if (!response.ok) throw new Error(body.error || 'NÃ£o foi possÃ­vel concluir a operaÃ§Ã£o.');
    return body;
  }

  async function authRequest(path, options = {}) {
    const response = await fetch(`${String(config.supabaseUrl).replace(/\/$/, '')}/auth/v1${path}`, {
      method: options.method || 'GET',
      headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${state.token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.msg || body.message || body.error_description || 'NÃ£o foi possÃ­vel validarãMôÖÚ$z{-®éÜj×€€€€…Ý…¥Ð…Á¤ œ½…Á¤½…‘µ¥¸½Ý½É¬µ‰½…Éœ°ìµ•Ñ¡½è€AQ œ°‰½‘äèì(€€€€€€€Í½ÕÉ”è…É¹Í½ÕÉ”°¥è…É¹Í½ÕÉ•%°ÍÑ…ÑÕÌèÙ…±Õ•Ì¹ÍÑ…ÑÕÌ°(€€€€€€€…ÍÍ¥¹•‘Q¼èÙ…±Õ•Ì¹…ÍÍ¥¹•‘Q¼ñð¹Õ±°°(€€€€€€€‘Õ•ÐèÙ…±Õ•Ì¹‘Õ•Ð€ü¹•Ü…Ñ”¡Ù…±Õ•Ì¹‘Õ•Ð¤¹Ñ½%M=MÑÉ¥¹œ ¤€è¹Õ±°°(€€€€€€€Á½Í¥Ñ¥½¸è…Ñ”¹¹½Ü ¤°¹½Ñ”èÙ…±Õ•Ì¹¹½Ñ”ñð¹Õ±°°(€€€€€€€•áÁ•Ñ•‘UÁ‘…Ñ•‘Ðè…É¹Í½ÕÉ•UÁ‘…Ñ•‘Ð(€€€€€ôô¤ì(€€€€€ÍÑ…Ñ”¹µ½‘…°€ô¹Õ±°ì(€€€€€¥˜€¡…É¹Í½ÕÉ”€ôôô€ÍÕÁÁ½ÉÐœ¤ÍÑ…Ñ”¹Ñ¥­•ÑÌ€ô¹Õ±°ì(€€€€€¥˜€¡…É¹Í½ÕÉ”€ôôô€‰•Ñ„œ¤ÍÑ…Ñ”¹‰•Ñ…ÁÁ±¥…Ñ¥½¹Ì€ô¹Õ±°ì(€€€€€…Ý…¥Ð±½…‘M•Ñ¥½¸ Ý½É­‰½…Éœ°ÑÉÕ”¤ì(€€€€€É•¹‘•È ¤ì(€€€€€Í¡½Ý9½Ñ¥” …É…ÑÕ…±¥é…‘¼”É•¥ÍÑÉ…‘¼¹„…Õ‘¥Ñ½É¥„¸œ¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€¥˜€¡™½É´¹‘…Ñ…Í•Ð¹™½É´€ôôô€‰•Ñ„µ…ÁÁ±¥…Ñ¥½¸œ¤ì(€€€€€…Ý…¥Ð…Á¤ œ½…Á¤½…‘µ¥¸½‰•Ñ„µ…ÁÁ±¥…Ñ¥½¹Ìœ°ìµ•Ñ¡½è€AQ œ°‰½‘äèì¥èÙ…±Õ•Ì¹¥°ÍÑ…ÑÕÌèÙ…±Õ•Ì¹ÍÑ…ÑÕÌ°½¡½ÉÐèÙ…±Õ•Ì¹½¡½ÉÐ°¹½Ñ”èÙ…±Õ•Ì¹¹½Ñ”ôô¤ì(€€€€€…Ý…¥Ð±½…‘M•Ñ¥½¸ ‰•Ñ„œ°ÑÉÕ”¤ì(€€€€€É•¹‘•È ¤ì(€€€€€Í¡½Ý9½Ñ¥”¡Ù…±Õ•Ì¹ÍÑ…ÑÕÌ€ôôô€…Ñ¥Ù”œ€ü€A…ÉÑ¥¥Á…¹Ñ”…Ñ¥Ù…‘¼ì¼¥±¼‘”€äÀ‘¥…Ì½µ—½Ô¸œ€è€½µÁ…¹¡…µ•¹Ñ¼É•¥ÍÑÉ…‘¼¹¼¡¥ÍÓÍÉ¥¼¸œ¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€¥˜€¡™½É´¹‘…Ñ…Í•Ð¹™½É´€ôôô€…Õ‘¥Ðµ™¥±Ñ•Èœ¤ì4(€€€€€=‰©•Ð¹…ÍÍ¥¸¡ÍÑ…Ñ”¹™¥±Ñ•ÉÌ°ì4(€€€€€€€…Õ‘¥ÑEÕ•ÉäèÙ…±Õ•Ì¹Äñð€œœ°…Õ‘¥Ñ…Ñ•½ÉäèÙ…±Õ•Ì¹…Ñ•½Éäñð€…±°œ°…Õ‘¥Ñ=ÕÑ½µ”èÙ…±Õ•Ì¹½ÕÑ½µ”ñð€…±°œ°4(€€€€€€€…Õ‘¥ÑÑ½ÈèÙ…±Õ•Ì¹…Ñ½Èñð€œœ°…Õ‘¥ÑÉ½´èÙ…±Õ•Ì¹™É½´ñð€œœ°…Õ‘¥ÑQ¼èÙ…±Õ•Ì¹Ñ¼ñð€œœ°…Õ‘¥ÑA…”è€Ä4(€€€€€ô¤ì4(€€€€€ÍÑ…Ñ”¹±½Ì€ô¹Õ±°ì4(€€€€€ÍÑ…Ñ”¹±½…‘¥¹œ€ôÑÉÕ”ì4(€€€€€É•¹‘•È ¤ì4(€€€€€…Ý…¥Ð±½…‘M•Ñ¥½¸ ±½Ìœ°ÑÉÕ”¤ì4(€€€€€ÍÑ…Ñ”¹±½…‘¥¹œ€ô™…±Í”ì4(€€€€€É•¹‘•È ¤ì4(€€€€€É•ÑÕÉ¸ì4(€€€ô4(€ô¤¤ì4(4(€‘½Õµ•¹Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ±¥¬œ°€¡•Ù•¹Ð¤€ôøÍ…™”¡…Íå¹Œ€ ¤€ôøì4(€€€½¹ÍÐÑ…É•Ð€ô•Ù•¹Ð¹Ñ…É•Ð¹±½Í•ÍÐ m‘…Ñ„µ…Ñ¥½¹tœ¤ì4(€€€¥˜€ …Ñ…É•Ð¤É•ÑÕÉ¸ì4(€€€½¹ÍÐ…Ñ¥½¸€ôÑ…É•Ð¹‘…Ñ…Í•Ð¹…Ñ¥½¸ì4(€€€¥˜€¡…Ñ¥½¸€ôôô€±½½ÕÐœ¤É•ÑÕÉ¸Í¥¹=ÕÐ ¤ì4(€€€¥˜€¡…Ñ¥½¸€ôôô€½Áäµµ™„µÍ•É•Ðœ¤ì4(€€€€€…Ý…¥Ð¹…Ù¥…Ñ½È¹±¥Á‰½…É¹ÝÉ¥Ñ•Q•áÐ¡ÍÑ…Ñ”¹µ™…5½‘”ü¹Í•É•Ðñð€œœ¤ì4(€€€€€Í¡½Ý9½Ñ¥” ¡…Ù”‘¼…ÕÑ•¹Ñ¥…‘½È½Á¥…‘„¸œ¤ì4(€€€€€É•ÑÕÉ¸ì4(€€€ô4(€€€¥˜€¡…Ñ¥½¸€ôôô€Í•Ñ¥½¸œñð…Ñ¥½¸€ôôô€½µµ…¹µÍ•Ñ¥½¸œ¤É•ÑÕÉ¸½Á•¹M•Ñ¥½¸¡Ñ…É•Ð¹‘…Ñ…Í•Ð¹Í•Ñ¥½¸¤ì4(€€€¥˜€¡…Ñ¥½¸€ôôô€™¥±Ñ•É•µÍ•Ñ¥½¸œ¤ìÍÑ…Ñ”¹™¥±Ñ•ÉÌ¹ÍÕ‰ÍÉ¥ÁÑ¥½¹MÑ…ÑÕÌ€ôÑ…É•Ð¹‘…Ñ…Í•Ð¹™¥±Ñ•ÈìÉ•ÑÕÉ¸½Á•¹M•Ñ¥½¸¡Ñ…É•Ð¹‘…Ñ…Í•Ð¹Í•Ñ¥½¸¤ìô4(€€€¥˜€¡…Ñ¥½¸€ôôô€Ñ½±”µÍ¥‘•‰…Èœ¤ìÍÑ…Ñ”¹Í¥‘•‰…É=Á•¸€ô€…ÍÑ…Ñ”¹Í¥‘•‰…É=Á•¸ìÉ•¹‘•È ¤ìÉ•ÑÕÉ¸ìô4(€€€¥˜€¡…Ñ¥½¸€ôôô€É•™É•Í œ¤É•ÑÕÉ¸±½…‘½É” ¤ì4(€€€¥˜€¡…Ñ¥½¸€ôôô€‘¥Íµ¥ÍÌµ¹½Ñ¥”œ¤ìÍÑ…Ñ”¹¹½Ñ¥”€ô¹Õ±°ìÉ•¹‘•È ¤ìÉ•ÑÕÉ¸ìô4(€€€¥˜€¡…Ñ¥½¸€ôôô€±½Í”µµ½‘…°œ¤ìÍÑ…Ñ”¹µ½‘…°€ô¹Õ±°ìÉ•¹‘•È ¤ìÉ•ÑÕÉ¸ìô4(€€€¥˜€¡…Ñ¥½¸€ôôô€µ…¹…”µ…‘µ¥¸œ¤ìÍÑ…Ñ”¹µ½‘…°€ôìÑåÁ”è€…‘µ¥¸µ…•ÍÌœ°•µ…¥°èÑ…É•Ð¹‘…Ñ…Í•Ð¹•µ…¥°ôìÉ•¹‘•È ¤ìÉ•ÑÕÉ¸ìô(€€€¥˜€¡…Ñ¥½¸€ôôô€Ù¥•Üµ…Õ‘¥Ðœ¤ìÍÑ…Ñ”¹µ½‘…°€ôìÑåÁ”è€…Õ‘¥Ðµ•Ù•¹Ðœ°¥èÑ…É•Ð¹‘…Ñ…Í•Ð¹¥ôìÉ•¹‘•È ¤ìÉ•ÑÕÉ¸ìô(€€€¥˜€¡…Ñ¥½¸€ôôô€Ý½É¬µÙ¥•Üœ¤ìÍÑ…Ñ”¹Ý½É­Y¥•Ü€ôÑ…É•Ð¹‘…Ñ…Í•Ð¹Ù¥•Üñð€É…‘…ÈœìÉ•¹‘•È ¤ìÉ•ÑÕÉ¸ìô(€€€¥˜€¡…Ñ¥½¸€ôôô€½É…¹¥é”µÝ½É¬œ¤ìÍÑ…Ñ”¹µ½‘…°€ôìÑåÁ”è€Ý½É¬µ¥Ñ•´œ°­•äèÑ…É•Ð¹‘…Ñ…Í•Ð¹­•äôìÉ•¹‘•È ¤ìÉ•ÑÕÉ¸ìô(€€€¥˜€¡…Ñ¥½¸€ôôô€½Á•¸µÝ½É¬µ¥Ñ•´œ¤ì(€€€€€½¹ÍÐ…É€ô€¡ÍÑ…Ñ”¹Ý½É­…É‘Ìñðmt¤¹™¥¹ ¡¥Ñ•´¤€ôø¥Ñ•´¹­•ä€ôôôÑ…É•Ð¹‘…Ñ…Í•Ð¹­•ä¤ì(€€€€€¥˜€ ……É¤É•ÑÕÉ¸ì(€€€€€¥˜€¡…É¹Í½ÕÉ”€ôôô€ÍÕÁÁ½ÉÐœ¤ì(€€€€€€€ÍÑ…Ñ”¹Í•±•Ñ•‘Q¥­•Ñ%€ô…É¹Í½ÕÉ•%ì(€€€€€€€É•ÑÕÉ¸½Á•¹M•Ñ¥½¸ ÍÕÁÁ½ÉÐœ¤ì(€€€€€ô(€€€€€¥˜€ …ÍÑ…Ñ”¹‰•Ñ…ÁÁ±¥…Ñ¥½¹Ì¤…Ý…¥Ð±½…‘M•Ñ¥½¸ ‰•Ñ„œ°ÑÉÕ”¤ì(€€€€€ÍÑ…Ñ”¹µ½‘…°€ôìÑåÁ”è€‰•Ñ„µ…ÁÁ±¥…Ñ¥½¸œ°¥è…É¹Í½ÕÉ•%ôì(€€€€€É•¹‘•È ¤ì(€€€€€É•ÑÕÉ¸ì(€€€ô(€€€¥˜€¡…Ñ¥½¸€ôôô€½Á•¸µ‰•Ñ„œ¤ìÍÑ…Ñ”¹µ½‘…°€ôìÑåÁ”è€‰•Ñ„µ…ÁÁ±¥…Ñ¥½¸œ°¥èÑ…É•Ð¹‘…Ñ…Í•Ð¹¥ôìÉ•¹‘•È ¤ìÉ•ÑÕÉ¸ìô(€€€¥˜€¡…Ñ¥½¸€ôôô€½Á•¸µÁ±…¸œ¤ìÍÑ…Ñ”¹µ½‘…°€ôìÑåÁ”è€Á±…¸œôìÉ•¹‘•È ¤ìÉ•ÑÕÉ¸ìô4(€€€¥˜€¡…Ñ¥½¸€ôôô€•‘¥ÐµÁ±…¸œ¤ìÍÑ…Ñ”¹µ½‘…°€ôìÑåÁ”è€Á±…¸œ°¥èÑ…É•Ð¹‘…Ñ…Í•Ð¹¥ôìÉ•¹‘•È ¤ìÉ•ÑÕÉ¸ìô4(€€€¥˜€¡…Ñ¥½¸€ôôô€‘ÕÁ±¥…Ñ”µÁ±…¸œ¤ìÍÑ…Ñ”¹µ½‘…°€ôìÑåÁ”è€Á±…¸œ°¥èÑ…É•Ð¹‘…Ñ…Í•Ð¹¥°‘ÕÁ±¥…Ñ”èÑÉÕ”ôìÉ•¹‘•È ¤ìÉ•ÑÕÉ¸ìô4(€€€¥˜€¡…Ñ¥½¸€ôôô€Í•±•Ðµ…±°µÁ•Éµ¥ÍÍ¥½¹Ìœñð…Ñ¥½¸€ôôô€±•…ÈµÁ•Éµ¥ÍÍ¥½¹Ìœ¤ì4(€€€€€½¹ÍÐ™½É´€ôÑ…É•Ð¹±½Í•ÍÐ ™½É´œ¤ì4(€€€€€™½É´ü¹ÅÕ•ÉåM•±•Ñ½É±° ¥¹ÁÕÑmÑåÁ”ô‰¡•­‰½à‰um¹…µ”ô‰Á•Éµ¥ÍÍ¥½¹Ì‰tœ¤¹™½É…  ¡¡•­‰½à¤€ôøì¡•­‰½à¹¡•­•€ô…Ñ¥½¸€ôôô€Í•±•Ðµ…±°µÁ•Éµ¥ÍÍ¥½¹Ìœìô¤ì4(€€€€€ÕÁ‘…Ñ•A•Éµ¥ÍÍ¥½¹MÕµµ…Éä¡™½É´¤ì4(€€€€€É•ÑÕÉ¸ì4(€€€ô4(€€€¥˜€¡…Ñ¥½¸€ôôô€Ñ½±”µÁ•Éµ¥ÍÍ¥½¸µÉ½ÕÀœ¤ì4(€€€€€½¹ÍÐ™½É´€ôÑ…É•Ð¹±½Í•ÍÐ ™½É´œ¤ì4(€€€€€½¹ÍÐ¡•­‰½á•Ì€ôl¸¸¹Ñ…É•Ð¹±½Í•ÍÐ m‘…Ñ„µÁ•Éµ¥ÍÍ¥½¸µÉ½ÕÁtœ¤ü¹ÅÕ•ÉåM•±•Ñ½É±° ¥¹ÁÕÑm¹…µ”ô‰Á•Éµ¥ÍÍ¥½¹Ì‰tœ¤ñðmutì4(€€€€€½¹ÍÐÍ¡½Õ±‘M•±•Ð€ô¡•­‰½á•Ì¹Í½µ” ¡¡•­‰½à¤€ôø€…¡•­‰½à¹¡•­•¤ì4(€€€€€¡•­‰½á•Ì¹™½É…  ¡¡•­‰½à¤€ôøì¡•­‰½à¹¡•­•€ôÍ¡½Õ±‘M•±•Ðìô¤ì4(€€€€€ÕÁ‘…Ñ•A•Éµ¥ÍÍ¥½¹MÕµµ…Éä¡™½É´¤ì4(€€€€€É•ÑÕÉ¸ì4(€€€ô4(€€€¥˜€¡…Ñ¥½¸€ôôô€½Á•¸µ…Ñ…±½œµ¥Ñ•´œ¤ìÍÑ…Ñ”¹µ½‘…°€ôìÑåÁ”è€…Ñ…±½œµ¥Ñ•´œôìÉ•¹‘•È ¤ìÉ•ÑÕÉ¸ìô4(€€€¥˜€¡…Ñ¥½¸€ôôô€•‘¥Ðµ…Ñ…±½œµ¥Ñ•´œ¤ìÍÑ…Ñ”¹µ½‘…°€ôìÑåÁ”è€…Ñ…±½œµ¥Ñ•´œ°¥èÑ…É•Ð¹‘…Ñ…Í•Ð¹¥ôìÉ•¹‘•È ¤ìÉ•ÑÕÉ¸ìô4(€€€¥˜€¡…Ñ¥½¸€ôôô€•¹•É…Ñ”µÁ…ÍÍÝ½Éœ¤ì4(€€€€€½¹ÍÐ¥¹ÁÕÐ€ôÑ…É•Ð¹±½Í•ÍÐ ™½É´œ¤ü¹ÅÕ•ÉåM•±•Ñ½È m¹…µ”ô‰¥¹¥Ñ¥…±A…ÍÍÝ½É‰tœ¤ì4(€€€€€¥˜€¡¥¹ÁÕÐ¤ì¥¹ÁÕÐ¹Ù…±Õ”€ôÉ…¹‘½µA…ÍÍÝ½É ¤ì¥¹ÁÕÐ¹™½ÕÌ ¤ì¥¹ÁÕÐ¹Í•±•Ð ¤ìô4(€€€€€É•ÑÕÉ¸ì4(€€€ô4(€€€¥˜€¡…Ñ¥½¸€ôôô€½Áäµ½¹‰½…É‘¥¹œœ¤ì4(€€€€€½¹ÍÐÙ…±Õ•Ì€ôì•µ…¥°èÍÑ…Ñ”¹µ½‘…°ü¹‘…Ñ„ü¹…ÕÑ ü¹•µ…¥°°Á…ÍÍÝ½ÉèÍÑ…Ñ”¹µ½‘…°ü¹Á…ÍÍÝ½É°…Á¥-•äèÍÑ…Ñ”¹µ½‘…°ü¹‘…Ñ„ü¹Ñ•¹…¹Ðü¹…Á¥-•äôì4(€€€€€…Ý…¥Ð¹…Ù¥…Ñ½È¹±¥Á‰½…É¹ÝÉ¥Ñ•Q•áÐ¡MÑÉ¥¹œ¡Ù…±Õ•ÍmÑ…É•Ð¹‘…Ñ…Í•Ð¹½Áåtñð€œœ¤¤ì4(€€€€€Í¡½Ý9½Ñ¥” %¹™½Éµ‡Ÿ¼½Á¥…‘„½´Í•ÕÉ…»„¸œ¤ì4(€€€€€É•ÑÕÉ¸ì4(€€€ô4(€€€¥˜€¡…Ñ¥½¸€ôôô€Ù¥•ÜµÁÉ½Ù¥Í¥½¹•µÕÍÑ½µ•Èœ¤ìÍÑ…Ñ”¹µ½‘…°€ôìÑåÁ”è€Ñ•¹…¹Ðœ°¥èÑ…É•Ð¹‘…Ñ…Í•Ð¹¥ôìÉ•¹‘•È ¤ìÉ•ÑÕÉ¸ìô4(€€€¥˜€¡…Ñ¥½¸€ôôô€½Á•¸µÁÉ½Ù¥Í¥½¸œ¤É•ÑÕÉ¸½Á•¹M•Ñ¥½¸ ÁÉ½Ù¥Í¥½¸œ¤ì4(€€€¥˜€¡…Ñ¥½¸€ôôô€½Á•¸µÑ•¹…¹Ðœ¤ìÍÑ…Ñ”¹±½‰…±EÕ•Éä€ô€œœìÍÑ…Ñ”¹µ½‘…°€ôìÑåÁ”è€Ñ•¹…¹Ðœ°¥èÑ…É•Ð¹‘…Ñ…Í•Ð¹¥ôìÉ•¹‘•È ¤ìÉ•ÑÕÉ¸ìô4(€€€¥˜€¡…Ñ¥½¸€ôôô€•‘¥ÐµÍÕ‰ÍÉ¥ÁÑ¥½¸œ¤ìÍÑ…Ñ”¹µ½‘…°€ôìÑåÁ”è€ÍÕ‰ÍÉ¥ÁÑ¥½¸œ°¥èÑ…É•Ð¹‘…Ñ…Í•Ð¹¥ôìÉ•¹‘•È ¤ìÉ•ÑÕÉ¸ìô4(€€€¥˜€¡…Ñ¥½¸€ôôô€Ñ•¹…¹Ðµ…Ñ…±½œœ¤ì4(€€€€€ÍÑ…Ñ”¹µ½‘…°€ô¹Õ±°ì4(€€€€€ÍÑ…Ñ”¹Í•±•Ñ•‘Q•¹…¹Ð€ôÑ…É•Ð¹‘…Ñ…Í•Ð¹¥ì4(€€€€€½¹ÍÐÑ•¹…¹Ð€ôÍÑ…Ñ”¹Ñ•¹…¹ÑÌ¹™¥¹ ¡¥Ñ•´¤€ôøMÑÉ¥¹œ¡¥Ñ•´¹…½Õ¹Ñ%ñð¥Ñ•´¹¥¤€ôôôMÑÉ¥¹œ¡Ñ…É•Ð¹‘…Ñ…Í•Ð¹¥¤¤ì4(€€€€€ÍÑ…Ñ”¹Í•±•Ñ•‘MÑ½É”€ôÑ•¹…¹Ðü¹ÍÑ½É•Ìü¹lÁtü¹ÍÑ½É•%ñðÑ•¹…¹Ðü¹ÍÑ½É•Ìü¹lÁtü¹¥ñð€œœì4(€€€€€É•ÑÕÉ¸½Á•¹M•Ñ¥½¸ …Ñ…±½œœ¤ì4(€€€ô4(€€€¥˜€¡…Ñ¥½¸€ôôô€•áÁ½ÉÐœ¤ì‘½Ý¹±½…‘ÍØ¡Ñ…É•Ð¹‘…Ñ…Í•Ð¹­¥¹¤ìÉ•ÑÕÉ¸ìô4(€€€¥˜€¡…Ñ¥½¸€ôôô€Ñ¥­•Ðµ™¥±Ñ•Èœ¤ìÍÑ…Ñ”¹™¥±Ñ•ÉÌ¹Ñ¥­•ÑMÑ…ÑÕÌ€ôÑ…É•Ð¹‘…Ñ…Í•Ð¹Ù…±Õ”ìÉ•¹‘•È ¤ìÉ•ÑÕÉ¸ìô4(€€€¥˜€¡…Ñ¥½¸€ôôô€Í•±•ÐµÑ¥­•Ðœ¤ìÍÑ…Ñ”¹Í•±•Ñ•‘Q¥­•Ñ%€ôÑ…É•Ð¹‘…Ñ…Í•Ð¹¥ìÉ•¹‘•È ¤ìÉ•ÑÕÉ¸ìô4(€€€¥˜€¡…Ñ¥½¸€ôôô€½Á•¸µÑ¥­•Ðœ¤ìÍÑ…Ñ”¹Í•±•Ñ•‘Q¥­•Ñ%€ôÑ…É•Ð¹‘…Ñ…Í•Ð¹¥ìÉ•ÑÕÉ¸½Á•¹M•Ñ¥½¸ ÍÕÁÁ½ÉÐœ¤ìô4(€€€¥˜€¡…Ñ¥½¸€ôôô€É•±½…µÑ¥­•ÑÌœ¤ìÍÑ…Ñ”¹±½…‘¥¹œ€ôÑÉÕ”ìÉ•¹‘•È ¤ì…Ý…¥Ð±½…‘M•Ñ¥½¸ ÍÕÁÁ½ÉÐœ°ÑÉÕ”¤ìÍÑ…Ñ”¹±½…‘¥¹œ€ô™…±Í”ìÉ•¹‘•È ¤ìÉ•ÑÕÉ¸ìô(€€€¥˜€¡…Ñ¥½¸€ôôô€É•±½…µÝ½É­‰½…Éœ¤ìÍÑ…Ñ”¹Ý½É­…É‘Ì€ô¹Õ±°ìÍÑ…Ñ”¹±½…‘¥¹œ€ôÑÉÕ”ìÉ•¹‘•È ¤ì…Ý…¥Ð±½…‘M•Ñ¥½¸ Ý½É­‰½…Éœ°ÑÉÕ”¤ìÍÑ…Ñ”¹±½…‘¥¹œ€ô™…±Í”ìÉ•¹‘•È ¤ìÉ•ÑÕÉ¸ìô(€€€¥˜€¡…Ñ¥½¸€ôôô€É•Í½±Ù”µÑ¥­•Ðœ¤ì4(€€€€€…Ý…¥Ð…Á¤ œ½…Á¤½…‘µ¥¸½Ñ¥­•ÑÌœ°ìµ•Ñ¡½è€AUPœ°‰½‘äèì¥èÑ…É•Ð¹‘…Ñ…Í•Ð¹¥°ÕÁ‘…Ñ•ÌèìÍÑ…ÑÕÌè€É•Í½±Ù•œôôô¤ì4(€€€€€½¹ÍÐÑ¥­•ÑÌ€ô…Ý…¥Ð…Á¤ œ½…Á¤½…‘µ¥¸½Ñ¥­•ÑÌœ¤ì4(€€€€€ÍÑ…Ñ”¹Ñ¥­•ÑÌ€ôÑ¥­•ÑÌ¹‘…Ñ„ñðmtì4(€€€€€ÍÑ…Ñ”¹Ñ¥­•ÑMÕµµ…Éä€ôÑ¥­•ÑÌ¹ÍÕµµ…Éäñð¹Õ±°ì4(€€€€€ÍÑ…Ñ”¹Ñ¥­•Ñ5•Ñ„€ôÑ¥­•ÑÌ¹µ•Ñ„ñð¹Õ±°ì4(€€€€€Í¡½Ý9½Ñ¥” ¡…µ…‘¼µ…É…‘¼½µ¼É•Í½±Ù¥‘¼¸œ¤ì4(€€€€€É•ÑÕÉ¸ì4(€€€ô4(€€€¥˜€¡…Ñ¥½¸€ôôô€É•±½…µ¡•…±Ñ œ¤ì4(€€€€€ÍÑ…Ñ”¹±½…‘¥¹œ€ôÑÉÕ”ìÉ•¹‘•È ¤ì4(€€€€€ÍÑ…Ñ”¹¡•…±Ñ €ô…Ý…¥Ð…Á¤ œ½…Á¤½…‘µ¥¸½¡•…±Ñ œ°ìµ•Ñ¡½è€A=MPœô¤ì4(€€€€€ÍÑ…Ñ”¹±½…‘¥¹œ€ô™…±Í”ì4(€€€€€Í¡½Ý9½Ñ¥” ¥…»ÍÍÑ¥¼½¹±×µ‘¼”…Éµ…é•¹…‘¼¹¼¡¥ÍÓÍÉ¥¼¸œ¤ì4(€€€€€É•ÑÕÉ¸ì4(€€€ô4(€€€¥˜€¡…Ñ¥½¸€ôôô€¡•…±Ñ µ¹…Ù¥…Ñ”œ¤ì4(€€€€€¥˜€¡Ñ…É•Ð¹‘…Ñ…Í•Ð¹Í•Ñ¥½¸€ôôô€ÍÕ‰ÍÉ¥ÁÑ¥½¹Ìœ€˜˜Ñ…É•Ð¹‘…Ñ…Í•Ð¹™¥±Ñ•È¤ÍÑ…Ñ”¹™¥±Ñ•ÉÌ¹ÍÕ‰ÍÉ¥ÁÑ¥½¹MÑ…ÑÕÌ€ôÑ…É•Ð¹‘…Ñ…Í•Ð¹™¥±Ñ•Èì4(€€€€€É•ÑÕÉ¸½Á•¹M•Ñ¥½¸¡Ñ…É•Ð¹‘…Ñ…Í•Ð¹Í•Ñ¥½¸¤ì4(€€€ô4(€€€¥˜€¡…Ñ¥½¸€ôôô€É•±½…µ±½Ìœ¤ìÍÑ…Ñ”¹±½Ì€ô¹Õ±°ìÍÑ…Ñ”¹±½…‘¥¹œ€ôÑÉÕ”ìÉ•¹‘•È ¤ì…Ý…¥Ð±½…‘M•Ñ¥½¸ ±½Ìœ°ÑÉÕ”¤ìÍÑ…Ñ”¹±½…‘¥¹œ€ô™…±Í”ìÉ•¹‘•È ¤ìÉ•ÑÕÉ¸ìô4(€€€¥˜€¡…Ñ¥½¸€ôôô€É•±½…µ‰•Ñ„œ¤ìÍÑ…Ñ”¹‰•Ñ…ÁÁ±¥…Ñ¥½¹Ì€ô¹Õ±°ìÍÑ…Ñ”¹±½…‘¥¹œ€ôÑÉÕ”ìÉ•¹‘•È ¤ì…Ý…¥Ð±½…‘M•Ñ¥½¸ ‰•Ñ„œ°ÑÉÕ”¤ìÍÑ…Ñ”¹±½…‘¥¹œ€ô™…±Í”ìÉ•¹‘•È ¤ìÉ•ÑÕÉ¸ìô4(€€€¥˜€¡…Ñ¥½¸€ôôô€½¹Ù•ÉÐµ‰•Ñ„œ¤ì4(€€€€€…Ý…¥Ð…Á¤ œ½…Á¤½…‘µ¥¸½‰•Ñ„µ…ÁÁ±¥…Ñ¥½¹Ìœ°ìµ•Ñ¡½è€A=MPœ°‰½‘äèì¥èÑ…É•Ð¹‘…Ñ…Í•Ð¹¥ôô¤ì4(€€€€€…Ý…¥Ð±½…‘M•Ñ¥½¸ ‰•Ñ„œ°ÑÉÕ”¤ìÉ•¹‘•È ¤ìÍ¡½Ý9½Ñ¥” A…ÉÑ¥¥Á…¹Ñ”É¥…‘¼”µ½Ù¥‘¼Á…É„½¹‰½…É‘¥¹œ¸œ¤ìÉ•ÑÕÉ¸ì4(€€€ô4(€€€¥˜€¡…Ñ¥½¸€ôôô€•áÁ½ÉÐµ…Õ‘¥Ðœ¤ì…Ý…¥Ð‘½Ý¹±½…‘Õ‘¥ÑÍØ ¤ìÉ•ÑÕÉ¸ìô4(€€€¥˜€¡…Ñ¥½¸€ôôô€…Õ‘¥ÐµÁ…”œ¤ì4(€€€€€ÍÑ…Ñ”¹™¥±Ñ•ÉÌ¹…Õ‘¥ÑA…”€ô9Õµ‰•È¡Ñ…É•Ð¹‘…Ñ…Í•Ð¹Á…”ñð€Ä¤ì4(€€€€€ÍÑ…Ñ”¹±½Ì€ô¹Õ±°ìÍÑ…Ñ”¹±½…‘¥¹œ€ôÑÉÕ”ìÉ•¹‘•È ¤ì4(€€€€€…Ý…¥Ð±½…‘M•Ñ¥½¸ ±½Ìœ°ÑÉÕ”¤ìÍÑ…Ñ”¹±½…‘¥¹œ€ô™…±Í”ìÉ•¹‘•È ¤ìÉ•ÑÕÉ¸ì4(€€€ô4(€€€¥˜€¡…Ñ¥½¸€ôôô€±•…Èµ…Õ‘¥Ðµ™¥±Ñ•ÉÌœ¤ì4(€€€€€=‰©•Ð¹…ÍÍ¥¸¡ÍÑ…Ñ”¹™¥±Ñ•ÉÌ°ì…Õ‘¥ÑEÕ•Éäè€œœ°…Õ‘¥Ñ…Ñ•½Éäè€…±°œ°…Õ‘¥Ñ=ÕÑ½µ”è€…±°œ°…Õ‘¥ÑÑ½Èè€œœ°…Õ‘¥ÑÉ½´è€œœ°…Õ‘¥ÑQ¼è€œœ°…Õ‘¥ÑA…”è€Äô¤ì4(€€€€€ÍÑ…Ñ”¹±½Ì€ô¹Õ±°ìÍÑ…Ñ”¹±½…‘¥¹œ€ôÑÉÕ”ìÉ•¹‘•È ¤ì4(€€€€€…Ý…¥Ð±½…‘M•Ñ¥½¸ ±½Ìœ°ÑÉÕ”¤ìÍÑ…Ñ”¹±½…‘¥¹œ€ô™…±Í”ìÉ•¹‘•È ¤ìÉ•ÑÕÉ¸ì4(€€€ô4(€€€¥˜€¡…Ñ¥½¸€ôôô€Ñ½±”µµ•¹Ôœ¤ì4(€€€€€…Ý…¥Ð…Á¤ œ½…Á¤½…‘µ¥¸½Ñ•¹…¹Ðµµ•¹Ôœ°ìµ•Ñ¡½è€AUPœ°‰½‘äèìÍÑ½É•%èÍÑ…Ñ”¹Í•±•Ñ•‘MÑ½É”°¥èÑ…É•Ð¹‘…Ñ…Í•Ð¹¥°¥Ñ•´èì¥Í}…Ù…¥±…‰±”èÑ…É•Ð¹‘…Ñ…Í•Ð¹…Ù…¥±…‰±”€„ôô€ÑÉÕ”œôôô¤ì4(€€€€€…Ý…¥Ð±½…‘M•Ñ¥½¸ …Ñ…±½œœ¤ìÉ•¹‘•È ¤ìÍ¡½Ý9½Ñ¥” ¥ÍÁ½¹¥‰¥±¥‘…‘”…ÑÕ…±¥é…‘„¸œ¤ìÉ•ÑÕÉ¸ì4(€€€ô4(€€€¥˜€¡…Ñ¥½¸€ôôô€‘•±•Ñ”µÁ±…¸œ¤ì4(€€€€€¥˜€ …½¹™¥É´ á±Õ¥È•ÍÑ”Á±…¹¼üÍÍ¥¹…ÑÕÉ…ÌÙ¥¹Õ±…‘…ÌÁ½‘•´¥µÁ•‘¥È„•á±ÕÏ¼¸œ¤¤É•ÑÕÉ¸ì4(€€€€€…Ý…¥Ð…Á¤ œ½…Á¤½…‘µ¥¸½Á±…¹Ìœ°ìµ•Ñ¡½è€1Qœ°‰½‘äèì¥èÑ…É•Ð¹‘…Ñ…Í•Ð¹¥ôô¤ì4(€€€€€ÍÑ…Ñ”¹Á±…¹Ì€ô€¡…Ý…¥Ð…Á¤ œ½…Á¤½…‘µ¥¸½Á±…¹Ìœ¤¤¹‘…Ñ„ñðmtìÍ¡½Ý9½Ñ¥” A±…¹¼•á±×µ‘¼¸œ¤ìÉ•ÑÕÉ¸ì4(€€€ô4(€€€¥˜€¡…Ñ¥½¸€ôôô€‘•±•Ñ”µ…‘µ¥¸œ¤ì4(€€€€€¥˜€ …½¹™¥É´¡I•µ½Ù•È€‘íÑ…É•Ð¹‘…Ñ…Í•Ð¹•µ…¥±ô‘¼½¹ÑÉ½°•¹Ñ•Èý€¤¤É•ÑÕÉ¸ì4(€€€€€…Ý…¥Ð…Á¤ œ½…Á¤½…‘µ¥¸½…‘µ¥¹¥ÍÑÉ…Ñ½ÉÌœ°ìµ•Ñ¡½è€1Qœ°‰½‘äèì•µ…¥°èÑ…É•Ð¹‘…Ñ…Í•Ð¹•µ…¥°°É•…Í½¸è€•ÍÍ¼É•Ù½…‘¼Á•±¼Á…¥¹•°œôô¤ì4(€€€€€…Ý…¥Ð±½…‘M•Ñ¥½¸ …‘µ¥¹¥ÍÑÉ…Ñ½ÉÌœ°ÑÉÕ”¤ìÍ¡½Ý9½Ñ¥” •ÍÍ¼É•Ù½…‘¼”¡¥ÍÓÍÉ¥¼ÁÉ•Í•ÉÙ…‘¼¸œ¤ì4(€€€ô4(€ô¤¤ì4(4(€‘½Õµ•¹Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¥¹ÁÕÐœ°€¡•Ù•¹Ð¤€ôøì4(€€€½¹ÍÐÁ•Éµ¥ÍÍ¥½¹M•…É €ô•Ù•¹Ð¹Ñ…É•Ð¹±½Í•ÍÐ m‘…Ñ„µÁ•Éµ¥ÍÍ¥½¸µÍ•…É¡tœ¤ì4(€€€¥˜€¡Á•Éµ¥ÍÍ¥½¹M•…É ¤ì™¥±Ñ•ÉA•Éµ¥ÍÍ¥½¹=ÁÑ¥½¹Ì¡Á•Éµ¥ÍÍ¥½¹M•…É ¤ìÉ•ÑÕÉ¸ìô4(€€€½¹ÍÐ¥¹ÁÕÐ€ô•Ù•¹Ð¹Ñ…É•Ð¹±½Í•ÍÐ m‘…Ñ„µÍ•…É¡tœ¤ì4(€€€¥˜€ …¥¹ÁÕÐ¤É•ÑÕÉ¸ì4(€€€½¹ÍÐ­•ä€ô¥¹ÁÕÐ¹‘…Ñ…Í•Ð¹Í•…É ì4(€€€¥˜€¡­•ä€ôôô€±½‰…°œ¤ÍÑ…Ñ”¹±½‰…±EÕ•Éä€ô¥¹ÁÕÐ¹Ù…±Õ”ì4(€€€•±Í”ÍÑ…Ñ”¹™¥±Ñ•ÉÍm­•åt€ô¥¹ÁÕÐ¹Ù…±Õ”ì4(€€€É•¹‘•È¡­•ä¤ì4(€ô¤ì4(4(€‘½Õµ•¹Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ¡…¹”œ°€¡•Ù•¹Ð¤€ôøÍ…™”¡…Íå¹Œ€ ¤€ôøì(€€€½¹ÍÐÁ•Éµ¥ÍÍ¥½¸€ô•Ù•¹Ð¹Ñ…É•Ð¹±½Í•ÍÐ ¥¹ÁÕÑmÑåÁ”ô‰¡•­‰½à‰um¹…µ”ô‰Á•Éµ¥ÍÍ¥½¹Ì‰tœ¤ì(€€€¥˜€¡Á•Éµ¥ÍÍ¥½¸¤ìÕÁ‘…Ñ•A•Éµ¥ÍÍ¥½¹MÕµµ…Éä¡Á•Éµ¥ÍÍ¥½¸¹±½Í•ÍÐ ™½É´œ¤¤ìÉ•ÑÕÉ¸ìô4(€€€½¹ÍÐ™¥±Ñ•È€ô•Ù•¹Ð¹Ñ…É•Ð¹±½Í•ÍÐ m‘…Ñ„µ™¥±Ñ•Étœ¤ì4(€€€¥˜€¡™¥±Ñ•È¤ìÍÑ…Ñ”¹™¥±Ñ•ÉÍm™¥±Ñ•È¹‘…Ñ…Í•Ð¹™¥±Ñ•Ét€ô™¥±Ñ•È¹Ù…±Õ”ìÉ•¹‘•È ¤ìÉ•ÑÕÉ¸ìô4(€€€½¹ÍÐÕÍÑ½µ•ÉM•±•Ð€ô•Ù•¹Ð¹Ñ…É•Ð¹±½Í•ÍÐ m‘…Ñ„µ…Ñ¥½¸ô‰Í•±•ÐµÑ•¹…¹Ð‰tœ¤ì4(€€€½¹ÍÐÍÑ½É•M•±•Ð€ô•Ù•¹Ð¹Ñ…É•Ð¹±½Í•ÍÐ m‘…Ñ„µ…Ñ¥½¸ô‰Í•±•ÐµÍÑ½É”‰tœ¤ì4(€€€¥˜€ …ÕÍÑ½µ•ÉM•±•Ð€˜˜€…ÍÑ½É•M•±•Ð¤É•ÑÕÉ¸ì4(€€€¥˜€¡ÕÍÑ½µ•ÉM•±•Ð¤ì4(€€€€€ÍÑ…Ñ”¹Í•±•Ñ•‘Q•¹…¹Ð€ôÕÍÑ½µ•ÉM•±•Ð¹Ù…±Õ”ì4(€€€€€½¹ÍÐÑ•¹…¹Ð€ôÍÑ…Ñ”¹Ñ•¹…¹ÑÌ¹™¥¹ ¡¥Ñ•´¤€ôøMÑÉ¥¹œ¡¥Ñ•´¹…½Õ¹Ñ%ñð¥Ñ•´¹¥¤€ôôôMÑÉ¥¹œ¡ÍÑ…Ñ”¹Í•±•Ñ•‘Q•¹…¹Ð¤¤ì4(€€€€€ÍÑ…Ñ”¹Í•±•Ñ•‘MÑ½É”€ôÑ•¹…¹Ðü¹ÍÑ½É•Ìü¹lÁtü¹ÍÑ½É•%ñðÑ•¹…¹Ðü¹ÍÑ½É•Ìü¹lÁtü¹¥ñð€œœì4(€€€ô4(€€€¥˜€¡ÍÑ½É•M•±•Ð¤ÍÑ…Ñ”¹Í•±•Ñ•‘MÑ½É”€ôÍÑ½É•M•±•Ð¹Ù…±Õ”ì4(€€€ÍÑ…Ñ”¹™¥±Ñ•ÉÌ¹…Ñ…±½…Ñ•½Éä€ô€…±°œì4(€€€ÍÑ…Ñ”¹±½…‘¥¹œ€ôÑÉÕ”ìÉ•¹‘•È ¤ì4(€€€…Ý…¥Ð±½…‘M•Ñ¥½¸ …Ñ…±½œœ¤ì4(€€€ÍÑ…Ñ”¹±½…‘¥¹œ€ô™…±Í”ìÉ•¹‘•È ¤ì(€ô¤¤ì((€‘½Õµ•¹Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‘É…ÍÑ…ÉÐœ°€¡•Ù•¹Ð¤€ôøì(€€€½¹ÍÐ…É€ô•Ù•¹Ð¹Ñ…É•Ð¹±½Í•ÍÐ m‘…Ñ„µÝ½É¬µ­•åum‘É……‰±”ô‰ÑÉÕ”‰tœ¤ì(€€€¥˜€ ……ÉñðÍÑ…Ñ”¹Ý½É­Y¥•Ü€ôôô€É…‘…Èœ¤É•ÑÕÉ¸ì(€€€‘É…•‘]½É­-•ä€ô…É¹‘…Ñ…Í•Ð¹Ý½É­-•äñð€œœì(€€€…É¹±…ÍÍ1¥ÍÐ¹…‘ ‘É…¥¹œœ¤ì(€€€•Ù•¹Ð¹‘…Ñ…QÉ…¹Í™•È¹•™™•Ñ±±½Ý•€ô€µ½Ù”œì(€€€•Ù•¹Ð¹‘…Ñ…QÉ…¹Í™•È¹Í•Ñ…Ñ„ Ñ•áÐ½Á±…¥¸œ°‘É…•‘]½É­-•ä¤ì(€ô¤ì((€‘½Õµ•¹Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‘É…•¹œ°€¡•Ù•¹Ð¤€ôøì(€€€•Ù•¹Ð¹Ñ…É•Ð¹±½Í•ÍÐ m‘…Ñ„µÝ½É¬µ­•åtœ¤ü¹±…ÍÍ1¥ÍÐ¹É•µ½Ù” ‘É…¥¹œœ¤ì(€€€‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° m‘…Ñ„µ‘É½Àµ±…¹•t¹‘É…œµ½Ù•Èœ¤¹™½É…  ¡±…¹”¤€ôø±…¹”¹±…ÍÍ1¥ÍÐ¹É•µ½Ù” ‘É…œµ½Ù•Èœ¤¤ì(€€€‘É…•‘]½É­-•ä€ô€œœì(€ô¤ì((€‘½Õµ•¹Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‘É…½Ù•Èœ°€¡•Ù•¹Ð¤€ôøì(€€€½¹ÍÐ±…¹”€ô•Ù•¹Ð¹Ñ…É•Ð¹±½Í•ÍÐ m‘…Ñ„µ‘É½Àµ±…¹•tœ¤ì(€€€¥˜€ …±…¹”ñð€…‘É…•‘]½É­-•äñðÍÑ…Ñ”¹Ý½É­Y¥•Ü€ôôô€É…‘…Èœ¤É•ÑÕÉ¸ì(€€€•Ù•¹Ð¹ÁÉ•Ù•¹Ñ•™…Õ±Ð ¤ì(€€€•Ù•¹Ð¹‘…Ñ…QÉ…¹Í™•È¹‘É½Á™™•Ð€ô€µ½Ù”œì(€€€‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° m‘…Ñ„µ‘É½Àµ±…¹•t¹‘É…œµ½Ù•Èœ¤¹™½É…  ¡¥Ñ•´¤€ôø¥Ñ•´€„ôô±…¹”€˜˜¥Ñ•´¹±…ÍÍ1¥ÍÐ¹É•µ½Ù” ‘É…œµ½Ù•Èœ¤¤ì(€€€±…¹”¹±…ÍÍ1¥ÍÐ¹…‘ ‘É…œµ½Ù•Èœ¤ì(€ô¤ì((€‘½Õµ•¹Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‘É…±•…Ù”œ°€¡•Ù•¹Ð¤€ôøì(€€€½¹ÍÐ±…¹”€ô•Ù•¹Ð¹Ñ…É•Ð¹±½Í•ÍÐ m‘…Ñ„µ‘É½Àµ±…¹•tœ¤ì(€€€¥˜€¡±…¹”€˜˜€…±…¹”¹½¹Ñ…¥¹Ì¡•Ù•¹Ð¹É•±…Ñ•‘Q…É•Ð¤¤±…¹”¹±…ÍÍ1¥ÍÐ¹É•µ½Ù” ‘É…œµ½Ù•Èœ¤ì(€ô¤ì((€‘½Õµ•¹Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ‘É½Àœ°€¡•Ù•¹Ð¤€ôøì(€€€½¹ÍÐ±…¹”€ô•Ù•¹Ð¹Ñ…É•Ð¹±½Í•ÍÐ m‘…Ñ„µ‘É½Àµ±…¹•tœ¤ì(€€€¥˜€ …±…¹”ñðÍÑ…Ñ”¹Ý½É­Y¥•Ü€ôôô€É…‘…Èœ¤É•ÑÕÉ¸ì(€€€•Ù•¹Ð¹ÁÉ•Ù•¹Ñ•™…Õ±Ð ¤ì(€€€½¹ÍÐ­•ä€ô‘É…•‘]½É­-•äñð•Ù•¹Ð¹‘…Ñ…QÉ…¹Í™•È¹•Ñ…Ñ„ Ñ•áÐ½Á±…¥¸œ¤ì(€€€½¹ÍÐÑ…É•ÑMÑ…ÑÕÌ€ôÝ½É­1…¹•Q…É•Ð¡ÍÑ…Ñ”¹Ý½É­Y¥•Ü°±…¹”¹‘…Ñ…Í•Ð¹‘É½Á1…¹”¤ì(€€€‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½É±° m‘…Ñ„µ‘É½Àµ±…¹•t¹‘É…œµ½Ù•Èœ¤¹™½É…  ¡¥Ñ•´¤€ôø¥Ñ•´¹±…ÍÍ1¥ÍÐ¹É•µ½Ù” ‘É…œµ½Ù•Èœ¤¤ì(€€€‘É…•‘]½É­-•ä€ô€œœì(€€€¥˜€ …­•äñð€…Ñ…É•ÑMÑ…ÑÕÌ¤É•ÑÕÉ¸ì(€€€ÍÑ…Ñ”¹µ½‘…°€ôìÑåÁ”è€Ý½É¬µ¥Ñ•´œ°­•ä°Ñ…É•ÑMÑ…ÑÕÌôì(€€€É•¹‘•È ¤ì(€ô¤ì((€‘½Õµ•¹Ð¹…‘‘Ù•¹Ñ1¥ÍÑ•¹•È ­•å‘½Ý¸œ°€¡•Ù•¹Ð¤€ôøì(€€€¥˜€ ¡•Ù•¹Ð¹ÑÉ±-•äñð•Ù•¹Ð¹µ•Ñ…-•ä¤€˜˜•Ù•¹Ð¹­•ä¹Ñ½1½Ý•É…Í” ¤€ôôô€¬œ¤ì4(€€€€€•Ù•¹Ð¹ÁÉ•Ù•¹Ñ•™…Õ±Ð ¤ì4(€€€€€‘½Õµ•¹Ð¹ÅÕ•ÉåM•±•Ñ½È m‘…Ñ„µÍ•…É ô‰±½‰…°‰tœ¤ü¹™½ÕÌ ¤ì4(€€€ô4(€€€¥˜€¡•Ù•¹Ð¹­•ä€ôôô€Í…Á”œ¤ì4(€€€€€ÍÑ…Ñ”¹µ½‘…°€ô¹Õ±°ì4(€€€€€ÍÑ…Ñ”¹Í¥‘•‰…É=Á•¸€ô™…±Í”ì4(€€€€€ÍÑ…Ñ”¹±½‰…±EÕ•Éä€ô€œœì4(€€€€€É•¹‘•È ¤ì4(€€€ô4(€€€¥˜€ ¡•Ù•¹Ð¹ÑÉ±-•äñð•Ù•¹Ð¹µ•Ñ…-•ä¤€˜˜•Ù•¹Ð¹­•ä€ôôô€¹Ñ•Èœ¤ì4(€€€€€½¹ÍÐ™½É´€ô•Ù•¹Ð¹Ñ…É•Ð¹±½Í•ÍÐ ™½Éµm‘…Ñ„µ™½É´ô‰É•Á±ä‰tœ¤ì4(€€€€€¥˜€¡™½É´¤ì4(€€€€€€€•Ù•¹Ð¹ÁÉ•Ù•¹Ñ•™…Õ±Ð ¤ì4(€€€€€€€™½É´¹É•ÅÕ•ÍÑMÕ‰µ¥Ð ¤ì4(€€€€€ô4(€€€ô4(€ô¤ì4(4(€…Íå¹Œ™Õ¹Ñ¥½¸‰½½Ð ¤ì4(€€€É•¹‘•È ¤ì4(€€€¥˜€¡ÍÑ…Ñ”¹¥¹Ù¥Ñ•5½‘”¤É•ÑÕÉ¸ì4(€€€¥˜€ …½¹™¥ÕÉ• ¤ñð€…ÍÑ…Ñ”¹Ñ½­•¸¤É•ÑÕÉ¸ì4(€€€ÑÉäì4(€€€€€ÍÑ…Ñ”¹ÕÍ•È€ô€¡…Ý…¥Ð…Á¤ œ½…Á¤½…‘µ¥¸½Í•ÍÍ¥½¸œ¤¤¹‘…Ñ„ì4(€€€€€¥˜€¡…Ý…¥ÐÁÉ•Á…É•5™„ ¤¤É•ÑÕÉ¸ì4(€€€€€…Ý…¥Ð±½…‘½É” ¤ì4(€€€ô…Ñ ì4(€€€€€…Ý…¥ÐÍ¥¹=ÕÐ ¤ì4(€€€€€Í¡½Ý9½Ñ¥” MÕ„Í•ÍÏ¼•áÁ¥É½Ô¸¹ÑÉ”¹½Ù…µ•¹Ñ”¸œ°€•ÉÉ½Èœ¤ì4(€€€ô4(€ô4(4(€‰½½Ð ¤ì4)ô¤ ¤ì4(