import { isSchemaCompatibilityError, supabase } from './admin.js';

const DAY_MS = 24 * 60 * 60 * 1000;

async function query(path) {
  try {
    return { ok: true, rows: (await supabase(path)).data || [], schemaMissing: false };
  } catch (error) {
    if (isSchemaCompatibilityError(error)) return { ok: false, rows: [], schemaMissing: true, error };
    throw error;
  }
}

function healthStatusForUnit(establishment, account, docs) {
  if (establishment.fiscal_mode !== 'ACTIVE') return 'inactive';
  if (!account || account.status !== 'ACTIVE') return 'critical';
  const certificateDate = account.certificate_valid_until ? new Date(account.certificate_valid_until).getTime() : null;
  if (certificateDate && certificateDate < Date.now()) return 'critical';
  if (certificateDate && certificateDate - Date.now() <= 7 * DAY_MS) return 'attention';
  if (docs.some((item) => ['FINAL_ERROR', 'REJECTED'].includes(item.status))) return 'attention';
  if (docs.some((item) => ['CONTINGENCY_PENDING', 'RETRYABLE_ERROR'].includes(item.status))) return 'attention';
  return 'healthy';
}

export async function fiscalHealthSnapshot() {
  const since24h = encodeURIComponent(new Date(Date.now() - DAY_MS).toISOString());
  const [establishments, accounts, documents, outbox, stores] = await Promise.all([
    query('/rest/v1/fiscal_establishments?select=store_id,fiscal_mode,environment,default_provider,activated_at,updated_at&limit=5000'),
    query('/rest/v1/fiscal_provider_accounts?select=store_id,provider,environment,status,certificate_valid_until,last_validated_at,validation_error_code,validation_error_message&limit=5000'),
    query(`/rest/v1/fiscal_documents?select=id,store_id,status,environment,provider,created_at,authorized_at,rejection_code,rejection_message&created_at=gte.${since24h}&limit=10000`),
    query('/rest/v1/fiscal_outbox?select=id,store_id,status,action,attempts,available_at,created_at,last_error_code,last_error_message&status=in.(PENDING,PROCESSING,RETRY,DEAD)&limit=10000'),
    query('/rest/v1/stores?select=id,name&limit=5000')
  ]);

  if (establishments.schemaMissing) {
    return {
      schemaReady: false,
      status: 'attention',
      checks: [{
        id: 'fiscal_schema', label: 'Fiscal Core', group: 'business', status: 'attention',
        message: 'A migration do Fiscal Core ainda não foi aplicada neste ambiente.', value: 0
      }],
      metrics: {
        activeUnits: 0, healthyUnits: 0, attentionUnits: 0, criticalUnits: 0,
        documents24h: 0, authorized24h: 0, rejected24h: 0, pending: 0, contingency: 0,
        certificatesExpiring30d: 0, authorizationRate: null
      },
      units: []
    };
  }

  const providerRows = accounts.rows;
  const documentRows = documents.rows;
  const storeNames = new Map(stores.rows.map((item) => [item.id, item.name || item.id]));
  const active = establishments.rows.filter((item) => item.fiscal_mode === 'ACTIVE');
  const unitRows = active.map((establishment) => {
    const account = providerRows.find((item) =>
      item.store_id === establishment.store_id
      && item.provider === establishment.default_provider
      && item.environment === establishment.environment
    ) || null;
    const docs = documentRows.filter((item) => item.store_id === establishment.store_id);
    return {
      storeId: establishment.store_id,
      storeName: storeNames.get(establishment.store_id) || establishment.store_id,
      environment: establishment.environment,
      provider: establishment.default_provider,
      providerStatus: account?.status || 'MISSING',
      certificateValidUntil: account?.certificate_valid_until || null,
      documents24h: docs.length,
      authorized24h: docs.filter((item) => item.status === 'AUTHORIZED').length,
      rejected24h: docs.filter((item) => ['REJECTED', 'FINAL_ERROR'].includes(item.status)).length,
      contingency24h: docs.filter((item) => item.status === 'CONTINGENCY_PENDING').length,
      health: healthStatusForUnit(establishment, account, docs)
    };
  });

  const authorized24h = documentRows.filter((item) => item.status === 'AUTHORIZED').length;
  const rejected24h = documentRows.filter((item) => ['REJECTED', 'FINAL_ERROR'].includes(item.status)).length;
  const contingency = documentRows.filter((item) => item.status === 'CONTINGENCY_PENDING').length;
  const pendingRows = outbox.rows.filter((item) => ['PENDING', 'PROCESSING', 'RETRY', 'DEAD'].includes(item.status));
  const deadRows = pendingRows.filter((item) => item.status === 'DEAD');
  const stalePending = pendingRows.filter((item) => Date.now() - new Date(item.created_at).getTime() > 15 * 60 * 1000);
  const certExpiring30d = providerRows.filter((item) => {
    if (!item.certificate_valid_until) return false;
    const diff = new Date(item.certificate_valid_until).getTime() - Date.now();
    return diff >= 0 && diff <= 30 * DAY_MS;
  }).length;
  const certExpired = providerRows.filter((item) => item.certificate_valid_until && new Date(item.certificate_valid_until).getTime() < Date.now()).length;
  const considered = authorized24h + rejected24h;
  const authorizationRate = considered ? Number(((authorized24h / considered) * 100).toFixed(2)) : null;
  const criticalUnits = unitRows.filter((item) => item.health === 'critical').length;
  const attentionUnits = unitRows.filter((item) => item.health === 'attention').length;
  const healthyUnits = unitRows.filter((item) => item.health === 'healthy').length;

  const checks = [
    {
      id: 'fiscal_active_units', label: 'Unidades com fiscal ativo', group: 'business',
      status: criticalUnits ? 'degraded' : attentionUnits ? 'attention' : 'ok',
      message: active.length
        ? `${active.length} unidade(s) ativa(s): ${healthyUnits} saudável(is), ${attentionUnits} em atenção e ${criticalUnits} crítica(s).`
        : 'Nenhuma unidade ativou emissão fiscal em produção ainda.',
      value: active.length
    },
    {
      id: 'fiscal_authorization', label: 'Autorizações fiscais — 24h', group: 'business',
      status: rejected24h >= 5 ? 'degraded' : rejected24h ? 'attention' : 'ok',
      message: considered
        ? `${authorized24h} autorizada(s), ${rejected24h} rejeitada(s) — taxa ${authorizationRate}%.`
        : 'Sem documentos fiscais concluídos nas últimas 24 horas.',
      value: authorizationRate ?? 0
    },
    {
      id: 'fiscal_outbox', label: 'Fila fiscal', group: 'business',
      status: deadRows.length ? 'degraded' : stalePending.length ? 'attention' : 'ok',
      message: deadRows.length
        ? `${deadRows.length} job(s) fiscal(is) chegaram ao estado DEAD.`
        : stalePending.length ? `${stalePending.length} job(s) aguardam há mais de 15 minutos.` : 'Fila fiscal sem backlog anormal.',
      value: pendingRows.length
    },
    {
      id: 'fiscal_contingency', label: 'Contingência fiscal', group: 'business',
      status: contingency ? 'attention' : 'ok',
      message: contingency ? `${contingency} documento(s) em contingência nas últimas 24 horas.` : 'Nenhum documento fiscal em contingência nas últimas 24 horas.',
      value: contingency
    },
    {
      id: 'fiscal_certificates', label: 'Certificados fiscais', group: 'business',
      status: certExpired ? 'degraded' : certExpiring30d ? 'attention' : 'ok',
      message: certExpired
        ? `${certExpired} certificado(s) expirado(s).`
        : certExpiring30d ? `${certExpiring30d} certificado(s) vencem em até 30 dias.` : 'Nenhum certificado cadastrado está próximo do vencimento.',
      value: certExpired + certExpiring30d
    }
  ];

  const status = checks.some((item) => item.status === 'degraded')
    ? 'degraded'
    : checks.some((item) => item.status === 'attention') ? 'attention' : 'healthy';

  return {
    schemaReady: true,
    status,
    checks,
    metrics: {
      activeUnits: active.length,
      healthyUnits,
      attentionUnits,
      criticalUnits,
      documents24h: documentRows.length,
      authorized24h,
      rejected24h,
      pending: pendingRows.length,
      contingency,
      certificatesExpiring30d: certExpiring30d,
      certificatesExpired: certExpired,
      authorizationRate
    },
    units: unitRows.sort((a, b) => ({ critical: 0, attention: 1, healthy: 2 }[a.health] ?? 3) - ({ critical: 0, attention: 1, healthy: 2 }[b.health] ?? 3))
  };
}
