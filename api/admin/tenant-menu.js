import { assert, bodyOf, fail, requireAdmin, reply, supabase } from '../_lib/admin.js';

export default async function handler(req, res) {
  const context = await requireAdmin(req, res, 'GET, POST, PUT, OPTIONS');
  if (!context) return;
  try {
    if (req.method === 'GET') {
      const tenantId = req.query.tenantId;
      assert(typeof tenantId === 'string' && tenantId, 'tenantId é obrigatório.');
      const menu = await supabase(`/rest/v1/recipes?select=*,categories(name)&user_id=eq.${encodeURIComponent(tenantId)}&order=name.asc`);
      return reply(res, 200, { data: menu.data || [] });
    }

    const { tenantId, id, item, updates } = await bodyOf(req);
    if (req.method === 'PUT') {
      assert(id && updates, 'id e atualizações são obrigatórios.');
      const updated = await supabase(`/rest/v1/recipes?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' }, body: updates
      });
      return reply(res, 200, { data: updated.data?.[0] || null });
    }
    if (req.method === 'POST') {
      assert(tenantId && item?.name, 'tenantId e nome do item são obrigatórios.');
      const category = await supabase(`/rest/v1/categories?select=id&user_id=eq.${encodeURIComponent(tenantId)}&limit=1`);
      let categoryId = category.data?.[0]?.id;
      if (!categoryId) {
        const createdCategory = await supabase('/rest/v1/categories', {
          method: 'POST', headers: { Prefer: 'return=representation' }, body: { name: item.category || 'Geral', user_id: tenantId }
        });
        categoryId = createdCategory.data?.[0]?.id;
      }
      const created = await supabase('/rest/v1/recipes', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: {
          name: item.name,
          price: Number(item.price || 0),
          is_available: item.is_available !== false,
          user_id: tenantId,
          category_id: categoryId,
          prep_time_in_minutes: Number(item.prep_time_in_minutes || 15),
          is_sub_recipe: false
        }
      });
      return reply(res, 201, { data: created.data?.[0] || null });
    }
    return reply(res, 405, { error: 'Método não permitido.' });
  } catch (error) {
    return fail(res, error);
  }
}

