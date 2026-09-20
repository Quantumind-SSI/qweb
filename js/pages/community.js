/* Community signup -> /api/enquiry.
   Extracted from community.html so the CSP can drop 'unsafe-inline'. */
(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('community-form');
    if (!form) return;

    var btn = document.getElementById('community-submit');
    var status = document.getElementById('community-status');

    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var email = document.getElementById('join-email').value.trim();
      var pillarEl = document.getElementById('join-pillar');
      var hp = document.getElementById('community-hp');

      if (!email) {
        formFeedback(btn, status, 'error', 'Email is required.');
        return;
      }

      formFeedback(btn, status, 'loading');

      window.QSSI.submit('community', {
        name:   email.split('@')[0],
        email:  email,
        pillar: pillarEl ? pillarEl.value : '',
        company_website: hp ? hp.value : ''
      }).then(function () {
        formFeedback(btn, status, 'success',
          'Welcome to Quantuminds. We will be in touch.');
        form.reset();
      }).catch(function (err) {
        formFeedback(btn, status, 'error',
          err.message || 'Something went wrong; please try again.');
      });
    });
  });
})();
