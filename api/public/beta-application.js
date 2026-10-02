import { createHash } from 'node:crypto';
import { bodyOf, cleanText, reply, supabase } from '../_lib/admin.js';

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
    const elapsed = Date.now() - startedAt;
    if (startedAt && elapsed >= 0 && elapsed < 2500) return reply(res, 429, { error: 'Envio rápido demais. Tente novamente.' });

    const name = cleanText(payload.name || payload.nome, 120);
    const restaurantName = cleanText(payload.restaurantName || payload.nome_restaurante, 160);
    const email = cleanText(payload.email, 180).toLowerCase();
    if (!name || !restaurantName || !emailValid(email) || payload.consentTerms !== true) {
      return reply(res, 400, { error: 'Preencha nome, restaurante, e-mail válido e aceite os termos do programa.' });
    }

    const requestId = cleanText(payload.requestId, 80) || null;
    if (requestId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) return reply(res, 400, { error: 'Reabra o formulário e tente novamente.' });
    const hasPrivacy = Object.hasOwn(payload, 'consentPrivacy');
    const termsVersion = cleanText(process.env.BETA_CONSENT_VERSION || 'beta-terms-v1', 80);
    const privacyVersion = cleanText(process.env.BETA_PRIVACY_VERSION || 'privacy-v1', 80);
    if (hasPrivacy && (payload.consentPrivacy !== true || payload.privacyVersion !== privacyVersion || payload.termsVersion !== termsVersion)) return reply(res, 400, { error: 'Revise a política de privacidade e o regulamento antes de enviar.' });
    const normalized = {
      name, restaurantName, email, phone: cleanText(payload.phone || payload.whatsapp, 40), establishmentType: cleanText(payload.establishmentType, 80),
      source: ['chefos.shop', 'chefos.online'].includes(cleanText(payload.source, 80)) ? cleanText(payload.source, 80) : 'landing',
      city: cleanText(payload.city, 100), neighborhood: cleanText(payload.neighborhood, 100), equipment: cleanText(payload.equipment, 120),
      consentTerms: true, consentMarketing: payload.consentMarketing === true, consentPrivacy: hasPrivacy ? true : null,
      termsVersion, privacyVersion: hasPrivacy ? privacyVersion : null,
      campaign: { source: cleanText(payload.campaign?.source, 100), medium: cleanText(payload.campaign?.medium, 100), name: cleanText(payload.campaign?.name, 100) }
    };
    const requestHash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
    const fingerprint = createHash('sha256').update(String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim()).digest('hex');
    const result = await supabase('/rest/v1/rpc/submit_beta_application_atomic', { method: 'POST', body: { p_payload: { ...normalized, requestId, requestHash }, p_fingerprint: fingerprint } });
    const { http_status: status, ...response } = result.data;
    return reply(res, status || 201, response);
  } catch (error) {
    if (error?.status === 400) return reply(res, 400, { error: 'Revise os dados do formulário antes de enviar.' });
    if (error?.details?.code === '23505') return reply(res, 409, { error: 'Já existe uma candidatura ativa para este e-mail.' });
    console.error('[Beta intake]', { code: error?.details?.code, status: error?.status });
    return reply(res, 502, { error: 'Não foi possível enviar agora. Tente novamente.' });
  }
}
