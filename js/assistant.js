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

    var reply = '';
    var gotAny = false;

    fetch(apiBase + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        messages: history.slice(-10)
      })
    })
      .then(function (res) {
        var ct = res.headers.get('content-type') || '';
        if (!res.ok || ct.indexOf('text/event-stream') === -1) {
          /* JSON error path (4xx/5xx from the proxy itself) or an edge
             error page — read as text, try JSON, else a friendly line. */
          return res.text().then(function (text) {
            var data = null;
            try { data = JSON.parse(text); } catch (e) { /* non-JSON body */ }
            throw new Error(
              (data && data.message) || 'The assistant is unavailable right now. Please try again.'
            );
          });
        }
        if (!res.body || typeof res.body.getReader !== 'function') {
          throw new Error('Streaming is not supported in this browser.');
        }

        var reader = res.body.getReader();
        var decoder = new TextDecoder();

        function pump() {
          return reader.read().then(function (chunk) {
            if (chunk.done) {
              if (!gotAny) throw new Error('No response received.');
              history.push({ role: 'assistant', content: reply });
              return;
            }
            var events = decoder.decode(chunk.value, { stream: true }).split('\n\n');
            for (var i = 0; i < events.length; i++) {
              var line = events[i].replace(/^data:\s*/, '').trim();
              if (!line) continue;
              var frame;
              try { frame = JSON.parse(line); } catch (e) { continue; }
              if (frame.error) throw new Error('The assistant is unavailable right now. Please try again.');
              if (typeof frame.content === 'string' && frame.content) {
                if (!gotAny) {
                  gotAny = true;
                  pending.textContent = '';
                }
                reply += frame.content;
                pending.textContent = reply;
                log.scrollTop = log.scrollHeight;
              }
            }
            return pump();
          });
        }
        return pump();
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
