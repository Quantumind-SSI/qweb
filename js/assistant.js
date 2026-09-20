/* ============================================================================
   QUANTUMINDSSI — ATHENOIR ASSISTANT

   Renders nothing unless QSSI_CONFIG.athenoir.enabled is true AND an endpoint
   is configured. The previous build shipped the endpoint as an editable text
   input in the page, pre-filled with an ephemeral trycloudflare.com tunnel.
   ========================================================================= */
(function () {
  'use strict';

  var cfg = (window.QSSI_CONFIG && window.QSSI_CONFIG.athenoir) || {};
  var apiBase = ((window.QSSI_CONFIG && window.QSSI_CONFIG.apiBase) || '/api').replace(/\/$/, '');
  var root = document.querySelector('[data-assistant]');

  if (!root) return;

  if (!cfg.enabled) {
    root.remove();
    return;
  }

  root.hidden = false;

  /* The client never sees the inference endpoint: /api/chat (server-side
     proxy, api/src/functions/chat.js) forwards to it, so connect-src stays
     'self' and the endpoint URL and key stay in application settings. */
  var model = cfg.model || 'unsloth/Llama-3.2-3B-Instruct';

  var toggle = root.querySelector('[data-assistant-toggle]');
  var form = root.querySelector('[data-assistant-form]');
  var input = root.querySelector('[data-assistant-input]');
  var log = root.querySelector('[data-assistant-log]');
  var history = [];

  function append(role, text) {
    var el = document.createElement('div');
    el.className = 'assistant__msg assistant__msg--' + role;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  toggle.addEventListener('click', function () {
    var open = root.getAttribute('data-open') === 'true';
    root.setAttribute('data-open', String(!open));
    toggle.setAttribute('aria-expanded', String(!open));
    if (!open) input.focus();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && root.getAttribute('data-open') === 'true') {
      root.setAttribute('data-open', 'false');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.focus();
    }
  });

  // Enter sends, Shift+Enter inserts a newline
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    var question = input.value.trim();
    if (!question) return;

    append('user', question);
    input.value = '';
    input.disabled = true;

    var pending = append('bot', 'Thinking…');
    history.push({ role: 'user', content: question });

    fetch(apiBase + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        messages: history.slice(-10)
      })
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) throw new Error(data.message || 'Assistant unavailable (' + res.status + ').');
          return data;
        });
      })
      .then(function (data) {
        var reply = data &&
          data.choices &&
          data.choices[0] &&
          data.choices[0].message &&
          data.choices[0].message.content;

        if (!reply) throw new Error('No response received.');

        pending.textContent = reply.trim();
        history.push({ role: 'assistant', content: reply });
      })
      .catch(function (err) {
        pending.className = 'assistant__msg assistant__msg--error';
        pending.textContent = err.message || 'The assistant is unavailable.';
      })
      .then(function () {
        input.disabled = false;
        input.focus();
      });
  });
})();
