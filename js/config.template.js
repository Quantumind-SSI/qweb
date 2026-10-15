/* ============================================================================
   QUANTUMINDSSI — RUNTIME CONFIGURATION (TEMPLATE)

   Copy to js/config.js for local development. js/config.js is gitignored.

   NOTHING SECRET GOES IN THIS FILE.

   The previous build shipped a live Supabase project URL and anon JWT in
   committed source, and wrote to the database directly from the browser.
   That key has been removed. All writes now go through the Azure Functions
   API at /api, which holds its credentials in Static Web App application
   settings and never exposes them to the client.
   ========================================================================= */
window.QSSI_CONFIG = {
  /* Base path of the Azure Functions API. Leave as '/api' — Azure Static
     Web Apps routes this to the managed function app on the same origin,
     so there is no CORS surface and no key in the browser. */
  apiBase: '/api',

  /* Athenoir assistant. The inference endpoint and any API key are NOT
     client values: the widget talks to /api/chat, a server-side proxy
     (api/src/functions/chat.js) that reads ATHENOIR_ENDPOINT /
     ATHENOIR_API_KEY / ATHENOIR_MODEL from application settings and
     forwards there. The CSP can therefore stay connect-src 'self'.
     enabled=false renders nothing. */
  athenoir: {
    enabled: false,
    model: ''
  },

  /* Contact fallback shown when a submission fails */
  supportEmail: 'hello@quantumindssi.com'
};
