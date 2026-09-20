/* Job application modal.
   Extracted from careers.html so the CSP can drop 'unsafe-inline'.
   Role buttons declare data-action="job-open" data-role="…". */
(function () {
  'use strict';

  var _jobRole = '';

  window.QSSI = window.QSSI || {};
  window.QSSI.actions = window.QSSI.actions || {};

  window.QSSI.actions['job-open'] = function (el) {
    _jobRole = el.getAttribute('data-role') || '';
    document.getElementById('job-modal-role').textContent =
      _jobRole.toUpperCase() + ' · QUANTUMINDSSI';
    document.getElementById('job-modal').classList.add('open');
  };

  var modal = document.getElementById('job-modal');
  if (modal) {
    modal.addEventListener('click', function (e) {
      if (e.target === this) this.classList.remove('open');
    });
  }

  var submit = document.getElementById('job-submit');
  if (submit) {
    submit.addEventListener('click', async function () {
      const btn = this, statusEl = document.getElementById('job-status');
      const name  = document.getElementById('job-name').value.trim();
      const email = document.getElementById('job-email').value.trim();
      const cover = document.getElementById('job-cover').value.trim();
      if (!name || !email || !cover) {
        formFeedback(btn, statusEl, 'error', 'Name, email and cover note are required.');
        return;
      }
      formFeedback(btn, statusEl, 'loading');
      const { error } = await db.from('job_applications').insert({
        name, email,
        role:          _jobRole,
        linkedin_url:  document.getElementById('job-linkedin').value.trim() || null,
        portfolio_url: document.getElementById('job-portfolio').value.trim() || null,
        cover_note:    cover
      });
      if (error) {
        formFeedback(btn, statusEl, 'error', 'Submission failed; please email admin@quantumindssi.com');
      } else {
        formFeedback(btn, statusEl, 'success', 'Application received. We review every submission.');
        setTimeout(function () {
          document.getElementById('job-modal').classList.remove('open');
        }, 2500);
      }
    });
  }
})();
