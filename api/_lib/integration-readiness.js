import { isSubscriptionEntitled } from './subscription-entitlements.js';

const sourceReady = (sources, name) => sources[name]?.available === true;
const rows = (sources, name) => sourceReady(sources, name) ? sources[name].data || [] : [];
const signal = (state, label, detail) => ({ state, label, detail });

/** Evidence of configuration is deliberately separate from a successful provider transaction. */
export function integrationReadiness(store, sources, now = Date.now()) {
  const storeId = store.id;
  const subscriptions = rows(sources, 'subscriptions').filter((row) => row.user_id === storeId);
  const subscription = subscriptions[0] || null;
  const plan = rows(sources, 'plans').find((row) => row.id === subscription?.plan_id) || null;
  const participants = rows(sources, 'beta').filter((row) => row.store_id === storeId);
  const participant = participants[0] || null;
  const merchants = rows(sources, 'ifood').filter((row) => row.store_id === storeId && row.status === 'ACTIVE');
  const devices = rows(sources, 'devices').filter((row) => row.restaurant_id === storeId && row.provider === 'CIELO' && !row.revoked_at && !['RETIRED', 'REVOKED'].includes(row.trust_status));
  const accounts = rows(sources, 'cieloAccounts').filter((row) => row.restaurant_id === storeId && row.status === 'ACTIVE');
  const bindings = rows(sources, 'cieloBindings').filter((row) => row.restaurant_id === storeId && accounts.some((account) => account.id === row.provider_account_id));
  const boundDevices = devices.filter((device) => device.trust_status === 'TRUSTED' && bindings.some((binding) => binding.device_id === device.id));
  const mpAccount = rows(sources, 'mpAccounts').find((row) => row.store_id === storeId);
  const mpExpired = mpAccount?.mp_token_expires_at && Date.parse(mpAccount.mp_token_expires_at) <= now;
  const members = rows(sources, 'memberships').filter((row) => row.store_id === storeId && row.status === 'ACTIVE' && !row.revoked_at);
  const moduleKeys = rows(sources, 'permissions').filter((row) => row.plan_id === plan?.id).map((row) => row.permission_key);
  const entitled = isSubscriptionEntitled(subscription, now);
  const betaExpired = participant?.status === 'active' && (!participant.beta_ends_at || Date.parse(participant.beta_ends_at) <= now);
  const betaPaid = participant?.status === 'active' && (Number(plan?.price || 0) > 0 || Boolean(subscription?.mercado_pago_subscription_id));
  const betaContractKnown = ['subscriptions', 'plans'].every((name) => sourceReady(sources, name));
  const betaContractValid = subscription && plan && participant?.subscription_id === subscription.id && entitled;
  const unknown = (label) => signal('unknown', 'Não verificado', `${label}: a consulta não foi concluída. Atualize para tentar novamente.`);
  return {
    storeId, name: store.name, ownerId: store.owner_id,
    access: !sourceReady(sources, 'subscriptions') ? unknown('Acesso') : entitled
      ? signal('ready', 'Acesso liberado', `Válido até ${subscription.current_period_end || 'revisão do período'}.`)
      : signal('attention', 'Revisar acesso', subscription ? 'Confira o status e o vencimento da assinatura.' : 'Esta operação ainda não tem assinatura.'),
    subscription: subscription ? { id: subscription.id, planId: subscription.plan_id, status: subscription.status, periodEnd: subscription.current_period_end, providerLinked: Boolean(subscription.mercado_pago_subscription_id) } : null,
    plan: plan ? { id: plan.id, name: plan.name, price: plan.price, moduleKeys } : null,
    modulesVerified: sourceReady(sources, 'permissions') && sourceReady(sources, 'plans') && sourceReady(sources, 'subscriptions'),
    beta: !sourceReady(sources, 'beta') ? unknown('Programa beta') : !participant
      ? signal('neutral', 'Fora do beta', 'Esta operação não está vinculada a um participante.')
      : betaPaid ? signal('attention', 'Revisar gratuidade', 'Beta ativo com plano pago ou recorrência vinculada. Revise antes de cobrar.')
      : betaExpired ? signal('attention', 'Ciclo encerrado', 'O período do beta terminou. Combine a continuidade com o participante.')
      : participant.status === 'active' && !betaContractKnown ? unknown('Gratuidade do beta')
      : participant.status === 'active' && !betaContractValid ? signal('attention', 'Revisar acesso do beta', 'Confira o vínculo e o período da assinatura gratuita antes de ativar a operação.')
      : signal(participant.status === 'active' ? 'ready' : 'neutral', participant.status === 'active' ? 'Beta ativo · sem cobrança' : 'Beta em acompanhamento', participant.beta_ends_at ? `Ciclo até ${participant.beta_ends_at}.` : 'Os 90 dias começam na ativação.'),
    participant: participant ? { id: participant.id, status: participant.status, activatedAt: participant.activated_at, endsAt: participant.beta_ends_at } : null,
    ifood: !sourceReady(sources, 'ifood') ? unknown('iFood') : merchants.length
      ? signal('configured', `${merchants.length} loja(s) vinculada(s)`, 'Vínculos registrados. Confirme recebimento de pedidos na operação.')
      : signal('neutral', 'Sem loja vinculada', 'Inicie ou acompanhe a solicitação de conexão.'),
    merchants: merchants.map((row) => ({ merchantId: row.merchant_id, name: row.brand_name || 'Loja iFood', verifiedAt: row.verified_at })),
    cielo: !['devices', 'cieloAccounts', 'cieloBindings'].every((name) => sourceReady(sources, name)) ? unknown('Cielo')
      : boundDevices.length ? signal('configured', `${boundDevices.length} terminal(is) vinculado(s)`, 'Dispositivo autorizado e estabelecimento vinculado. Não confirma uma transação.')
      : signal(devices.length ? 'attention' : 'neutral', devices.length ? 'Concluir pareamento Cielo' : 'Sem terminal Cielo', devices.length ? 'Confira autorização do dispositivo e estabelecimento de recebimento.' : 'Cadastre o terminal nas configurações da operação.'),
    terminals: devices.map((device) => ({ id: device.id, name: device.name, trustStatus: device.trust_status, version: device.app_version, lastSeenAt: device.last_seen_at, bound: boundDevices.some((row) => row.id === device.id) })),
    mercadoPago: !sourceReady(sources, 'mpAccounts') ? unknown('Conta Mercado Pago') : mpAccount
      ? signal(mpExpired ? 'attention' : 'configured', mpExpired ? 'Renovar conexão' : 'Conta vinculada', mpExpired ? 'A validade registrada da conexão terminou.' : 'Credencial cadastrada para a operação. Validade e recebimento dependem do provedor.')
      : signal('neutral', 'Sem conta vinculada', 'O restaurante pode conectar sua conta de recebimento nas configurações.'),
    memberships: sourceReady(sources, 'memberships') ? { active: members.length, owners: members.filter((row) => ['OWNER', 'PARTNER'].includes(row.access_level)).length } : null,
    verifiedAt: new Date(now).toISOString(),
  };
}
