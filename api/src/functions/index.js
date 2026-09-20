/* ============================================================================
   QUANTUMINDSSI — ENQUIRY INTAKE & CHAT PROXY
   Cloudflare Workers + D1 + KV, ONLY /api/enquiry & /api/chat
   All other routes delegated to Cloudflare Pages _redirects
  ========================================================================= */

const ROUTES = {
  'sales-enquiry': { table: 'sales-enquiry',      label: 'Sales enquiry' },
  'contact':       { table: 'contact',            label: 'Contact form' },
  'faq':           { table: 'contact',            label: 'FAQ question' },
  'fbc':           { table: 'sales-enquiry',      label: 'FBC enquiry' },
  'local-ai':      { table: 'sales-enquiry',      label: 'Local AI enquiry' },
  'careers':       { table: 'careers',            label: 'Job application' },
  'preorder':      { table: 'preorder',           label: 'Pre-order' },
  'waitlist':      { table: 'waitlist',           label: 'Heimdall waitlist' },
  'community':     { table: 'community',          label: 'Community signup' }
};

const ALLOWED = [
  'name', 'email', 'org', 'organisation', 'country', 'message',
  'inquiry', 'enquiryType', 'scale', 'industry', 'sector', 'tier',
  'sku', 'variant', 'qty', 'quantity', 'usecase', 'useCase', 'config',
  'pillar', 'linkedin', 'portfolio', 'cover', 'role'
];
const MAX_FIELD = 4000;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_EMAIL = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function throttled(ip, kv) {
  try {
    if (!kv) return false;
    const now = Math.floor(Date.now() / 60000);
    const key = `throttle:${ip}:${now}`;
    const cnt = await kv.get(key, { default: 0 });
    if (cnt >= 5) return true;
    await kv.put(key, String(cnt + 1), { expirationTtl: 60 * 60 * 24 * 1000 });
    return false;
  } catch {
    return false;
  }
}

function clean(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str ? str.slice(0, MAX_FIELD) : null;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function submissionEntity(body, route) {
  const now = new Date();
  const entity = {
    partition_key: now.toISOString().slice(0, 7),
    row_key: `${(9_999_999_999_999 - Date.now()).toString().padStart(13, '0')}-${Math.random().toString(36).slice(2, 10)}`,
    form: body.form,
    name: clean(body.name),
    email: (clean(body.email) || '').toLowerCase(),
    status: 'new',
    page: clean(body.page) || '',
    submitted_at: now.toISOString()
  };
  const extra = {};
  for (const field of ALLOWED) {
    if (field === 'name' || field === 'email') continue;
    const value = clean(body[field]);
    if (value !== null) extra[field] = value;
  }
  entity.payload_json = JSON.stringify(extra);
  return entity;
}

async function onEnquiry(request, env, ctx) {
  let body;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json(413, { message: 'Request body too large.' });
    body = JSON.parse(raw);
  } catch { return json(400, { message: 'Malformed.' }); }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) { return json(400, { message: 'Malformed.' }); }
  const route = ROUTES[typeof body.form === 'string' ? body.form : ''];
  if (!route) return json(400, { message: 'Unrecognised.' });
  const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
  if (clean(payload.company_website)) { console.log('Honeypot.'); return json(202, { ok: true }); }
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (await throttled(ip, env.KV)) { return json(429, { message: 'Throttled.' }); }
  const name = clean(payload.name);
  const email = clean(payload.email);
  if (!name) return json(422, { message: 'Name required.' });
  if (!email || email.length > MAX_EMAIL || !EMAIL_RE.test(email)) { return json(422, { message: 'Valid email required.' }); }
  const entity = submissionEntity(body, route);
  const DB = env.DB;
  await DB.prepare(`CREATE TABLE IF NOT EXISTS submissions (...)`).run();
  try {
    await DB.prepare(`INSERT INTO submissions ...`).bind(
      entity.partition_key, entity.row_key, entity.form, entity.name, entity.email,
      entity.status, entity.page, entity.submitted_at, entity.payload_json
    ).run();
  } catch (e) { console.error(e); return json(502, { message: 'Insert failed.' }); }
  return json(201, { ok: true });
}

async function onChat(request, env, ctx) {
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 32 * 1024) return json(413, { message: 'Too large.' });
    body = JSON.parse(raw);
  } catch { return json(400, { message: 'Malformed.' }); }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) { return json(400, { message: 'Malformed.' }); }
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (await throttled(ip, env.KV)) { return json(429, { message: 'Throttled.' }); }
  return json(503, { message: 'Configure ATHENOIR_ENDPOINT.' });
}

export default {
  async fetch(request, env, ctx) {
    const DB = env.DB;
    await DB.prepare(`CREATE TABLE IF NOT EXISTS submissions (...)`).run();
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/api/enquiry') return await onEnquiry(request, env, ctx);
    if (request.method === 'POST' && url.pathname === '/api/chat') return await onChat(request, env, ctx);
    /* For non-API routes, return a minimal response that lets Pages handle _redirects */
    return new Response(null, { status: 204 });
  }
};