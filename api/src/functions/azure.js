/* ============================================================================
   QUANTUMINDSSI — AZURE FUNCTIONS ENTRY POINT
   Explicit entry (not a glob) so the Functions worker loads exactly the
   Azure Functions v4 triggers below. The sibling index.js is a Cloudflare
   Worker and must never be loaded by the Azure worker, and the root-level
   chat.js / enquiry.js are Cloudflare Pages Functions, also Azure-inert.
   ========================================================================= */

require('./chat');
require('./enquiry');
