/* ============================================================================
   QUANTUMINDSSI — ENQUIRY INTAKE
   Azure Functions v4 (Node 20), deployed as an Azure Static Web Apps managed
   function at POST /api/enquiry

   Writes to Azure Table Storage and notifies the team by email via Azure
   Communication Services. Both credentials come from Static Web App
   application settings and are read server-side only.

   History: this endpoint replaced a browser-side Supabase client whose anon
   JWT was committed to the repository. No database credential reaches the
   client any more, and Supabase is no longer a dependency.

   Application settings required:
     AZURE_STORAGE_CONNECTION_STRING   storage account holding the tables
     ACS_CONNECTION_STRING             Azure Communication Services
     ACS_SENDER                        DoNotReply@<domain>
     NOTIFY_EMAIL                      where enquiries are sent
   ========================================================================= */
const { app } = require('@azure/functions');
const { TableClient } = require('@azure/data-tables');
const { EmailClient } = require('@azure/communication-email');

/* Form identifier -> table. An allow-list: a caller cannot pick a table by
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

/* Fields accepted from the browser. Anything else is discarded rather than
   persisted — an open form must never define its own storage schema. */
const ALLOWED = [
  'name', 'email', 'org', 'organisation', 'country', 'message',
  'inquiry', 'enquiryType', 'scale', 'industry', 'sector', 'tier',
  'sku', 'variant', 'qty', 'quantity', 'usecase', 'useCase', 'config',
  'pillar', 'linkedin', 'portfolio', 'cover', 'role'
];

const MAX_FIELD = 4000;
const MAX_BODY_BYTES = 64 * 1024;   /* an enquiry is text; 64KB is generous */
const MAX_EMAIL = 254;              /* RFC 5321 upper bound                 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* Small in-memory throttle. Static Web Apps recycles instances freely, so
   this is a speed bump rather than a guarantee — put Front Door or APIM in
   front for enforceable rate limiting. */
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
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
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
    jsonBody: body
  };
}

/* Table Storage orders rows by RowKey ascending. A reverse tick prefix makes
   the newest submission sort first, so the portal shows recent enquiries at
   the top without a query. */
function newestFirstKey() {
  const reverse = (9_999_999_999_999 - Date.now()).toString().padStart(13, '0');
  return `${reverse}-${Math.random().toString(36).slice(2, 10)}`;
}

async function notify(context, route, entity) {
  const conn = process.env.ACS_CONNECTION_STRING;
  const sender = process.env.ACS_SENDER;
  const to = process.env.NOTIFY_EMAIL;

  if (!conn || !sender || !to) {
    context.warn('Email notification skipped: ACS settings incomplete.');
    return;
  }

  const rows = Object.entries(entity)
    .filter(([k]) => !['PartitionKey', 'RowKey', 'odata.etag'].includes(k))
    .map(([k, v]) =>
      `<tr><td style="padding:6px 14px 6px 0;color:#667;white-space:nowrap">${escapeHtml(k)}</td>` +
      `<td style="padding:6px 0;color:#111">${escapeHtml(v)}</td></tr>`
    ).join('');

  try {
    const poller = await new EmailClient(conn).beginSend({
      senderAddress: sender,
      recipients: { to: [{ address: to }] },
      replyTo: entity.email ? [{ address: entity.email }] : undefined,
      content: {
        /* Subject is a header — a name containing CR/LF must not smuggle
           extra headers into the outgoing message. */
        subject: `[QSSI] ${route.label} — ${String(entity.name || entity.email).replace(/[\r\n]+/g, ' ')}`,
        plainText: Object.entries(entity)
          .map(([k, v]) => `${k}: ${v}`).join('\n'),
        html:
          `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:640px">
             <p style="font:600 12px/1 system-ui;letter-spacing:.08em;text-transform:uppercase;color:#2db8b6">
               ${escapeHtml(route.label)}
             </p>
             <table style="border-collapse:collapse;font-size:14px;margin-top:12px">${rows}</table>
           </div>`
      }
    });
    await poller.pollUntilDone();
    context.log(`Notification sent to ${to}.`);
  } catch (err) {
    // A failed notification must never fail the submission — the row is saved.
    context.error('Notification failed; submission was still recorded.', err);
  }
}

app.http('enquiry', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'enquiry',

  handler: async (request, context) => {
    const storage = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!storage) {
      context.error('AZURE_STORAGE_CONNECTION_STRING is not configured.');
      return json(503, { message: 'Enquiry intake is not configured.' });
    }

    /* Only JSON is ever legitimate here: the site's own client sends it and
       nothing else should. Rejecting other content types up front also stops
       cross-site form POSTs (text/plain, multipart) from reaching the parser. */
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

    // Honeypot: a real user never fills a field they cannot see.
    if (clean(payload.company_website)) {
      context.log('Honeypot triggered; discarding.');
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
    const entity = {
      // Month partitions keep each partition small and make date-range
      // queries cheap without a secondary index.
      partitionKey: now.toISOString().slice(0, 7),
      rowKey: newestFirstKey(),
      form: body.form,
      name,
      email: email.toLowerCase(),
      status: 'new',
      page: clean(body.page) || '',
      submittedAt: now.toISOString()
    };

    for (const field of ALLOWED) {
      if (field === 'name' || field === 'email') continue;
      const value = clean(payload[field]);
      if (value !== null) entity[field] = value;
    }

    try {
      const client = TableClient.fromConnectionString(storage, route.table, {
        allowInsecureConnection: false
      });
      await client.createEntity(entity);
      context.log(`Recorded ${body.form} in ${route.table}.`);
    } catch (err) {
      context.error(`Insert into ${route.table} failed.`, err);
      return json(502, { message: 'We could not record your enquiry. Please email us.' });
    }

    await notify(context, route, entity);

    return json(201, { ok: true });
  }
});
