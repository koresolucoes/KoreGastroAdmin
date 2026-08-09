import {
  ROLE_DEFINITIONS,
  assert,
  auditAdminAction,
  bodyOf,
  cleanText,
  fail,
  hasCapability,
  isSchemaCompatibilityError,
  protectedAdminEmails,
  requireAdmin,
  reply,
  supabase,
  supabaseAuthAdmin
} from '../_lib/admin.js';

const ROLES = Object.keys(ROLE_DEFINITIONS);
const STATUSES = ['invited', 'active', 'suspended', 'revoked'];

function normalizedEmail(value) {
  const email = cleanText(value, 254).toLowerCase();
  assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Informe um e-mail válido.');
  return email;
}

async function members() {
  try {
    const result = await supabase('/rest/v1/system_admins?select=email,auth_user_id,display_name,role,status,invited_by,mfa_required,last_seen_at,created_at,updated_at,suspended_at,revoked_at,access_reason&order=created_at.asc');
    return { data: result.data || [], legacy: false };
  } catch (error) {
    if (!isSchemaCompatibilityError(error)) throw error;
    const legacy = await supabase('/rest/v1/system_admins?select=email,created_at&order=created_at.asc');
    return {
      data: (legacy.data || []).map((item) => ({ ...item, role: 'platform_admin', status: 'active', mfa_required: false })),
      legacy: true
    };
  }
}

async function authUsers() {
  try {
    const result = await supabaseAuthAdmin('/admin/users?page=1&per_page=1000');
    return Array.isArray(result.data) ? result.data : (result.data?.users || []);
  } catch (error) {
    console.warn('[Admin access] Não foi possível enriquecer a equipe com dados do Auth.', error?.message || error);
    return [];
  }
}

async function authUserByEmail(email) {
  const users = await authUsers();
  return users.find((user) => user.email?.toLowerCase() === email) || null;
}

function publicRoles(context) {
  return ROLES
    .filter((key) => key !== 'owner' || hasCapability(context, 'access.root'))
    .map((key) => ({ key, ...ROLE_DEFINITIONS[key] }));
}

function mfaEnabled(user) {
  return Boolean(user?.factors?.some((factor) => !factor.status || factor.status === 'verified'));
}

function summaryOf(data) {
  return {
    total: data.length,
    active: data.filter((item) => item.status === 'active').length,
    invited: data.filter((item) => item.status === 'invited').length,
    suspended: data.filter((item) => item.status === 'suspended').length,
    withoutMfa: data.filter((item) => ['owner', 'platform_admin'].includes(item.role) && item.status === 'active' && !item.mfaEnabled).length
  };
}

async function getMember(email) {
  const result = await members();
  return { member: result.data.find((item) => item.email?.toLowerCase() === email) || null, legacy: result.legacy };
}

async function upsertMember(payload) {
  try {
    const result = await supabase('/rest/v1/system_admins?on_conflict=email', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: payload
    });
    return { member: result.data?.[0] || payload, legacy: false };
  } catch (error) {
    if (!isSchemaCompatibilityError(error)) throw error;
    await supabase('/rest/v1/system_admins?on_conflict=email', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: { email: payload.email }
    });
    return { member: { email: payload.email, role: 'platform_admin', status: 'active' }, legacy: true };
  }
}

export default async function handler(req, res) {
  const context = await requireAdmin(req, res, 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (!context) return;
  try {
    if (req.method === 'GET') {
      const [{ data, legacy }, users] = await Promise.all([members(), authUsers()]);
      const usersByEmail = new Map(users.map((user) => [user.email?.toLowerCase(), user]));
      const protectedEmails = protectedAdminEmails();
      const enriched = data.map((item) => {
        const email = item.email.toLowerCase();
        const user = usersByEmail.get(email);
        const isProtected = protectedEmails.has(email);
        return {
          ...item,
          role: isProtected ? 'owner' : item.role,
          protected: isProtected,
          mfaEnabled: mfaEnabled(user),
          last_sign_in_at: user?.last_sign_in_at || null,
          authConfirmed: Boolean(user?.email_confirmed_at || user?.confirmed_at)
        };
      });
      return reply(res, 200, {
        data: enriched,
        summary: summaryOf(enriched),
        roles: publicRoles(context),
        meta: { legacySchema: legacy, canManage: hasCapability(context, 'access.manage'), canManageOwners: hasCapability(context, 'access.root') }
      });
    }

    const payload = await bodyOf(req);
    const email = normalizedEmail(payload.email);
    const protectedEmails = protectedAdminEmails();

    if (req.method === 'POST') {
      const role = ROLES.includes(payload.role) ? payload.role : 'support';
      assert(role !== 'owner' || hasCapability(context, 'access.root'), 'Somente um proprietário pode convidar outro proprietário.', 403);
      const displayName = cleanText(payload.displayName, 160) || email.split('@')[0];
      let user = await authUserByEmail(email);
      let invited = false;

      if (!user) {
        const redirectTo = cleanText(process.env.ADMIN_APP_URL || 'https://admin.chefos.online', 500).replace(/\/$/, '');
        const invite = await supabaseAuthAdmin(`/invite?redirect_to=${encodeURIComponent(redirectTo)}`, {
          method: 'POST',
          body: { email, data: { full_name: displayName, admin_role: role } }
        });
        user = invite.data;
        invited = true;
      }

      const result = await upsertMember({
        email,
        auth_user_id: user?.id || null,
        display_name: displayName,
        role,
        status: invited ? 'invited' : 'active',
        invited_by: context.user.email.toLowerCase(),
        mfa_required: payload.mfaRequired !== false && ['owner', 'platform_admin'].includes(role),
        access_reason: cleanText(payload.reason, 500) || 'Convite administrativo'
      });
      await auditAdminAction(context, 'ADMIN_ACCESS_INVITED', {
        email,
        reason: cleanText(payload.reason, 500) || 'Novo acesso administrativo',
        after: result.member,
        severity: role === 'owner' ? 'critical' : 'high'
      });
      return reply(res, 201, {
        success: true,
        invited,
        legacySchema: result.legacy,
        message: invited ? 'Convite enviado. O acesso será ativado após a confirmação.' : 'Usuário existente autorizado com sucesso.'
      });
    }

    const { member: current, legacy } = await getMember(email);
    assert(current, 'Administrador não encontrado.', 404);

    if (req.method === 'PUT' || req.method === 'PATCH') {
      assert(!legacy, 'A migração de segurança precisa ser aplicada antes de editar papéis e status.', 409);
      const nextRole = payload.role || current.role;
      const nextStatus = payload.status || current.status;
      assert(ROLES.includes(nextRole), 'Papel administrativo inválido.');
      assert(STATUSES.includes(nextStatus), 'Status administrativo inválido.');
      const changesPrivilege = nextRole !== current.role || nextStatus !== current.status;
      const reason = cleanText(payload.reason, 500);
      if (changesPrivilege) assert(reason.length >= 5, 'Informe o motivo da alteração de acesso.');
      assert(!(protectedEmails.has(email) && (nextRole !== 'owner' || nextStatus !== 'active')), 'Este administrador raiz deve permanecer proprietário e ativo.');
      assert(!(email === context.user.email.toLowerCase() && (nextRole !== current.role || nextStatus !== 'active')), 'Você não pode alterar seu próprio papel nem desativar seu acesso.');
      assert(!([current.role, nextRole].includes('owner')) || hasCapability(context, 'access.root'), 'Somente proprietários podem alterar acessos de proprietário.', 403);

      const updates = {
        display_name: cleanText(payload.displayName, 160) || current.display_name,
        role: nextRole,
        status: nextStatus,
        mfa_required: payload.mfaRequired === undefined ? current.mfa_required : Boolean(payload.mfaRequired),
        access_reason: reason || current.access_reason || null,
        suspended_at: nextStatus === 'suspended' ? new Date().toISOString() : null,
        revoked_at: nextStatus === 'revoked' ? new Date().toISOString() : null
      };
      const updated = await supabase(`/rest/v1/system_admins?email=eq.${encodeURIComponent(email)}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: updates
      });
      await auditAdminAction(context, nextStatus === 'suspended' ? 'ADMIN_ACCESS_SUSPENDED' : nextStatus === 'revoked' ? 'ADMIN_ACCESS_REVOKED' : 'ADMIN_ACCESS_UPDATED', {
        email, reason, before: current, after: updated.data?.[0] || { ...current, ...updates }, severity: changesPrivilege ? 'high' : 'medium'
      });
      return reply(res, 200, { success: true, data: updated.data?.[0] || null });
    }

    if (req.method === 'DELETE') {
      const reason = cleanText(payload.reason, 500) || 'Acesso revogado pelo painel';
      assert(!protectedEmails.has(email), 'Este administrador raiz não pode ser removido pelo painel.');
      assert(email !== context.user.email.toLowerCase(), 'Você não pode revogar seu próprio acesso.');
      assert(current.role !== 'owner' || hasCapability(context, 'access.root'), 'Somente proprietários podem revogar outro proprietário.', 403);
      if (legacy) {
        await supabase(`/rest/v1/system_admins?email=eq.${encodeURIComponent(email)}`, { method: 'DELETE' });
      } else {
        await supabase(`/rest/v1/system_admins?email=eq.${encodeURIComponent(email)}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: { status: 'revoked', revoked_at: new Date().toISOString(), access_reason: reason }
        });
      }
      await auditAdminAction(context, 'ADMIN_ACCESS_REVOKED', { email, reason, before: current, after: { ...current, status: 'revoked' }, severity: 'critical' });
      return reply(res, 200, { success: true });
    }

    return reply(res, 405, { error: 'Método não permitido.' });
  } catch (error) {
    return fail(res, error);
  }
}
