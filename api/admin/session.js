import { fail, isSchemaCompatibilityError, requireAdmin, reply, supabase } from '../_lib/admin.js';

export default async function handler(req, res) {
  const context = await requireAdmin(req, res, 'GET, OPTIONS');
  if (!context) return;
  if (req.method !== 'GET') return reply(res, 405, { error: 'Método não permitido.' });
  try {
    if (!context.admin.legacy) {
      try {
        await supabase(`/rest/v1/system_admins?email=eq.${encodeURIComponent(context.user.email.toLowerCase())}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: { last_seen_at: new Date().toISOString(), auth_user_id: context.user.id }
        });
      } catch (error) {
        if (!isSchemaCompatibilityError(error)) throw error;
      }
    }
    return reply(res, 200, {
      data: {
        id: context.user.id,
        email: context.user.email,
        displayName: context.admin.display_name || context.user.user_metadata?.full_name || context.user.email.split('@')[0],
        role: context.admin.role,
        status: context.admin.status,
        protected: context.admin.protected,
        capabilities: context.capabilities,
        mfaRequired: Boolean(context.admin.mfa_required),
        mfaVerified: context.mfaVerified,
        mfaEnforced: process.env.ADMIN_ENFORCE_MFA === 'true',
        legacySchema: context.admin.legacy
      }
    });
  } catch (error) {
    return fail(res, error);
  }
}
