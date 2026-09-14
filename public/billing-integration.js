(() => {
  'use strict';

  const TOKEN_KEY = 'koregastro_admin_token';
  let applying = false;
  let lastLoad = 0;
  let cached = null;

  const token = () => sessionStorage.getItem(TOKEN_KEY) || '';
  const onPlans = () => /^#\/planos(?:\?|$)/.test(window.location.hash);

  async function request(method = 'GET', body) {
    const authorization = token();
    if (!authorization) throw new Error('Sessão administrativa ausente.');
    const response = await fetch('/api/admin/mercadopago', {
      method,
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${authorization}`,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error || 'Falha ao consultar o Mercado Pago.');
    return payload;
  }

  function tone(status) {
    if (status === 'ok') return 'ready';
    if (status === 'warning') return 'warning';
    return 'warning';
  }

  function summarize(data) {
    const connection = data?.connection || {};
    const plans = Array.isArray(data?.plans) ? data.plans : [];
    const recurring = plans.filter((plan) => plan.recurring !== false && Number(plan.price || 0) > 0);
    const invalid = recurring.filter((plan) => !plan.provider?.valid);
    if (!connection.connected) {
      return {
        status: 'error',
        title: 'Mercado Pago desconectado',
        message: connection.error || 'A credencial do Mercado Pago não pôde ser validada.',
        invalid: recurring.length,
        canSync: false
      };
    }
    if (invalid.length) {
      return {
        status: 'warning',
        title: `${invalid.length} plano(s) precisam de sincronização`,
        message: 'O ChefOS cria ou corrige automaticamente os planos recorrentes no Mercado Pago. Não é necessário copiar IDs manualmente.',
        invalid: invalid.length,
        canSync: true
      };
    }
    if (!connection.webhookSecretConfigured) {
      return {
        status: 'warning',
        title: 'Cobrança conectada; proteção de webhook pendente',
        message: 'Planos recorrentes estão sincronizados. Configure o segredo HMAC do webhook para completar o hardening.',
        invalid: 0,
        canSync: false
      };
    }
    return {
      status: 'ok',
      title: 'Mercado Pago sincronizado',
      message: 'Conexão, planos recorrentes e vínculo de cobrança estão válidos.',
      invalid: 0,
      canSync: false
    };
  }

  function render(data, error = null) {
    if (!onPlans()) return;
    const page = document.querySelector('.page');
    if (!page) return;

    const oldWarning = [...page.querySelectorAll('.integration-warning')]
      .find((node) => /vínculo de cobrança|recorrência pendente|Mercado Pago/i.test(node.textContent || ''));
    if (oldWarning) oldWarning.hidden = true;

    let host = document.querySelector('[data-chefos-billing-status]');
    if (!host) {
      host = document.createElement('div');
      host.dataset.chefosBillingStatus = 'true';
      host.className = 'integration-warning';
      const header = page.querySelector('.page-header, header');
      if (header?.parentElement === page) header.insertAdjacentElement('afterend', host);
      else page.prepend(host);
    }

    if (error) {
      host.innerHTML = `<span>!</span><div><strong>Não foi possível validar o Mercado Pago</strong><p>${escapeHtml(error.message || String(error))}</p></div><button class="row-action" type="button" data-mp-action="retry">Tentar novamente</button>`;
      return;
    }

    const summary = summarize(data);
    host.classList.toggle('billing-ok', summary.status === 'ok');
    const connection = data?.connection || {};
    host.innerHTML = `<span>${summary.status === 'ok' ? '✓' : '!'}</span><div><strong>${escapeHtml(summary.title)}</strong><p>${escapeHtml(summary.message)}</p><small>Access Token: ${connection.accessTokenConfigured ? 'configurado' : 'ausente'} · Webhook HMAC: ${connection.webhookSecretConfigured ? 'configurado' : 'pendente'}</small></div>${summary.canSync ? '<button class="primary" type="button" data-mp-action="sync">Sincronizar Mercado Pago</button>' : '<button class="row-action" type="button" data-mp-action="retry">Verificar agora</button>'}`;
  }

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  }

  async function load(force = false) {
    if (!onPlans() || applying) return;
    const now = Date.now();
    if (!force && cached && now - lastLoad < 15000) {
      render(cached);
      return;
    }
    applying = true;
    try {
      cached = await request('GET');
      lastLoad = Date.now();
      render(cached);
    } catch (error) {
      render(null, error);
    } finally {
      applying = false;
    }
  }

  async function syncAll(button) {
    if (applying) return;
    applying = true;
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Sincronizando…';
    try {
      await request('POST', { action: 'sync_all_plans' });
      cached = null;
      lastLoad = 0;
      button.textContent = 'Sincronizado ✓';
      setTimeout(() => window.location.reload(), 600);
    } catch (error) {
      button.disabled = false;
      button.textContent = original;
      render(null, error);
    } finally {
      applying = false;
    }
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-mp-action]');
    if (!button) return;
    const action = button.dataset.mpAction;
    if (action === 'retry') load(true);
    if (action === 'sync') syncAll(button);
  });

  window.addEventListener('hashchange', () => setTimeout(() => load(true), 50));

  const observer = new MutationObserver(() => {
    if (onPlans() && !document.querySelector('[data-chefos-billing-status]')) load();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => load(true), 100);
})();
