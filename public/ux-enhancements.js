(() => {
  'use strict';

  const SIDEBAR_KEY = 'chefos_admin_sidebar_collapsed';
  const QUICK_START_KEY = 'chefos_admin_quick_start_dismissed';
  const DEFAULT_PAGE_SIZE = 25;
  const PAGE_SIZE_OPTIONS = [25, 50, 100];
  const desktopMedia = window.matchMedia('(min-width: 1181px)');
  const pageState = new Map();
  let scheduled = false;

  const GUIDES = {
    inicio: {
      title: 'Comece pelo que precisa de atenção',
      text: 'Use o início como radar. Os cartões e alertas levam você direto para clientes, assinaturas e suporte que precisam de ação.',
      steps: ['Veja os alertas', 'Abra o item que precisa de ação', 'Volte ao início para conferir o restante']
    },
    'minha-fila': {
      title: 'Sua lista pessoal de trabalho',
      text: 'Aqui aparecem somente os itens atribuídos a você. Comece pelos maiores índices de atenção e pelos prazos mais próximos.',
      steps: ['Priorize os itens críticos', 'Abra o card para registrar a próxima ação', 'Conclua ou defina um novo prazo']
    },
    kanban: {
      title: 'Quadro visual de trabalho',
      text: 'Organize suporte e programa beta por etapa. Arraste cards quando a mudança de fase for permitida ou abra o card para registrar contexto.',
      steps: ['Escolha a visão do quadro', 'Filtre pelo responsável', 'Mova o card e registre a decisão']
    },
    clientes: {
      title: 'Onde consultar um cliente',
      text: 'Pesquise pelo nome, e-mail ou loja. A Visão 360º reúne onboarding, assinatura, suporte e operações vinculadas.',
      steps: ['Pesquise o cliente', 'Abra Visão 360º', 'Resolva as pendências indicadas']
    },
    suporte: {
      title: 'Atendimento em duas etapas',
      text: 'Escolha um chamado na fila à esquerda e trabalhe a conversa à direita. Prioridade e SLA mostram o que deve ser atendido primeiro.',
      steps: ['Escolha o chamado', 'Leia o histórico', 'Responda e atualize o status']
    },
    beta: {
      title: 'Acompanhe cada candidato até a ativação',
      text: 'A lista mostra a etapa atual e quem precisa de atenção. Abra a ficha para registrar conversas, decisões e movimentações.',
      steps: ['Filtre a etapa', 'Abra a ficha', 'Registre a próxima movimentação']
    },
    assinaturas: {
      title: 'Acesso comercial do cliente',
      text: 'Use esta área para conferir plano, status e período de acesso. Mudanças aqui afetam o acesso interno e ficam registradas na auditoria.',
      steps: ['Localize o cliente', 'Confira saúde do acesso', 'Gerencie somente quando houver motivo claro']
    },
    planos: {
      title: 'Catálogo comercial do ChefOS',
      text: 'Crie ofertas, promoções e planos especiais sem alterar as permissões internas das pessoas. Os módulos selecionados pertencem ao plano.',
      steps: ['Confira os planos existentes', 'Duplique quando quiser partir de uma oferta atual', 'Revise módulos antes de publicar']
    },
    cardapios: {
      title: 'Sempre confirme cliente e operação',
      text: 'Antes de editar um item, confira os seletores de cliente e operação no topo. Toda alteração é aplicada à loja selecionada.',
      steps: ['Escolha o cliente', 'Escolha a operação', 'Pesquise ou edite o item']
    },
    equipe: {
      title: 'Acessos do Control Center',
      text: 'Esta equipe administra o painel central do ChefOS. Ela não representa os funcionários operacionais de cada restaurante.',
      steps: ['Confira função e status', 'Exija MFA para perfis privilegiados', 'Registre o motivo de cada alteração']
    },
    auditoria: {
      title: 'Use quando precisar responder “quem fez isso?”',
      text: 'Filtre por período, ator ou resultado para encontrar alterações administrativas e comparar o estado antes e depois.',
      steps: ['Defina o período', 'Filtre o evento', 'Abra os detalhes para investigar']
    },
    saude: {
      title: 'Diagnóstico técnico e operacional',
      text: 'Esta área reúne banco, autenticação, assinatura, integrações e segurança. Comece pelos itens degradados ou em atenção.',
      steps: ['Execute o diagnóstico', 'Abra o item com alerta', 'Use a ação de investigar quando disponível']
    },
    'novo-cliente': {
      title: 'Onboarding em uma única sequência',
      text: 'Preencha acesso, operação e plano. O painel cria a estrutura necessária e mostra as credenciais somente ao final.',
      steps: ['Crie o acesso', 'Configure a operação', 'Escolha o plano e confirme']
    }
  };

  function currentRoute() {
    return window.location.hash.match(/^#\/([^?]+)/)?.[1] || 'inicio';
  }

  function resetRoutePages(route = currentRoute()) {
    for (const key of pageState.keys()) if (key.startsWith(`${route}:`)) pageState.delete(key);
  }

  function ensureSidebar() {
    const shell = document.querySelector('.app-shell');
    const sidebar = document.querySelector('.sidebar');
    const brand = sidebar?.querySelector('.brand');
    if (!shell || !sidebar || !brand) return;

    let toggle = brand.querySelector('[data-ux-action="toggle-sidebar-collapse"]');
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'icon-button ux-sidebar-toggle';
      toggle.dataset.uxAction = 'toggle-sidebar-collapse';
      brand.insertBefore(toggle, brand.querySelector('.sidebar-close'));
    }

    const collapsed = desktopMedia.matches && localStorage.getItem(SIDEBAR_KEY) === 'true';
    shell.classList.toggle('ux-sidebar-collapsed', collapsed);
    sidebar.classList.toggle('ux-sidebar-collapsed', collapsed);
    toggle.textContent = collapsed ? '›' : '‹';
    toggle.setAttribute('aria-label', collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral');
    toggle.title = collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral';

    sidebar.querySelectorAll('.nav-item').forEach((item) => {
      const label = item.querySelector(':scope > span:nth-child(2)')?.textContent?.trim();
      if (label) {
        item.title = label;
        item.setAttribute('aria-label', label);
      }
    });

    const nav = sidebar.querySelector('nav');
    if (nav && !nav.querySelector('[data-ux-action="show-help"]')) {
      const help = document.createElement('button');
      help.type = 'button';
      help.className = 'ux-help-link';
      help.dataset.uxAction = 'show-help';
      help.innerHTML = '<span aria-hidden="true">?</span><strong>Como usar o painel</strong>';
      nav.appendChild(help);
    }
  }

  function contextGuide() {
    const page = document.querySelector('.content .page');
    const header = page?.querySelector(':scope > .page-header');
    if (!page || !header || page.querySelector(':scope > .ux-context-guide')) return;
    const guide = GUIDES[currentRoute()];
    if (!guide) return;

    const block = document.createElement('section');
    block.className = 'ux-context-guide';
    block.dataset.uxOwned = 'true';
    block.innerHTML = `<div class="ux-guide-icon" aria-hidden="true">i</div><div><strong>${guide.title}</strong><p>${guide.text}</p><div class="ux-guide-steps">${guide.steps.map((step, index) => `<span><b>${index + 1}</b>${step}</span>`).join('')}</div></div>`;
    header.insertAdjacentElement('afterend', block);
  }

  function quickStart() {
    if (currentRoute() !== 'inicio' || localStorage.getItem(QUICK_START_KEY) === 'true') return;
    const page = document.querySelector('.overview-page');
    if (!page || page.querySelector('.ux-quick-start')) return;
    const guide = page.querySelector('.ux-context-guide');
    if (!guide) return;

    const block = document.createElement('section');
    block.className = 'ux-quick-start panel';
    block.dataset.uxOwned = 'true';
    block.innerHTML = `<header><div><p class="eyebrow">PRIMEIROS PASSOS</p><h2>O painel em quatro ações</h2><p>Você não precisa conhecer toda a estrutura para começar. Estes são os caminhos usados no dia a dia.</p></div><button type="button" class="icon-button" data-ux-action="dismiss-quick-start" aria-label="Ocultar primeiros passos">×</button></header><div class="ux-quick-actions"><button data-action="open-provision"><b>1</b><span><strong>Cadastrar cliente</strong><small>Conta, loja e plano em um fluxo</small></span></button><button data-action="section" data-section="tenants"><b>2</b><span><strong>Consultar cliente</strong><small>Abra a visão completa da operação</small></span></button><button data-action="section" data-section="subscriptions"><b>3</b><span><strong>Revisar acesso</strong><small>Plano, status e vencimento</small></span></button><button data-action="section" data-section="support"><b>4</b><span><strong>Atender suporte</strong><small>Fila, conversa e resolução</small></span></button></div>`;
    guide.insertAdjacentElement('afterend', block);
  }

  function tableRows(table) {
    return [...(table.tBodies?.[0]?.rows || [])].filter((row) => !row.querySelector('td.empty'));
  }

  function pagerKey(route, index) {
    return `${route}:table:${index}`;
  }

  function renderPager(wrapper, table, key, index) {
    const rows = tableRows(table);
    const previous = pageState.get(key) || { page: 1, size: DEFAULT_PAGE_SIZE };
    const size = PAGE_SIZE_OPTIONS.includes(previous.size) ? previous.size : DEFAULT_PAGE_SIZE;
    const pages = Math.max(1, Math.ceil(rows.length / size));
    const page = Math.min(Math.max(1, previous.page), pages);
    pageState.set(key, { page, size });

    rows.forEach((row, rowIndex) => {
      const visible = rowIndex >= (page - 1) * size && rowIndex < page * size;
      if (row.hidden === visible) row.hidden = !visible;
    });

    const existing = wrapper.parentElement?.querySelector(`:scope > .ux-table-pagination[data-ux-key="${CSS.escape(key)}"]`);
    if (rows.length <= size && !existing) return;

    const start = rows.length ? ((page - 1) * size) + 1 : 0;
    const end = Math.min(page * size, rows.length);
    const pager = existing || document.createElement('div');
    pager.className = 'ux-table-pagination';
    pager.dataset.uxOwned = 'true';
    pager.dataset.uxKey = key;
    pager.innerHTML = `<span>Mostrando <strong>${start}–${end}</strong> de <strong>${rows.length}</strong></span><div><label>Linhas <select data-ux-page-size="${key}" aria-label="Linhas por página">${PAGE_SIZE_OPTIONS.map((option) => `<option value="${option}" ${option === size ? 'selected' : ''}>${option}</option>`).join('')}</select></label><button type="button" class="secondary" data-ux-page="prev" data-ux-key="${key}" ${page <= 1 ? 'disabled' : ''}>← Anterior</button><span class="ux-page-number">${page} / ${pages}</span><button type="button" class="secondary" data-ux-page="next" data-ux-key="${key}" ${page >= pages ? 'disabled' : ''}>Próxima →</button></div>`;
    if (!existing) wrapper.insertAdjacentElement('afterend', pager);
    pager.dataset.uxTableIndex = String(index);
  }

  function enhanceTables() {
    const route = currentRoute();
    const wrappers = [...document.querySelectorAll('.content .table-wrap')];
    wrappers.forEach((wrapper, index) => {
      const table = wrapper.querySelector('table');
      if (!table) return;
      wrapper.classList.add('ux-scroll-region');
      wrapper.tabIndex = 0;
      if (!wrapper.getAttribute('aria-label')) wrapper.setAttribute('aria-label', 'Tabela. Use rolagem horizontal quando houver mais colunas.');

      const overflow = wrapper.scrollWidth > wrapper.clientWidth + 4;
      wrapper.classList.toggle('has-horizontal-scroll', overflow);
      const existingHint = wrapper.parentElement?.querySelector(`:scope > .ux-scroll-hint[data-ux-table="${index}"]`);
      if (overflow && !existingHint) {
        const hint = document.createElement('div');
        hint.className = 'ux-scroll-hint';
        hint.dataset.uxOwned = 'true';
        hint.dataset.uxTable = String(index);
        hint.textContent = '↔ Role horizontalmente para ver todas as colunas.';
        wrapper.insertAdjacentElement('afterend', hint);
      } else if (!overflow && existingHint) existingHint.remove();

      if (route !== 'auditoria') renderPager(wrapper, table, pagerKey(route, index), index);
    });

    document.querySelectorAll('.kanban-board').forEach((board) => {
      board.classList.add('ux-horizontal-region');
      board.tabIndex = 0;
      if (!board.getAttribute('aria-label')) board.setAttribute('aria-label', 'Quadro com rolagem horizontal entre colunas.');
    });
  }

  function enhanceModal() {
    const dialog = document.querySelector('.modal-shell[role="dialog"]');
    if (!dialog) return;
    dialog.querySelector('.modal-body')?.setAttribute('tabindex', '0');
    dialog.querySelector('.detail-drawer')?.setAttribute('tabindex', '0');
  }

  function enhance() {
    ensureSidebar();
    contextGuide();
    quickStart();
    enhanceTables();
    enhanceModal();
  }

  function scheduleEnhance() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      enhance();
    });
  }

  document.addEventListener('click', (event) => {
    const action = event.target.closest('[data-ux-action]')?.dataset.uxAction;
    if (action === 'toggle-sidebar-collapse') {
      const next = localStorage.getItem(SIDEBAR_KEY) !== 'true';
      localStorage.setItem(SIDEBAR_KEY, String(next));
      ensureSidebar();
      return;
    }
    if (action === 'dismiss-quick-start') {
      localStorage.setItem(QUICK_START_KEY, 'true');
      event.target.closest('.ux-quick-start')?.remove();
      return;
    }
    if (action === 'show-help') {
      localStorage.removeItem(QUICK_START_KEY);
      const overview = document.querySelector('[data-action="section"][data-section="overview"]');
      if (overview && currentRoute() !== 'inicio') overview.click();
      else scheduleEnhance();
      return;
    }

    const pager = event.target.closest('[data-ux-page]');
    if (pager) {
      const key = pager.dataset.uxKey;
      const state = pageState.get(key) || { page: 1, size: DEFAULT_PAGE_SIZE };
      state.page += pager.dataset.uxPage === 'next' ? 1 : -1;
      pageState.set(key, state);
      scheduleEnhance();
      document.querySelector(`.ux-table-pagination[data-ux-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  }, true);

  document.addEventListener('change', (event) => {
    const pageSize = event.target.closest('[data-ux-page-size]');
    if (pageSize) {
      pageState.set(pageSize.dataset.uxPageSize, { page: 1, size: Number(pageSize.value) || DEFAULT_PAGE_SIZE });
      scheduleEnhance();
      return;
    }
    if (event.target.matches('[data-filter]')) {
      resetRoutePages();
      scheduleEnhance();
    }
  }, true);

  document.addEventListener('input', (event) => {
    if (event.target.matches('[data-search]:not([data-search="global"])')) resetRoutePages();
  }, true);

  desktopMedia.addEventListener?.('change', scheduleEnhance);
  window.addEventListener('resize', scheduleEnhance, { passive: true });
  window.addEventListener('hashchange', () => {
    resetRoutePages();
    scheduleEnhance();
  });

  new MutationObserver(scheduleEnhance).observe(document.querySelector('#app') || document.body, { childList: true, subtree: true });
  scheduleEnhance();
})();
