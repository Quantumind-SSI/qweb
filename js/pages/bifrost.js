/* Bifrost research-partnership modal.
   Extracted from bifrost.html so the CSP can drop 'unsafe-inline'.
   Open/close is declarative: data-open / data-close in the markup. */
(function () {
  'use strict';

  var modal = document.getElementById('contact-modal-fbc');
  if (modal) {
    modal.addEventListener('click', function (e) {
      if (e.target === this) this.classList.remove('open');
    });
  }

  var submit = document.getElementById('fbc-submit');
  if (submit) {
    submit.addEventListener('click', async function () {
      const btn = this, statusEl = document.getElementById('fbc-status');
      const name = document.getElementById('fbc-name').value.trim();
      const email = document.getElementById('fbc-email').value.trim();
      const message = document.getElementById('fbc-message').value.trim();
      if (!name || !email || !message) {
        formFeedback(btn, statusEl, 'error', 'Name, email and message are required.');
        return;
      }
      formFeedback(btn, statusEl, 'loading');
      const { error } = await db.from('contact_submissions').insert({
        name, email, message,
        organisation: document.getElementById('fbc-org').value.trim() || null,
        inquiry_type: 'research'
      });
      if (error) {
        formFeedback(btn, statusEl, 'error', 'Failed; please email admin@quantumindssi.com');
      } else {
        formFeedback(btn, statusEl, 'success', "Message sent. We'll respond within 48 hours.");
        setTimeout(function () {
          document.getElementById('contact-modal-fbc').classList.remove('open');
        }, 2500);
      }
    });
  }
})();
