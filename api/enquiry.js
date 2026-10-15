/* ============================================================================
   QUANTUMINDSSI — ENQUIRY INTAKE
   Cloudflare Pages Function, replaces Azure Functions v4
   POST /api/enquiry

   Writes to Cloudflare KV and notifies the team. All processing is
   client-transparent — no storage credentials reach the browser.
   ========================================================================= */

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

/* In-memory throttle (per instance; for production use KV with TTL or
   D1). Static recycles instances freely, so this is a speed bump. */
const hits = new Map();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;

function throttled(key) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > MAX_PER_WINDOW;
}

function clean(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str ? str.slice(0, MAX_FIELD) : null;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&', '<': '<', '>': '>', '"': '"', "'": ''' }[c]
  ));
}

function json(status, body) {
  return {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    },
    body: JSON.stringify(body)
  };
}

/* Form identifier -> config. An allow-list: a caller cannot pick a table by
   changing the request body. */
const ROUTES = {
  'sales-enquiry': { table: 'SalesEnquiries',      label: 'Sales enquiry' },
  'contact':       { table: 'ContactSubmissions',  label: 'Contact form' },
  'faq':           { table: 'ContactSubmissions',  label: 'FAQ question' },
  'fbc':           { table: 'SalesEnquiries',      label: 'FBC enquiry' },
  'local-ai':      { table: 'SalesEnquiries',      label: 'Local AI enquiry' },
  'careers':       { table: 'JobApplications',     label: 'Job application' },
  'preorder':      { table: 'Preorders',           label: 'Pre-order' },
  'waitlist':      { table: 'HeimdallWaitlist',    label: 'Heimdall waitlist' },
  'community':     { table: 'CommunitySignups',    label: 'Community signup' }
};

/* Table Storage orders rows by RowKey ascending. A reverse tick prefix makes
   the newest submission sort first, so the portal shows recent enquiries at
   the top without a query. */
function newestFirstKey() {
  const reverse = (9_999_999_999_999 - Date.now()).toString().padStart(13, '0');
  return `${reverse}-${Math.random().toString(36).slice(2, 10)}`;
}

async function notify(form, route, entity) {
  /* In Cloudflare, we log the notification. For a production deployment,
     replace this with Cloudflare Email Service or a webhook. */
  const notifyEmail = process.env.NOTIFY_EMAIL || 'hello@quantumindssi.com';
  if (notifyEmail) {
    console.log(`[QSSI Notification] Form: ${form}, Label: ${route.label}`);
    console.log(`Entity:`, entity);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api/, '');

    /* Only POST to /enquiry and /chat are supported */
    if (request.method !== 'POST') {
      return json(405, { message: 'Method not allowed' });
    }

    if (path === 'enquiry') {
      return await handleEnquiry(request, env, ctx);
    }

    if (path === 'chat') {
      return await handleChat(request, env, ctx);
    }

    return json(404, { message: 'Not found' });
  }
};

/* ── ENQUIRY HANDLER ──────────────────────────────────────────────────── */

async function handleEnquiry(request, env, ctx) {
  const storage = env.SUBMISSIONS_KV;
  if (!storage) {
    return json(503, { message: 'Enquiry intake is not configured.' });
  }

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return json(415, { message: 'Content-Type must be application/json.' });
  }

  let body;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return json(413, { message: 'Request body too large.' });
    }
    body = JSON.parse(raw);
  } catch {
    return json(400, { message: 'Malformed request body.' });
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return json(400, { message: 'Malformed request body.' });
  }

  const route = ROUTES[typeof body.form === 'string' ? body.form : ''];
  if (!route) return json(400, { message: 'Unrecognised form.' });

  const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};

  /* Honeypot: a real user never fills a field they cannot see. */
  if (clean(payload.company_website)) {
    ctx.log('Honeypot triggered; discarding.');
    return json(202, { ok: true });
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (throttled(ip)) {
    return json(429, { message: 'Too many submissions. Please try again shortly.' });
  }

  const name = clean(payload.name);
  const email = clean(payload.email);

  if (!name) return json(422, { message: 'Name is required.' });
  if (!email || email.length > MAX_EMAIL || !EMAIL_RE.test(email)) {
    return json(422, { message: 'A valid email address is required.' });
  }

  const now = new Date();
  const partitionKey = now.toISOString().slice(0, 7);  /* YYYY-MM */
  const rowKey = newestFirstKey();

  const entity = {
    partitionKey,
    rowKey,
    form: body.form,
    name,
    email: email.toLowerCase(),
    status: 'new',
    page: clean(body.page) || '',
    submittedAt: now.toISOString()
  };

  /* Store allowed fields */
  for (const field of ALLOWED) {
    if (field === 'name' || field === 'email') continue;
    const value = clean(payload[field]);
    if (value !== null) entity[field] = value;
  }

  /* Persist to Cloudflare KV */
  try {
    const key = `submission:${partitionKey}:${rowKey}`;
    await storage.put(key, JSON.stringify(entity));
    ctx.log(`Recorded ${body.form} in KV.`);
  } catch (err) {
    ctx.error(`KV insert failed.`, err);
    return json(502, { message: 'We could not record your enquiry. Please email us.' });
  }

  await notify(body.form, route, entity);

  return json(201, { ok: true });
}

/* ── CHAT HANDLER ─────────────────────────────────────────────────────── */

async function handleChat(request, env, ctx) {
  const endpoint = env.ATHENOIR_ENDPOINT;
  if (!endpoint) {
    return json(503, { message: 'The assistant is not configured.' });
  }

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return json(415, { message: 'Content-Type must be application/json.' });
  }

  let body;
  try {
    const raw = await request.text();
    if (raw.length > 32 * 1024) {
      return json(413, { message: 'Request body too large.' });
    }
    body = JSON.parse(raw);
  } catch {
    return json(400, { message: 'Malformed request body.' });
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return json(400, { message: 'Malformed request body.' });
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

  /* Simple per-IP throttle using KV TTL */
  const throttleKey = `chat-throttle:${ip}`;
  const throttleVal = await env.SUBMISSIONS_KV.get(throttleKey, 'json') || { count: 0, last: 0 };
  const now = Date.now();
  if (now - throttleVal.last < 60000 && throttleVal.count >= 10) {
    return json(429, { message: 'Too many requests. Please try again shortly.' });
  }
  throttleVal.count = (throttleVal.count || 0) + 1;
  throttleVal.last = now;
  await env.SUBMISSIONS_KV.put(throttleKey, throttleVal, 60 * 60 * 24); /* 24h TTL */

  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  const messages = rawMessages
    .slice(-20)
    .map((m) => {
      const role = m && typeof m.role === 'string' ? m.role : '';
      const content = m && typeof m.content === 'string' ? m.content : '';
      if (role !== 'user' && role !== 'assistant') return null;
      if (!content) return null;
      return { role, content: content.slice(0, 2000) };
    })
    .filter(Boolean);

  if (!messages.length) {
    return json(422, { message: 'No usable messages in the request.' });
  }

  const model = String(body.model || process.env.ATHENOIR_MODEL).slice(0, 200);

  /* Build upstream URL from config only — client input never selects a host. */
  let upstream;
  try {
    upstream = new URL('/v1/chat/completions', endpoint.replace(/\/+$/, ''));
  } catch {
    return json(502, { message: 'Assistant endpoint is invalid.' });
  }
  if (upstream.protocol !== 'https:') {
    return json(502, { message: 'Assistant endpoint must be HTTPS.' });
  }

  const headers = { 'Content-Type': 'application/json' };
  /* API key is server-side only; never sent to browser */

  try {
    const upstreamRes = await fetch(upstream, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, messages, max_tokens: 800, temperature: 0.4 })
    });

    if (!upstreamRes.ok) {
      ctx.error(`Upstream responded ${upstreamRes.status}.`);
      return json(502, { message: 'The assistant is unavailable.' });
    }

    const data = await upstreamRes.json();
    const reply = data && data.choices && data.choices[0] &&
      data.choices[0].message && data.choices[0].message.content;

    if (typeof reply !== 'string' || !reply.trim()) {
      return json(502, { message: 'The assistant sent no reply.' });
    }

    return json(200, {
      choices: [{
        message: { role: 'assistant', content: reply.slice(0, 4000) }
      }]
    });
  } catch (err) {
    ctx.error('Upstream chat request failed.', err);
    return json(502, { message: 'The assistant is unavailable.' });
  }
}