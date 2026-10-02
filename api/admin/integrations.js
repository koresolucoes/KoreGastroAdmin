import { fail, requireAdmin, reply, supabaseAll } from '../_lib/admin.js';
import { integrationReadiness } from '../_lib/integration-readiness.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const context = await requireAdmin(req, res, 'GET, OPTIONS', 'customers.read');
  if (!context) return;
  if (req.method !== 'GET') return reply(res, 405, { error: 'Método não permitido.' });
  try {
    const stores = await supabaseAll('/rest/v1/stores?select=id,name,owner_id&order=name.asc');
    const definitions = {
      subscriptions: 'subscriptions?select=id,user_id,plan_id,status,current_period_end,mercado_pago_subscription_id&order=updated_at.desc',
      plans: 'plans?select=id,name,price',
      permissions: 'plan_permissions?select=plan_id,permission_key',
      beta: 'beta_participants?select=id,store_id,subscription_id,status,activated_at,beta_ends_at&order=updated_at.desc',
      ifood: 'ifood_merchant_bindings?select=store_id,merchant_id,brand_name,status,verified_at',
      devices: 'devices?select=id,restaurant_id,name,provider,trust_status,revoked_at,app_version,last_seen_at&provider=eq.CIELO',
      cieloAccounts: 'payment_provider_accounts?select=id,restaurant_id,status&provider=eq.CIELO_SMART',
      cieloBindings: 'payment_terminal_bindings?select=restaurant_id,device_id,provider_account_id&provider=eq.CIELO_SMART',
      // Filter by credential presence on the server. Never select or return tokens.
      mpAccounts: 'store_integration_credentials?select=store_id,mp_token_expires_at&and=(mp_access_token.not.is.null,mp_access_token.neq.)',
      memberships: 'store_memberships?select=store_id,access_level,status,revoked_at',
    };
    const entries = await Promise.all(Object.entries(definitions).map(async ([name, path]) => {
      try { return [name, { available: true, data: await supabaseAll(`/rest/v1/${path}`) }]; }
      catch (error) { console.warn('[admin-integrations] source unavailable', { source: name, status: error.status }); return [name, { available: false, data: [] }]; }
    }));
    const sources = Object.fromEntries(entries);
    const unavailable = entries.filter(([, source]) => !source.available).map(([name]) => name);
    return reply(res, unavailable.length ? 207 : 200, {
      data: stores.map((store) => integrationReadiness(store, sources)),
      meta: { verifiedAt: new Date().toISOString(), unavailable, scope: 'configuration', transactionsVerified: false,
        unlinkedBetaParticipants: sources.beta.available ? sources.beta.data.filter((row) => ['active', 'onboarding'].includes(row.status) && !row.store_id).length : null },
    });
  } catch (error) { return fail(res, error); }
}
