import { fail, requireAdmin, reply, supabase } from '../_lib/admin.js';

const qs = (field, ids) => `${field}=in.(${ids.map(encodeURIComponent).join(',')})`;

export default async function handler(req, res) {
  const context = await requireAdmin(req, res, 'GET, OPTIONS');
  if (!context) return;
  if (req.method !== 'GET') return reply(res, 405, { error: 'Método não permitido.' });
  try {
    const authUsers = await supabase('/auth/v1/admin/users?page=1&per_page=1000');
    const users = authUsers.data?.users || [];
    const ids = users.map((user) => user.id);
    if (!ids.length) return reply(res, 200, { data: [] });

    const [profiles, stores, subscriptions] = await Promise.all([
      supabase(`/rest/v1/profiles?select=id,full_name,avatar_url,updated_at&${qs('id', ids)}`),
      supabase(`/rest/v1/stores?select=id,name,owner_id,created_at&${qs('owner_id', ids)}`),
      supabase(`/rest/v1/subscriptions?select=id,user_id,plan_id,status,current_period_end&${qs('user_id', ids)}`)
    ]);
    const profileById = new Map((profiles.data || []).map((profile) => [profile.id, profile]));
    const storesByOwner = new Map();
    for (const store of stores.data || []) {
      const items = storesByOwner.get(store.owner_id) || [];
      items.push(store);
      storesByOwner.set(store.owner_id, items);
    }
    const subscriptionsByUser = new Map();
    for (const subscription of subscriptions.data || []) {
      const items = subscriptionsByUser.get(subscription.user_id) || [];
      items.push(subscription);
      subscriptionsByUser.set(subscription.user_id, items);
    }
    const data = users.map((user) => {
      const profile = profileById.get(user.id) || {};
      const tenantStores = storesByOwner.get(user.id) || [];
      return {
        id: user.id,
        full_name: profile.full_name || user.user_metadata?.full_name || 'Usuário cadastrado',
        email: user.email,
        avatar_url: profile.avatar_url || user.user_metadata?.avatar_url || null,
        role: 'Proprietário',
        updated_at: profile.updated_at || user.updated_at || user.created_at,
        stores: tenantStores.map(({ id, name, created_at }) => ({ id, name, created_at })),
        subscriptions: subscriptionsByUser.get(user.id) || []
      };
    });
    return reply(res, 200, { data });
  } catch (error) {
    return fail(res, error);
  }
}

