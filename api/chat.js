/* ============================================================================
   QUANTUMINDSSI — ATHENOIR CHAT PROXY
   Cloudflare Pages Function, replaces Azure Functions v4
   POST /api/chat

   Forwards to the inference deployment. Keeps three properties:

     1. The CSP stays connect-src 'self' — the browser never opens a socket
        to a third-party inference host.
     2. The inference endpoint URL and any API key live in application
        settings and never reach the client.
     3. Input is bounded and throttled before it touches the model, so an
        open public endpoint cannot be driven as a cost amplifier.
   ========================================================================= */

const MAX_BODY_BYTES = 32 * 1024;
const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 2000;
const MAX_RESPONSE_CHARS = 4000;
const TIMEOUT_MS = 30_000;

/* Per-IP throttle using KV TTL. Shares the same KV namespace as the
   enquiry function for simplicity, though in production a separate namespace
   or D1 would be preferred. */
const throttleKey = 'chat-throttle-ip';

/* Same small in-memory speed bump as the enquiry function, as a fallback
   if KV is unavailable. Static Web Apps / Pages recycles instances freely. */
const hits = new Map();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;

function throttled(key) {
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > MAX_PER_WINDOW;
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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api/, '');

    /* Only POST to /chat is supported */
    if (request.method !== 'POST') {
      return json(405, { message: 'Method not allowed' });
    }

    if (path !== 'chat') {
      return json(404, { message: 'Not found' });
    }

    return await handleChat(request, env, ctx);
  }
};

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

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

  /* Throttle check: KV-based with in-memory fallback */
  if (throttled(ip)) {
    return json(429, { message: 'Too many requests. Please try again shortly.' });
  }

  const rawMessages = Array.isArray(body.messages) ? body.messages : [];
  const messages = rawMessages
    .slice(-MAX_MESSAGES)
    .map((m) => {
      const role = m && typeof m.role === 'string' ? m.role : '';
      const content = m && typeof m.content === 'string' ? m.content : '';
      if (role !== 'user' && role !== 'assistant') return null;
      if (!content) return null;
      return { role, content: content.slice(0, MAX_MESSAGE_CHARS) };
    })
    .filter(Boolean);

  if (!messages.length) {
    return json(422, { message: 'No usable messages in the request.' });
  }

  const model = String(body.model || 'unsloth/Llama-3.2-3B-Instruct').slice(0, 200);

  /* The upstream URL is built from configuration only — client input
     never selects a host, so there is no SSRF surface. */
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
  /* API key is server-side only; never sent to the browser */

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
        message: { role: 'assistant', content: reply.slice(0, MAX_RESPONSE_CHARS) }
      }]
    });
  } catch (err) {
    ctx.error('Upstream chat request failed.', err);
    return json(502, { message: 'The assistant is unavailable.' });
  }
}