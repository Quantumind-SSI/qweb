/* ============================================================================
   QUANTUMINDSSI — API CLIENT

   Every write goes to the Azure Functions API on the same origin, which
   persists to Azure Table Storage and emails the team. The browser never
   holds a storage credential.

   Form key            ->  Azure Table
     sales-enquiry         SalesEnquiries
     fbc, local-ai         SalesEnquiries
     contact, faq          ContactSubmissions
     preorder              Preorders
     waitlist              HeimdallWaitlist
     community             CommunitySignups
     careers               JobApplications
   ========================================================================= */
(function () {
  'use strict';

  var cfg = window.QSSI_CONFIG || {};
  var API = (cfg.apiBase || '/api').replace(/\/$/, '');
  var SUPPORT = cfg.supportEmail || 'hello@quantumindssi.com';

  window.QSSI = window.QSSI || {};

  /**
   * Submit a form payload.
   * @param   {string} form     value of the form's data-form attribute
   * @param   {object} payload  field name -> value
   * @returns {Promise<object>}
   */
  window.QSSI.submit = function (form, payload) {
    var controller = new AbortController();
    var timeout = setTimeout(function () { controller.abort(); }, 15000);

    return fetch(API + '/enquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        form: form,
        payload: payload,
        page: window.location.pathname,
        submittedAt: new Date().toISOString()
      }),
      signal: controller.signal
    })
      .then(function (res) {
        clearTimeout(timeout);

        if (res.status === 429) {
          throw new Error('Too many submissions. Please try again in a few minutes.');
        }

        if (!res.ok) {
          return res.json()
            .catch(function () { return {}; })
            .then(function (body) {
              throw new Error(body.message ||
                'We could not record your enquiry. Please email ' + SUPPORT + '.');
            });
        }

        return res.json().catch(function () { return {}; });
      })
      .catch(function (err) {
        clearTimeout(timeout);

        if (err.name === 'AbortError') {
          throw new Error('The request timed out. Please email ' + SUPPORT + '.');
        }
        if (err instanceof TypeError) {
          throw new Error('Network unavailable. Please email ' + SUPPORT + '.');
        }
        throw err;
      });
  };

  /* ══════════════════════════════════════════════════════════════════════
     LEGACY SHIMS

     Eight pages carry working submission logic written against the old
     browser-side Supabase client:

         const { error } = await db.from('sales_enquiries').insert({...});
         formFeedback(btn, statusEl, 'success', '…');

     That logic is fine — what was wrong was the transport (an anon JWT in
     committed source, writing straight to the database from the browser).
     These shims keep the page code untouched and route it through the
     Azure Functions API instead.
     ══════════════════════════════════════════════════════════════════ */

  /* Legacy Supabase table name -> form key understood by /api/enquiry.
     The Function maps each form key onto an Azure Table and an email label;
     the browser never names a storage target directly. */
  var TABLE_TO_FORM = {
    sales_enquiries:     'sales-enquiry',
    contact_submissions: 'contact',
    preorders:           'preorder',
    heimdall_waitlist:   'waitlist',
    community_signups:   'community',
    job_applications:    'careers'
  };

  window.db = {
    from: function (table) {
      return {
        insert: function (row) {
          var form = TABLE_TO_FORM[table] || 'sales-enquiry';
          var payload = Array.isArray(row) ? row[0] : row;

          // Resolve rather than reject: callers destructure `{ error }`
          return window.QSSI.submit(form, payload).then(
            function () { return { data: null, error: null }; },
            function (err) { return { data: null, error: err }; }
          );
        }
      };
    }
  };

  /**
   * Inline submit feedback. Same signature as before, but the status element
   * is given role="status" so the result is announced. Previously none of the
   * ten status containers on the site had a live region, so screen reader
   * users received no confirmation and no error.
   */
  window.formFeedback = function (btn, statusEl, state, msg) {
    if (statusEl && !statusEl.getAttribute('role')) {
      statusEl.setAttribute('role', 'status');
      statusEl.setAttribute('aria-live', 'polite');
    }

    if (btn) {
      if (!btn.dataset.originalText) btn.dataset.originalText = btn.textContent;
      btn.disabled = state === 'loading';
      btn.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');
      btn.textContent = state === 'loading' ? 'Sending…' : btn.dataset.originalText;
    }

    if (!statusEl) return;

    if (state === 'loading') {
      statusEl.textContent = '';
      statusEl.removeAttribute('data-state');
      statusEl.className = 'form-status';
      return;
    }

    statusEl.textContent = msg || '';
    statusEl.setAttribute('data-state', state);
    statusEl.className = 'form-status ' + state;
  };
})();
