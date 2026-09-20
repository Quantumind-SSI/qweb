/* Sales enquiry + Heimdall waitlist modals.
   Extracted from products.html so the CSP can drop 'unsafe-inline'.
   Triggers declare data-action="sales-open" data-sales-type="sales|pilot|local-ai";
   plain open/close is data-open / data-close. */
(function () {
  'use strict';

  var _salesType = 'sales';

  window.QSSI = window.QSSI || {};
  window.QSSI.actions = window.QSSI.actions || {};

  window.QSSI.actions['sales-open'] = function (el) {
    _salesType = el.getAttribute('data-sales-type') || 'sales';
    document.getElementById('sales-modal').classList.add('open');
  };

  var salesSubmit = document.getElementById('sq-submit');
  if (salesSubmit) {
    salesSubmit.addEventListener('click', async function () {
      const btn = this;
      const statusEl = document.getElementById('sq-status');
      const name  = document.getElementById('sq-name').value.trim();
      const email = document.getElementById('sq-email').value.trim();
      if (!name || !email) {
        formFeedback(btn, statusEl, 'error', 'Name and email are required.');
        return;
      }
      formFeedback(btn, statusEl, 'loading');
      const { error } = await db.from('sales_enquiries').insert({
        name,
        email,
        organisation:     document.getElementById('sq-org').value.trim() || null,
        country:          document.getElementById('sq-country').value.trim() || null,
        enquiry_type:     _salesType,
        deployment_scale: document.getElementById('sq-scale').value || null,
        industry:         document.getElementById('sq-industry').value || null,
        message:          document.getElementById('sq-message').value.trim() || null
      });
      if (error) {
        formFeedback(btn, statusEl, 'error', 'Submission failed; please email admin@quantumindssi.com');
      } else {
        formFeedback(btn, statusEl, 'success', 'Enquiry received. Our team will contact you within 24 hours.');
        setTimeout(function () {
          document.getElementById('sales-modal').classList.remove('open');
        }, 2500);
      }
    });
  }

  var waitlistSubmit = document.getElementById('wlp-submit');
  if (waitlistSubmit) {
    waitlistSubmit.addEventListener('click', async function () {
      const btn = this;
      const statusEl = document.getElementById('wlp-status');
      const name  = document.getElementById('wlp-name').value.trim();
      const email = document.getElementById('wlp-email').value.trim();
      if (!name || !email) {
        formFeedback(btn, statusEl, 'error', 'Name and email are required.');
        return;
      }
      formFeedback(btn, statusEl, 'loading');
      const { error } = await db.from('heimdall_waitlist').insert({
        name, email,
        organisation: document.getElementById('wlp-org').value.trim() || null,
        country:      document.getElementById('wlp-country').value.trim() || null,
        variant:      document.getElementById('wlp-variant').value || null,
        use_case:     document.getElementById('wlp-usecase').value.trim() || null
      });
      if (error) {
        formFeedback(btn, statusEl, 'error', 'Submission failed; please email admin@quantumindssi.com');
      } else {
        formFeedback(btn, statusEl, 'success', "You're on the waitlist. We'll contact you before launch.");
        setTimeout(function () {
          document.getElementById('waitlist-modal-p').classList.remove('open');
        }, 2500);
      }
    });
  }
})();
