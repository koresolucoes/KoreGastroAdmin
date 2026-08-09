import {
  assert,
  assertUuid,
  auditAdminAction,
  bodyOf,
  cleanText,
  fail,
  queryValue,
  requireAdmin,
  reply,
  supabase
} from '../_lib/admin.js';

const normalize = (value = '') => String(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();

function normalizeItem(input, partial = false) {
  const item = input && typeof input === 'object' ? input : {};
  const normalized = {};
  if (!partial || item.name !== undefined) {
    normalized.name = cleanText(item.name, 180);
    assert(normalized.name.length >= 2, 'Nome do item é obrigatório.');
  }
  if (!partial || item.price !== undefined) {
    const price = Number(item.price);
    assert(Number.isFinite(price) && price >= 0, 'Preço inválido.');
    normalized.price = price;
  }
  if (!partial || item.prep_time_in_minutes !== undefined) {
    const prepTime = Number(item.prep_time_in_minutes ?? 15);
    assert(Number.isInteger(prepTime) && prepTime >= 0 && prepTime <= 1440, 'Tempo de preparo inválido.');
    normalized.prep_time_in_minutes = prepTime;
  }
  if (!partial || item.description !== undefined) normalized.description = cleanText(item.description, 1000) || null;
  if (!partial || item.external_code !== undefined) normalized.external_code = cleanText(item.external_code, 120) || null;
  if (!partial || item.is_available !== undefined) normalized.is_available = item.is_available !== false;
  return normalized;
}

async function listCategories(storeId) {
  const result = await supabase(`/rest/v1/categories?select=id,name,user_id&user_id=eq.${encodeURIComponent(storeId)}&deleted_at=is.null&order=name.asc`);
  return result.data || [];
}

async function resolveCategory(storeId, item, categories = null) {
  if (item.categoryId) {
    assertUuid(item.categoryId, 'categoryId');
    const found = await supabase(`/rest/v1/categories?select=id,name&id=eq.${encodeURIComponent(item.categoryId)}&user_id=eq.${encodeURIComponent(storeId)}&deleted_at=is.null&limit=1`);
    assert(found.data?.[0], 'Categoria não encontrada nesta loja.');
    return found.data[0];
  }

  const name = cleanText(item.category || 'Geral', 120);
  assert(name, 'Categoria é obrigatória.');
  const available = categories || await listCategories(storeId);
  const existing = available.find((category) => normalize(category.name) === normalize(name));
  if (existing) return existing;
  const created = await supabase('/rest/v1/categories', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: { name, user_id: storeId }
  });
  assert(created.data?.[0], 'Não foi possível criar a categoria.');
  return created.data[0];
}

async function findMenuItem(id, storeId) {
  const result = await supabase(`/rest/v1/recipes?select=id,name,description,price,category_id,prep_time_in_minutes,is_available,external_code,store_id,user_id&id=eq.${encodeURIComponent(id)}&or=(store_id.eq.${encodeURIComponent(storeId)},user_id.eq.${encodeURIComponent(storeId)})&deleted_at=is.null&limit=1`);
  return result.data?.[0] || null;
}

export default async function handler(req, res) {
  const context = await requireAdmin(req, res, 'GET, POST, PUT, OPTIONS');
  if (!context) return;

  try {
    if (req.method === 'GET') {
      const storeId = queryValue(req, 'storeId', queryValue(req, 'tenantId', ''));
      assertUuid(storeId, 'storeId');
      const [menuResult, categories] = await Promise.all([
        supabase(`/rest/v1/recipes?select=id,name,description,price,category_id,prep_time_in_minutes,is_available,created_at,updated_at,store_id,user_id,external_code,categories(id,name)&or=(store_id.eq.${encodeURIComponent(storeId)},user_id.eq.${encodeURIComponent(storeId)})&deleted_at=is.null&is_sub_recipe=eq.false&order=name.asc`),
        listCategories(storeId)
      ]);
      const data = menuResult.data || [];
      const available = data.filter((item) => item.is_available).length;
      const averagePrice = data.length ? data.reduce((total, item) => total + Number(item.price || 0), 0) / data.length : 0;
      return reply(res, 200, {
        data,
        categories,
        meta: { storeId, total: data.length, available, paused: data.length - available, averagePrice }
      });
    }

    const payload = await bodyOf(req);
    const storeId = payload.storeId || payload.tenantId;
    assertUuid(storeId, 'storeId');

    if (req.method === 'POST') {
      const normalizedItem = normalizeItem(payload.item);
      const category = await resolveCategory(storeId, payload.item || {});
      const created = await supabase('/rest/v1/recipes', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: {
          ...normalizedItem,
          user_id: storeId,
          store_id: storeId,
          category_id: category.id,
          is_sub_recipe: false
        }
      });
      await auditAdminAction(context, 'ADMIN_MENU_ITEM_CREATED', { storeId, item: created.data?.[0] || normalizedItem });
      return reply(res, 201, { data: created.data?.[0] || null });
    }

    if (req.method === 'PUT') {
      assertUuid(payload.id, 'id do item');
      const current = await findMenuItem(payload.id, storeId);
      assert(current, 'Item não encontrado nesta loja.');
      const requested = payload.item || payload.updates || {};
      const updates = normalizeItem(requested, true);
      if (requested.category !== undefined || requested.categoryId !== undefined) {
        updates.category_id = (await resolveCategory(storeId, requested)).id;
      }
      assert(Object.keys(updates).length, 'Nenhuma alteração válida foi informada.');
      updates.updated_at = new Date().toISOString();
      const updated = await supabase(`/rest/v1/recipes?id=eq.${encodeURIComponent(payload.id)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: updates
      });
      await auditAdminAction(context, 'ADMIN_MENU_ITEM_UPDATED', { storeId, itemId: payload.id, before: current, after: updated.data?.[0] || updates });
      return reply(res, 200, { data: updated.data?.[0] || null });
    }

    return reply(res, 405, { error: 'Método não permitido.' });
  } catch (error) {
    return fail(res, error);
  }
}
