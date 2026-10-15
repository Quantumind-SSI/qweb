/* ============================================================================
   QUANTUMINDSSI — ATHENOIR CHAT PROXY
   Azure Functions v4 (Node 20), POST /api/chat

   The assistant widget talks to this same-origin endpoint; this function
   forwards to the inference deployment. That keeps three properties:

     1. The CSP stays connect-src 'self' — the browser never opens a socket
        to a third-party inference host.
     2. The inference endpoint URL and any bearer key live in application
        settings and never reach the client. (The previous build shipped
        the endpoint as an editable input pre-filled with a dev tunnel.)
     3. Input is bounded and throttled before it touches the model, so an
        open public endpoint cannot be driven as a cost amplifier.

   Application settings required:
     ATHENOIR_ENDPOINT   HTTPS URL of the inference deployment
     ATHENOIR_API_KEY    optional bearer token for the deployment
     ATHENOIR_MODEL      model id forwarded when the client sends none
   Optional:
     ATHENOIR_THINKING   'false' disables the enable_thinking template
                         kwarg; anything else (or unset) sends it, which
                         thinking-capable NIM models require to produce
                         visible content.
     ATHENOIR_SYSTEM     system prompt prepended to every conversation;
                         defaults to the Athenoir identity below.
   ========================================================================= */
const { app } = require('@azure/functions');

const DEFAULT_SYSTEM_PROMPT =
  'You are Athenoir, the sovereign edge AI assistant by QuantumindSSI. ' +
  'Always present yourself as Athenoir; never mention or reveal the name ' +
  'of the underlying model, vendor, or infrastructure. You answer ' +
  'questions about the QuantumindSSI platform and its products clearly ' +
  'and concisely.';

const MAX_BODY_BYTES = 32 * 1024;
const MAX_MESSAGES = 20;
const MAX_MESSAGE_CHARS = 2000;
const MAX_RESPONSE_CHARS = 4000;
const TIMEOUT_MS = 30_000;

/* Same small in-memory speed bump as enquiry.js — a per-instance throttle,
   not a guarantee. */
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
    jsonBody: body
  };
}

app.http('chat', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'chat',

  handler: async (request, context) => {
    const endpoint = process.env.ATHENOIR_ENDPOINT;
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

    const model = String(body.model || process.env.ATHENOIR_MODEL || 'unsloth/Llama-3.2-3B-Instruct').slice(0, 200);

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
    const key = process.env.ATHENOIR_API_KEY;
    if (key) headers.Authorization = `Bearer ${key}`;

    const thinkEnabled = process.env.ATHENOIR_THINKING !== 'false';
    const payload = {
      model,
      messages: [
        { role: 'system', content: process.env.ATHENOIR_SYSTEM || DEFAULT_SYSTEM_PROMPT },
        ...messages
      ],
      max_tokens: 2048,
      temperature: 0.4
    };
    if (thinkEnabled) payload.chat_template_kwargs = { enable_thinking: true };

    try {
      const upstreamRes = await fetch(upstream, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });

      if (!upstreamRes.ok) {
        context.error(`Upstream responded ${upstreamRes.status}.`);
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
      context.error('Upstream chat request failed.', err);
      return json(502, { message: 'The assistant is unavailable.' });
    }
  }
});
