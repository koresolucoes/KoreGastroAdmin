import { assert, bodyOf, fail, protectedAdminEmails, requireAdmin, reply, supabase } from '../_lib/admin.js';

export default async function handler(req, res) {
  const context = await requireAdmin(req, res, 'GET, POST, DELETE, OPTIONS');
  if (!context) return;
  try {
    if (req.method === 'GET') {
      const admins = await supabase('/rest/v1/system_admins?select=email,created_at&order=created_at.asc');
      const protectedEmails = protectedAdminEmails();
      return reply(res, 200, { data: (admins.data || []).map((item) => ({ ...item, protected: protectedEmails.has(item.email.toLowerCase()) })) });
    }
    const { email } = await bodyOf(req);
    assert(email, 'E-mail é obrigatório.');
    const normalized = String(email).trim().toLowerCase();
    if (req.method === 'POST') {
      await supabase('/rest/v1/system_admins', { method: 'POST', headers: { Prefer: 'return=representation' }, body: { email: normalized } });
      return reply(res, 201, { success: true });
    }
    if (req.method === 'DELETE') {
      assert(!protectedAdminEmails().has(normalized), 'Este administrador raiz não pode ser removido pelo painel.');
      await supabase(`/rest/v1/system_admins?email=eq.${encodeURIComponent(normalized)}`, { method: 'DELETE' });
      return reply(res, 200, { success: true });
    }
    return reply(res, 405, { error: 'Método não permitido.' });
  } catch (error) {
    return fail(res, error);
  }
}
