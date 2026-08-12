import { createHash } from 'node:crypto';
import { bodyOf, cleanText, fail, reply, supabase } from '../_lib/admin.js';

const allowedOrigins = () => (process.env.PUBLIC_ALLOWED_ORIGINS || 'https://chefos.shop,https://www.chefos.shop,https://chefos.online,https://www.chefos.online')
  .split(',').map((value) => value.trim()).filter(Boolean);

function cors(req, res) {
  const origin = String(req.headers.origin || '');
  if (allowedOrigins().includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const emailValid = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return reply(res, 405, { error: 'Método não permitido.' });
  try {
    const payload = await bodyOf(req);
    if (cleanText(payload.website, 200)) return reply(res, 202, { received: true });
    const startedAt = Number(payload.startedAt || 0);
    if (startedAt && Date.now() - startedAt < 2500) return reply(res, 429, { error: 'Envio rápido demais. Tente novamente.' });

    const name = cleanText(payload.name || payload.nome, 120);
    const restaurantName = cleanText(payload.restaurantName || payload.nome_restaurante, 160);
    const email = cleanText(payload.email, 180).toLowerCase();
    if (!name || !restaurantName || !emailValid(email) || payload.consentTerms !== true) {
      return reply(res, 400, { error: 'Preencha nome, restaurante, e-mail válido e aceite os termos do programa.' });
    }

    const fingerprint = createHash('sha256').update(String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim()).digest('hex');
    const since = encodeURIComponent(new Date(Date.now() - 60 * 60 * 1000).toISOString());
    const attempts = await supabase(`/rest/v1/beta_submission_attempts?select=id&fingerprint=eq.${fingerprint}&created_at=gte.${since}&limit=5`);
    if ((attempts.data || []).length >= 5) return reply(res, 429, { error: 'Limite de tentativas atingido. Aguarde antes de tentar novamente.' });
    await supabase('/rest/v1/beta_submission_attempts', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { fingerprint } });

    const application = await supabase('/rest/v1/beta_applications', {
      method: 'POST', headers: { Prefer: 'return=representation' }, body: {
        name, restaurant_name: restaurantName, email,
        phone: cleanText(payload.phone || payload.whatsapp, 40) || null,
        establishment_type: cleanText(payload.establishmentType, 80) || null,
        restaurant_size: cleanText(payload.restaurantSize, 80) || null,
        source: ['chefos.shop', 'chefos.online'].includes(cleanText(payload.source, 80)) ? cleanText(payload.source, 80) : 'landing',
        consent_terms: true, consent_marketing: payload.consentMarketing === true,
        consent_version: cleanText(process.env.BETA_CONSENT_VERSION || 'beta-terms-v1', 80)
      }
    });
    const row = application.data?.[0];
    await supabase('/rest/v1/beta_consent_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: [
      { application_id: row.id, consent_type: 'program_terms', granted: true, document_version: row.consent_version, source: row.source },
      { application_id: row.id, consent_type: 'marketing', granted: row.consent_marketing, document_version: row.consent_version, source: row.source }
    ] });
    await supabase('/rest/v1/beta_application_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: { application_id: row.id, event_type: 'submitted', to_status: 'new', metadata: { source: row.source } } });
    return reply(res, 201, { received: true, id: row.id });
  } catch (error) {
    if (error?.details?.code === '23505') return reply(res, 409, { error: 'Já existe uma candidatura ativa para este e-mail.' });
    return fail(res, error);
  }
}
