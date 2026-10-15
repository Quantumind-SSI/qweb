/* ============================================================================
   QUANTUMINDSSI — ATHENOIR CHAT PROXY (streaming)
   Azure Functions v4 (Node 20), POST /api/chat

   The assistant widget talks to this same-origin endpoint; this function
   forwards to the inference deployment and streams the reply back as
   Server-Sent Events (SSE), matching the upstream OpenAI-compatible stream.

     1. The CSP stays connect-src 'self' — the browser never opens a socket
        to a third-party inference host.
     2. The inference endpoint URL and any bearer key live in application
        settings and never reach the client.
     3. Input is bounded and throttled before it touches the model, so an
        open public endpoint cannot be driven as a cost amplifier.
     4. Bytes flow continuously from the model through this proxy to the
        browser. A long generation no longer risks an idle-timeout kill
        (the SWA API gateway terminates quiet connections at ~30s, which
        ended non-streaming real answers with a text/plain 502 page).

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
     ATHENOIR_MAX_TOKENS completion budget; default 2048.
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
const MAX_RESPONSE_CHARS = 16000; /* streamed out, never buffered whole */
const UPSTREAM_TIMEOUT_MS = 120_000; /* generous: streaming keeps it alive */
const IDLE_TIMEOUT_MS = 45_000; /* kill a stalled stream, not a slow one */

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
    headers: { 'Content-Type': 'application/json' },
    jsonBody: body
  };
}

function sseError(status, message) {
  return {
    status,
    headers: { 'Content-Type': 'application/json' },
    jsonBody: { message }
  };
}

app.http('chat', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'chat',

  handler: async (request, context) => {
    const endpoint = process.env.ATHENOIR_ENDPOINT;
    if (!endpoint) {
      return sseError(503, { message: 'The assistant is not configured.' });
    }

    const contentType = request.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
      return sseError(415, { message: 'Content-Type must be application/json.' });
    }

    let body;
    try {
      const raw = await request.text();
      if (raw.length > MAX_BODY_BYTES) {
        return sseError(413, { message: 'Request body too large.' });
      }
      body = JSON.parse(raw);
    } catch {
      return sseError(400, { message: 'Malformed request body.' });
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return sseError(400, { message: 'Malformed request body.' });
    }

    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (throttled(ip)) {
      return sseError(429, { message: 'Too many requests. Please try again shortly.' });
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
      return sseError(422, { message: 'No usable messages in the request.' });
    }

    const model = String(body.model || process.env.ATHENOIR_MODEL || 'unsloth/Llama-3.2-3B-Instruct').slice(0, 200);

    /* The upstream URL is built from configuration only — client input
       never selects a host, so there is no SSRF surface. */
    let upstream;
    try {
      upstream = new URL('/v1/chat/completions', endpoint.replace(/\/+$/, ''));
    } catch {
      return sseError(502, { message: 'Assistant endpoint is invalid.' });
    }
    if (upstream.protocol !== 'https:') {
      return sseError(502, { message: 'Assistant endpoint must be HTTPS.' });
    }

    const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
    const key = process.env.ATHENOIR_API_KEY;
    if (key) headers.Authorization = `Bearer ${key}`;

    const thinkEnabled = process.env.ATHENOIR_THINKING !== 'false';
    const payload = {
      model,
      messages: [
        { role: 'system', content: process.env.ATHENOIR_SYSTEM || DEFAULT_SYSTEM_PROMPT },
        ...messages
      ],
      max_tokens: parseInt(process.env.ATHENOIR_MAX_TOKENS || '2048', 10) || 2048,
      temperature: 0.4,
      stream: true
    };
    if (thinkEnabled) payload.chat_template_kwargs = { enable_thinking: true };

    let upstreamRes;
    try {
      upstreamRes = await fetch(upstream, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
      });
    } catch (err) {
      context.error('Upstream chat request failed.', err);
      return sseError(502, { message: 'The assistant is unavailable.' });
    }

    if (!upstreamRes.ok) {
      context.error(`Upstream responded ${upstreamRes.status}.`);
      return sseError(502, { message: 'The assistant is unavailable.' });
    }
    if (!upstreamRes.body) {
      return sseError(502, { message: 'The assistant sent no reply.' });
    }

    /* Relay the upstream SSE stream. Upstream deltas: JSON lines in
       data: frames; content lands in choices[0].delta.content (and the
       final frame carries [DONE]). We re-emit each content delta as its
       own SSE frame. */
    const reader = upstreamRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let sent = 0;
    let lastActivity = Date.now();

    const stream = new ReadableStream({
      async pull(controller) {
        try {
          while (true) {
            if (Date.now() - lastActivity > IDLE_TIMEOUT_MS) {
              context.error('Upstream stream stalled.');
              controller.close();
              return;
            }
            const { done, value } = await reader.read();
            if (done) break;
            lastActivity = Date.now();
            buffer += decoder.decode(value, { stream: true });

            let idx;
            while ((idx = buffer.indexOf('\n')) !== -1) {
              const line = buffer.slice(0, idx).replace(/\r$/, '');
              buffer = buffer.slice(idx + 1);
              if (!line.startsWith('data:')) continue;
              const data = line.slice(5).trim();
              if (!data || data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data);
                const delta = parsed?.choices?.[0]?.delta?.content;
                if (typeof delta === 'string' && delta && sent < MAX_RESPONSE_CHARS) {
                  sent += delta.length;
                  controller.enqueue(
                    new TextEncoder().encode(`data: ${JSON.stringify({ content: delta })}\n\n`)
                  );
                }
              } catch {
                /* partial or non-JSON line — skip; next chunk completes it */
              }
            }
            /* Yield to the host between network reads; pull() is recalled. */
            return;
          }
          controller.close();
        } catch (err) {
          context.error('Upstream stream read failed.', err);
          try {
            controller.enqueue(
              new TextEncoder().encode(`data: ${JSON.stringify({ error: 'stream_interrupted' })}\n\n`)
            );
            controller.close();
          } catch {
            /* controller already closed */
          }
        }
      }
    });

    return {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no'
      },
      body: stream
    };
  }
});
