import { supabase, supabaseAll } from './admin.js';

const normalize = (value = '') => String(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

async function listAuthUsers(maxUsers = 10000) {
  const users = [];
  const perPage = 200;
  for (let page = 1; users.length < maxUsers; page += 1) {
    const result = await supabase(`/auth/v1/admin/users?page=${page}&per_page=${perPage}`);
    const batch = result.data?.users || [];
    users.push(...batch);
    if (batch.length < perPage) break;
  }
  return users.slice(0, maxUsers);
}

function normalizeSubscription(item, now) {
  if (!item) return null;
  const periodTime = item.current_period_end ? new Date(item.current_period_end).getTime() : null;
  const periodExpired = Number.isFinite(periodTime) && periodTime < now;
  const entitlementActive = ['active', 'trialing'].includes(item.status) && !periodExpired;
  return {
    ...item,
    accountId: item.user_id,
    planId: item.plan_id,
    currentPeriodEnd: item.current_period_end,
    cancelAtPeriodEnd: Boolean(item.cancel_at_period_end),
    canceledAt: item.canceled_at || null,
    providerSubscriptionId: item.mercado_pago_subscription_id || null,
    periodExpired,
    entitlementActive
  };
}

export async function buildCustomerDataset() {
  const usersPromise = listAuthUsers();
  const [users, profiles, stores, subscriptions, companyProfiles, tickets, administrators] = await Promise.all([
    usersPromise,
    supabaseAll('/rest/v1/profiles?select=id,full_name,avatar_url,created_at,updated_at'),
    supabaseAll('/rest/v1/stores?select=id,name,owner_id,created_at&order=created_at.asc'),
    supabaseAll('/rest/v1/subscriptions?select=id,user_id,plan_id,status,current_period_end,created_at,updated_at,mercado_pago_subscription_id,cancel_at_period_end,canceled_at,payment_method_id&order=created_at.desc'),
    supabaseAll('/rest/v1/company_profile?select=user_id,company_name,cnpj,phone,address,created_at'),
    supabaseAll('/rest/v1/support_tickets?select=id,client_id,status,priority,created_at,updated_at').catch(() => []),
    supabaseAll('/rest/v1/system_admins?select=email').catch(() => [])
  ]);

  const now = Date.now();
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const companyByStore = new Map(companyProfiles.map((profile) => [profile.user_id, profile]));
  const storesByOwner = new Map();
  const subscriptionsByAccount = new Map();
  const ticketsByAccount = new Map();
  const administratorEmails = new Set(administrators.map((admin) => normalize(admin.email)));

  for (const store of stores) {
    const items = storesByOwner.get(store.owner_id) || [];
    items.push({
      ...store,
      storeId: store.id,
      profile: companyByStore.get(store.id) || null
    });
    storesByOwner.set(store.owner_id, items);
  }

  for (const item of subscriptions) {
    const normalized = normalizeSubscription(item, now);
    const items = subscriptionsByAccount.get(item.user_id) || [];
    items.push(normalized);
    subscriptionsByAccount.set(item.user_id, items);
  }

  for (const ticket of tickets) {
    const items = ticketsByAccount.get(ticket.client_id) || [];
    items.push(ticket);
    ticketsByAccount.set(ticket.client_id, items);
  }

  return users.filter((user) => {
    const ownsOperation = storesByOwner.has(user.id) || subscriptionsByAccount.has(user.id);
    return ownsOperation || !administratorEmails.has(normalize(user.email));
  }).map((user) => {
    const profile = profileById.get(user.id) || {};
    const accountStores = storesByOwner.get(user.id) || [];
    const accountSubscriptions = subscriptionsByAccount.get(user.id) || [];
    const accountTickets = ticketsByAccount.get(user.id) || [];
    const subscription = accountSubscriptions[0] || null;
    const missing = [];
    if (!accountStores.length) missing.push('store');
    if (accountStores.length && !accountStores.some((store) => store.profile)) {
      missing.push('company_profile');
    } else if (accountStores.length && !accountStores.some((store) => store.profile?.cnpj && store.profile.cnpj !== '00.000.000/0000-00')) {
      missing.push('company_data');
    }
    if (!subscription) missing.push('subscription');

    return {
      id: user.id,
      accountId: user.id,
      full_name: profile.full_name || user.user_metadata?.full_name || 'Usuário cadastrado',
      displayName: profile.full_name || user.user_metadata?.full_name || 'Usuário cadastrado',
      email: user.email,
      avatar_url: profile.avatar_url || user.user_metadata?.avatar_url || null,
      role: 'Proprietário',
      created_at: user.created_at,
      updated_at: profile.updated_at || user.updated_at || user.created_at,
      last_sign_in_at: user.last_sign_in_at || null,
      email_confirmed_at: user.email_confirmed_at || null,
      stores: accountStores,
      subscriptions: accountSubscriptions,
      subscription,
      onboarding: {
        complete: missing.length === 0,
        missing
      },
      support: {
        totalTickets: accountTickets.length,
        openTickets: accountTickets.filter((ticket) => ['open', 'in_progress'].includes(ticket.status)).length,
        urgentTickets: accountTickets.filter((ticket) => ['Urgente', 'Alta'].includes(ticket.priority) && !['resolved', 'closed'].includes(ticket.status)).length
      }
    };
  });
}

export function filterCustomers(customers, { query = '', status = 'all' } = {}) {
  const needle = normalize(query.trim());
  return customers.filter((customer) => {
    const subscription = customer.subscription;
    const searchable = normalize([
      customer.full_name,
      customer.email,
      ...customer.stores.map((store) => store.name)
    ].join(' '));
    const matchesQuery = !needle || searchable.includes(needle);
    const matchesStatus = status === 'all'
      || (status === 'none' && !subscription)
      || subscription?.status === status;
    return matchesQuery && matchesStatus;
  });
}

export function customerSummary(customers) {
  return customers.reduce((summary, customer) => {
    const subscription = customer.subscription;
    summary.total += 1;
    summary.stores += customer.stores.length;
    summary.openTickets += customer.support.openTickets;
    if (!customer.onboarding.complete) summary.incompleteOnboarding += 1;
    if (!subscription) summary.withoutSubscription += 1;
    else summary.subscriptions[subscription.status] = (summary.subscriptions[subscription.status] || 0) + 1;
    return summary;
  }, {
    total: 0,
    stores: 0,
    openTickets: 0,
    incompleteOnboarding: 0,
    withoutSubscription: 0,
    subscriptions: {}
  });
}
