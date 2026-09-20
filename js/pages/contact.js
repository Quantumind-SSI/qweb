/* Contact form -> /api/enquiry (Azure Functions -> Table Storage + email).
   Extracted from contact.html so the CSP can drop 'unsafe-inline'. */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('contact-form');
    if (!form) return;

    var btn = document.getElementById('contact-submit');
    var status = document.getElementById('contact-status');

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var payload = {
        name:    form.name.value.trim(),
        email:   form.email.value.trim(),
        org:     form.org.value.trim(),
        inquiry: form.inquiry.value,
        message: form.message.value.trim(),
        company_website: form.company_website.value
      };

      if (!payload.name || !payload.email) {
        formFeedback(btn, status, 'error', 'Name and email are required.');
        return;
      }

      formFeedback(btn, status, 'loading');

      window.QSSI.submit('contact', payload).then(function () {
        formFeedback(btn, status, 'success',
          'Message received. We will respond within 48 hours.');
        form.reset();
      }).catch(function (err) {
        formFeedback(btn, status, 'error',
          err.message || 'Something went wrong; please email us directly.');
      });
    });
  });
})();
