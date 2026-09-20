/* FAQ question modal.
   Extracted from faq.html so the CSP can drop 'unsafe-inline'.
   Open/close is declarative: data-open / data-close in the markup. */
(function () {
  'use strict';

  var modal = document.getElementById('contact-modal-faq');
  if (modal) {
    modal.addEventListener('click', function (e) {
      if (e.target === this) this.classList.remove('open');
    });
  }

  var submit = document.getElementById('faq-submit');
  if (submit) {
    submit.addEventListener('click', async function () {
      const btn = this, statusEl = document.getElementById('faq-status');
      const name = document.getElementById('faq-name').value.trim();
      const email = document.getElementById('faq-email').value.trim();
      const message = document.getElementById('faq-message').value.trim();
      if (!name || !email || !message) {
        formFeedback(btn, statusEl, 'error', 'Name, email and message are required.');
        return;
      }
      formFeedback(btn, statusEl, 'loading');
      const { error } = await db.from('contact_submissions').insert({
        name, email, message,
        organisation: document.getElementById('faq-org').value.trim() || null,
        inquiry_type: 'general'
      });
      if (error) {
        formFeedback(btn, statusEl, 'error', 'Failed; please email admin@quantumindssi.com');
      } else {
        formFeedback(btn, statusEl, 'success', "Message sent. We'll respond within 48 hours.");
        setTimeout(function () {
          document.getElementById('contact-modal-faq').classList.remove('open');
        }, 2500);
      }
    });
  }
})();
