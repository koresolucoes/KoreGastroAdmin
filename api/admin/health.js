import {
  auditAdminAction,
  fail,
  hasCapability,
  isSchemaCompatibilityError,
  requireAdmin,
  reply,
  supabase,
  supabaseAuthAdmin
} from '../_lib/admin.js';
import { ENTITLED_SUBSCRIPTION_STATUSES, isSubscriptionEntitled } from '../_lib/subscription-entitlements.js';
import { portalBilling } from '../_lib/portal-billing.js';

async function probe(name, operation) {
  const startedAt = Date.now();
  try {
    const result = await operation();
    return { name, ok: true, data: result?.data ?? result, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { name, ok: false, data: null, latencyMs: Date.now() - startedAt, schemaMissing: isSchemaCompatibilityError(error), error };
  }
}

function check(id, label, group, status, message, extra = {}) {
  return { id, label, group, status, message, ...extra };
}

function authUsers(data) {
  if (Array.isArray(data)) return data;
  return data?.users || [];
}

function errorMessage(probeResult, fallback) {
  return probeResult.schemaMissing ? 'Recurso ainda não disponível no schema atual.' : fallback;
}

function calculateOverall(checks) {
  if (checks.some((item) => item.group === 'core' && item.status === 'critical')) return 'critical';
  if (checks.some((item) => ['critical', 'degraded'].includes(item.status))) return 'degraded';
  if (checks.some((item) => ['attention', 'unknown'].includes(item.status))) return 'attention';
  return checks.length ? 'healthy' : 'unknown';
}

async function optionalRows(path) {
  try { return (await supabase(path)).data || []; } catch (error) {
    if (isSchemaCompatibilityError(error)) return [];
    throw error;
  }
}

export default async function handler(req, res) {
  const context = await requireAdmin(req, res, 'GET, POST, OPTIONS');
  if (!context) return;
  if (!['GET', 'POST'].includes(req.method)) return reply(res, 405, { error: 'Método não permitido.' });
  const startedAt = Date.now();
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
    const probes = await Promise.all([
      probe('database', () => supabase('/rest/v1/plans?select=id&limit=1')),
      probe('auth', () => supabaseAuthAdmin('/admin/users?page=1&per_page=1000')),
      probe('subscriptions', () => supabase('/rest/v1/subscriptions?select=id,user_id,store_id,plan_id,status,current_period_end,mercado_pago_subscription_id,payment_method_id,updated_at&limit=1000')),
      probe('memberships', () => supabase('/rest/v1/store_memberships?select=id,store_id,account_id,access_level,status,accepted_at,revoked_at&limit=5000')),
      probe('stores', () => supabase('/rest/v1/stores?select=id,owner_id&limit=5000')),
      probe('invoices', () => supabase(`/rest/v1/subscription_invoices?select=id,status,mp_payment_id,mp_preapproval_id,created_at&created_at=gte.${encodeURIComponent(sevenDaysAgo)}&limit=1000`)),
      probe('plans', () => supabase('/rest/v1/plans?select=id,name,price,recurring,preapproval_plan_id&limit=1000')),
      probe('mercadopago', () => portalBilling(req)),
      probe('ifood', () => supabase(`/rest/v1/ifood_webhook_logs?select=id,processing_status,error_message,created_at&created_at=gte.${encodeURIComponent(oneDayAgo)}&limit=1000`)),
      probe('support', () => supabase('/rest/v1/support_tickets?select=id,status,priority,created_at,updated_at&status=in.(open,in_progress)&limit=1000')),
      probe('admins', async () => {
        try {
          return await supabase('/rest/v1/system_admins?select=email,role,status,mfa_required,last_seen_at&limit=1000');
        } catch (error) {
          if (!isSchemaCompatibilityError(error)) throw error;
          const legacy = await supabase('/rest/v1/system_admins?select=email,created_at&limit=1000');
          return { ...legacy, data: (legacy.data || []).map((item) => ({ ...item, role: 'platform_admin', status: 'active', mfa_required: false, legacy: true })) };
        }
      })
    ]);
    const byName = Object.fromEntries(probes.map((item) => [item.name, item]));
    const checks = [];

    checks.push(check(
      'database', 'Banco de dados', 'core',
      !byName.database.ok ? 'critical' : byName.database.latencyMs > 1200 ? 'degraded' : 'ok',
      !byName.database.ok ? 'O banco não respondeu à verificação administrativa.' : byName.database.latencyMs > 1200 ? 'Banco operacional, porém com latência elevada.' : 'Banco operacional.',
      { latencyMs: byName.database.latencyMs }
    ));
    checks.push(check(
      'auth', 'Autenticação', 'core',
      !byName.auth.ok ? 'critical' : byName.auth.latencyMs > 1200 ? 'degraded' : 'ok',
      !byName.auth.ok ? 'O serviço de autenticação não respondeu.' : 'Supabase Auth operacional.',
      { latencyMs: byName.auth.latencyMs }
    ));

    const requiredEnvironment = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY'];
    const recommendedEnvironment = ['ADMIN_APP_URL', 'ROOT_ADMIN_EMAILS'];
    const missingRequired = requiredEnvironment.filter((name) => !process.env[name]);
    const missingRecommended = recommendedEnvironment.filter((name) => !process.env[name]);
    const canSeeConfiguration = hasCapability(context, 'access.root');
    checks.push(check(
      'environment', 'Configuração administrativa', 'core',
      missingRequired.length ? 'critical' : missingRecommended.length ? 'attention' : 'ok',
      missingRequired.length
        ? `${missingRequired.length} configuração(ões) obrigatória(s) ausente(s).`
        : missingRecommended.length ? `${missingRecommended.length} configuração(ões) recomendada(s) pendente(s).` : 'Configuração principal presente.',
      { details: canSeeConfiguration ? { missingRequired, missingRecommended } : undefined }
    ));

    const subscriptions = byName.subscriptions.data || [];
    const plans = byName.plans.data || [];
    const plansById = new Map(plans.map((item) => [String(item.id), item]));
    const expiredRows = subscriptions.filter((item) => ENTITLED_SUBSCRIPTION_STATUSES.includes(item.status) && !isSubscriptionEntitled(item));
    const providerExpiredRows = expiredRows.filter((item) => item.mercado_pago_subscription_id && plansById.get(String(item.plan_id))?.recurring !== false);
    const legacyExpiredRows = expiredRows.filter((item) => !providerExpiredRows.includes(item));
    const expiredAccess = expiredRows.length;
    const providerExpiredAccess = providerExpiredRows.length;
    const legacyExpiredAccess = legacyExpiredRows.length;
    const pastDueWithAccess = subscriptions.filter((item) => item.status === 'past_due' && isSubscriptionEntitled(item)).length;
    const expiredStatus = !byName.subscriptions.ok ? 'unknown' : providerExpiredAccess ? 'degraded' : legacyExpiredAccess ? 'attention' : 'ok';
    const expiredMessage = !byName.subscriptions.ok
      ? errorMessage(byName.subscriptions, 'Não foi possível consultar assinaturas.')
      : providerExpiredAccess
        ? `${providerExpiredAccess} assinatura(s) recorrente(s) gerenciada(s) pelo Mercado Pago estão vencidas e sem entitlement.`
        : legacyExpiredAccess
          ? `${legacyExpiredAccess} registro(s) legado(s)/manual(is) estão vencidos e sem entitlement; não representam falha ativa do Mercado Pago.`
          : 'Nenhum acesso elegível está com período vencido.';
    checks.push(check(
      'expired_access', 'Acessos vencidos', 'business',
      expiredStatus,
      expiredMessage,
      {
        value: expiredAccess,
        providerManaged: providerExpiredAccess,
        legacyOrManual: legacyExpiredAccess,
        entitlementStatuses: ENTITLED_SUBSCRIPTION_STATUSES,
        action: expiredAccess ? { section: 'subscriptions' } : null
      }
    ));
    checks.push(check(
      'past_due_access', 'Past due com acesso', 'business',
      !byName.subscriptions.ok ? 'unknown' : pastDueWithAccess ? 'attention' : 'ok',
      !byName.subscriptions.ok ? errorMessage(byName.subscriptions, 'Não foi possível consultar assinaturas.') : pastDueWithAccess ? `${pastDueWithAccess} assinatura(s) past_due permanecem com acesso conforme a política canônica do ChefOS.` : 'Nenhuma assinatura past_due com acesso ativo.',
      { value: pastDueWithAccess, action: pastDueWithAccess ? { section: 'subscriptions', filter: 'past_due' } : null }
    ));

    const invoices = byName.invoices.data || [];
    const failureStatuses = new Set(['rejected', 'failed', 'cancelled', 'canceled', 'refunded', 'charged_back', 'unpaid']);
    const failedInvoices = invoices.filter((item) => failureStatuses.has(String(item.status || '').toLowerCase())).length;
    checks.push(check(
      'failed_invoices', 'Cobranças com falha', 'business',
      !byName.invoices.ok ? 'unknown' : failedInvoices >= 5 ? 'degraded' : failedInvoices ? 'attention' : 'ok',
      !byName.invoices.ok ? errorMessage(byName.invoices, 'Não foi possível consultar faturas.') : failedInvoices ? `${failedInvoices} cobrança(s) falharam nos últimos 7 dias.` : 'Sem falhas de cobrança nos últimos 7 dias.',
      { value: failedInvoices }
    ));

    const mpConnection = byName.mercadopago.ok ? byName.mercadopago.data?.connection : null;
    const mpPlanStates = byName.mercadopago.ok ? (byName.mercadopago.data?.plans || []) : [];
    const mpConnected = Boolean(mpConnection?.connected);
    const mpWebhookProtected = Boolean(mpConnection?.webhookSecretConfigured);
    const mpConnectionStatus = !byName.mercadopago.ok || !mpConnected ? 'degraded' : !mpWebhookProtected ? 'attention' : 'ok';
    const mpConnectionMessage = !byName.mercadopago.ok
      ? 'O Control Center não conseguiu consultar a integração de cobrança do ChefOS Portal.'
      : !mpConnected
        ? `Mercado Pago indisponível: ${mpConnection?.error || 'conexão ou credencial inválida.'}`
        : !mpWebhookProtected
          ? 'Mercado Pago conectado, mas a assinatura HMAC dos webhooks ainda não está configurada.'
          : 'Mercado Pago conectado e webhook protegido por assinatura HMAC.';
    checks.push(check(
      'mercadopago_connection', 'Mercado Pago', 'business',
      mpConnectionStatus,
      mpConnectionMessage,
      {
        latencyMs: byName.mercadopago.latencyMs,
        details: canSeeConfiguration ? {
          accessTokenConfigured: Boolean(mpConnection?.accessTokenConfigured),
          webhookSecretConfigured: mpWebhookProtected,
          remotePlanCount: mpConnection?.remotePlanCount ?? null
        } : undefined,
        action: mpConnectionStatus !== 'ok' ? { section: 'plans' } : null
      }
    ));

    const localPaymentGaps = plans.filter((item) => item.recurring !== false && Number(item.price || 0) > 0 && !item.preapproval_plan_id).length;
    const invalidRemotePlans = mpPlanStates.filter((item) => item.recurring !== false && Number(item.price || 0) > 0 && !item.provider?.valid).length;
    const paymentGaps = mpConnected ? Math.max(localPaymentGaps, invalidRemotePlans) : localPaymentGaps;
    const paymentConfigurationStatus = !byName.plans.ok || !byName.mercadopago.ok ? 'unknown' : !mpConnected ? 'degraded' : paymentGaps ? 'attention' : 'ok';
    const paymentConfigurationMessage = !byName.plans.ok
      ? errorMessage(byName.plans, 'Não foi possível consultar planos.')
      : !byName.mercadopago.ok
        ? 'Não foi possível validar os planos contra o Mercado Pago.'
        : !mpConnected
          ? 'Os planos não podem ser validados porque o Mercado Pago está desconectado.'
          : paymentGaps
            ? `${paymentGaps} plano(s) recorrente(s) precisam ser criados, religados ou sincronizados com o Mercado Pago.`
            : 'Todos os planos recorrentes pagos possuem vínculo válido e preço sincronizado no Mercado Pago.';
    checks.push(check(
      'payment_configuration', 'Configuração de pagamentos', 'business',
      paymentConfigurationStatus,
      paymentConfigurationMessage,
      {
        value: paymentGaps,
        localMissingLinks: localPaymentGaps,
        invalidRemotePlans,
        action: paymentGaps ? { section: 'plans' } : null
      }
    ));

    const stores = byName.stores.data || [];
    const memberships = byName.memberships.data || [];
    const membershipKey = new Set(memberships
      .filter((item) => item.access_level === 'OWNER' && item.status === 'ACTIVE' && item.accepted_at && !item.revoked_at)
      .map((item) => `${item.store_id}:${item.account_id}`));
    const missingOwnerMemberships = stores.filter((store) => !membershipKey.has(`${store.id}:${store.owner_id}`)).length;
    checks.push(check(
      'owner_memberships', 'OWNER memberships', 'security',
      !byName.memberships.ok || !byName.stores.ok ? 'unknown' : missingOwnerMemberships ? 'degraded' : 'ok',
      !byName.memberships.ok || !byName.stores.ok ? 'Não foi possível validar memberships das lojas.' : missingOwnerMemberships ? `${missingOwnerMemberships} loja(s) não possuem OWNER membership canônico íntegro.` : 'Todas as lojas possuem OWNER membership canônico íntegro.',
      { value: missingOwnerMemberships, action: missingOwnerMemberships ? { section: 'customers' } : null }
    ));

    const ifoodRows = byName.ifood.data || [];
    const ifoodErrors = ifoodRows.filter((item) => item.error_message || /error|fail/i.test(String(item.processing_status || ''))).length;
    checks.push(check(
      'ifood_webhooks', 'Webhooks iFood', 'business',
      !byName.ifood.ok ? 'unknown' : ifoodErrors >= 10 ? 'degraded' : ifoodErrors ? 'attention' : 'ok',
      !byName.ifood.ok ? errorMessage(byName.ifood, 'Não foi possível consultar a integração iFood.') : ifoodErrors ? `${ifoodErrors} erro(s) de processamento nas últimas 24 horas.` : 'Nenhum erro de webhook nas últimas 24 horas.',
      { value: ifoodErrors }
    ));

    const supportRows = byName.support.data || [];
    const overdueTickets = supportRows.filter((item) => Date.now() - new Date(item.updated_at || item.created_at).getTime() > 24 * 3600000).length;
    checks.push(check(
      'support_sla', 'SLA de suporte', 'business',
      !byName.support.ok ? 'unknown' : overdueTickets >= 5 ? 'degraded' : overdueTickets ? 'attention' : 'ok',
      !byName.support.ok ? errorMessage(byName.support, 'Não foi possível consultar chamados.') : overdueTickets ? `${overdueTickets} chamado(s) ativos estão sem atualização há mais de 24 horas.` : 'Fila ativa dentro do limite operacional de 24 horas.',
      { value: overdueTickets, action: overdueTickets ? { section: 'support' } : null }
    ));

    const admins = byName.admins.data || [];
    const usersByEmail = new Map(authUsers(byName.auth.data).map((user) => [user.email?.toLowerCase(), user]));
    const privileged = admins.filter((item) => item.status === 'active' && ['owner', 'platform_admin'].includes(item.role));
    const withoutMfa = privileged.filter((item) => !usersByEmail.get(item.email?.toLowerCase())?.factors?.some((factor) => !factor.status || factor.status === 'verified')).length;
    checks.push(check(
      'mfa_coverage', 'Cobertura de MFA', 'security',
      !byName.admins.ok || !byName.auth.ok ? 'unknown' : withoutMfa ? 'attention' : 'ok',
      !byName.admins.ok || !byName.auth.ok ? 'Cobertura de MFA indisponível.' : withoutMfa ? `${withoutMfa} administrador(es) privilegiado(s) ainda estão sem segundo fator.` : 'Todos os administradores privilegiados possuem MFA.',
      { value: withoutMfa, total: privileged.length, action: withoutMfa ? { section: 'administrators' } : null }
    ));

    const migrated = admins.length === 0 || !admins.some((item) => item.legacy);
    checks.push(check(
      'access_model', 'Modelo de acessos', 'security',
      !byName.admins.ok ? 'critical' : migrated ? 'ok' : 'degraded',
      !byName.admins.ok ? 'Não foi possível validar a equipe administrativa.' : migrated ? 'Papéis, status e proteção de acesso disponíveis.' : 'Migração de RBAC pendente; o painel está em modo de compatibilidade.'
    ));

    const mfaEnforced = process.env.ADMIN_ENFORCE_MFA === 'true';
    checks.push(check(
      'mfa_enforcement', 'Aplicação obrigatória de MFA', 'security',
      mfaEnforced ? 'ok' : 'attention',
      mfaEnforced ? 'Ações administrativas protegidas exigem sessão AAL2.' : 'MFA está em implantação assistida e ainda não bloqueia ações.'
    ));

    const overall = calculateOverall(checks);
    const durationMs = Date.now() - startedAt;
    const metrics = {
      expiredAccess,
      providerExpiredAccess,
      legacyExpiredAccess,
      pastDueWithAccess,
      missingOwnerMemberships,
      failedInvoices,
      mercadoPagoConnected: mpConnected,
      mercadoPagoWebhookProtected: mpWebhookProtected,
      paymentGaps,
      localPaymentGaps,
      invalidRemotePlans,
      ifoodErrors,
      overdueTickets,
      privilegedAdmins: privileged.length,
      privilegedWithoutMfa: withoutMfa
    };

    if (req.method === 'POST') {
      try {
        await supabase('/rest/v1/admin_health_snapshots', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: { overall_status: overall, duration_ms: durationMs, checks, metrics, initiated_by: context.user.email, source: 'manual' }
        });
      } catch (error) {
        if (!isSchemaCompatibilityError(error)) throw error;
      }
      await auditAdminAction(context, 'ADMIN_HEALTH_CHECK_RUN', { outcome: overall === 'critical' ? 'failure' : 'success', severity: overall === 'critical' ? 'high' : 'low', status: overall, metrics });
    }

    const [history, incidents] = await Promise.all([
      optionalRows('/rest/v1/admin_health_snapshots?select=id,overall_status,duration_ms,initiated_by,source,checked_at&order=checked_at.desc&limit=30'),
      optionalRows('/rest/v1/admin_incidents?select=*&status=in.(open,acknowledged)&order=started_at.desc&limit=20')
    ]);
    const groups = {
      core: checks.filter((item) => item.group === 'core'),
      business: checks.filter((item) => item.group === 'business'),
      security: checks.filter((item) => item.group === 'security')
    };
    return reply(res, overall === 'healthy' ? 200 : 207, {
      status: overall,
      app: 'ChefOS Control Center',
      timestamp: new Date().toISOString(),
      latencyMs: durationMs,
      summary: {
        operational: checks.filter((item) => item.status === 'ok').length,
        attention: checks.filter((item) => ['attention', 'unknown'].includes(item.status)).length,
        degraded: checks.filter((item) => ['degraded', 'critical'].includes(item.status)).length,
        total: checks.length
      },
      metrics,
      groups,
      checks: Object.fromEntries(checks.map((item) => [item.id, item])),
      history,
      incidents,
      system: { nodeVersion: process.version, deployment: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || 'local' }
    });
  } catch (error) {
    return fail(res, error);
  }
}
