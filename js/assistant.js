/* eslint-disable */
(function () {
  'use strict';

  var root = document.querySelector('[data-assistant]');
  if (!root) return;

  var cfg = (window.QSSI_CONFIG && window.QSSI_CONFIG.athenoir) || { enabled: false };
  if (!cfg.enabled) {
    root.remove();
    return;
  }
  root.removeAttribute('hidden');

  var apiBase = ((window.QSSI_CONFIG && window.QSSI_CONFIG.apiBase) || '/api').replace(/\/$/, '');
  var model = (window.QSSI_CONFIG && window.QSSI_CONFIG.athenoir && window.QSSI_CONFIG.athenoir.model) || '';
  var supportEmail = (window.QSSI_CONFIG && window.QSSI_CONFIG.supportEmail) || 'hello@quantumindssi.com';

  var toggle = root.querySelector('[data-assistant-toggle]');
  var form = root.querySelector('[data-assistant-form]');
  var input = root.querySelector('[data-assistant-input]');
  var log = root.querySelector('[data-assistant-log]');
  var state = root.getAttribute('data-open') === 'true';

  function togglePanel() {
    state = !state;
    root.setAttribute('data-open', state);
    if (state) {
      input && input.focus();
    }
  }

  toggle && toggle.addEventListener('click', function () {
    togglePanel();
  });

  var history = [{ role: 'system', content: 'You are Athenoir, the sovereign edge AI assistant by QuantumindSSI. Be concise, precise, and helpful.' }];
  var lastSendAt = 0;
  var SEND_INTERVAL_MS = 20000;

  function append(role, text) {
    var el = document.createElement('div');
    el.className = 'assistant__msg assistant__msg--' + role;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }

  form && form.addEventListener('submit', function (e) {
    e.preventDefault();
    var question = (input.value || '').trim();
    if (!question) return;

    var sinceLast = Date.now() - lastSendAt;
    if (lastSendAt && sinceLast < SEND_INTERVAL_MS) {
      var wait = Math.ceil((SEND_INTERVAL_MS - sinceLast) / 1000);
      append('bot', 'You are sending messages too quickly — please wait ' + wait + ' seconds.');
      return;
    }
    input.value = '';
    submitQuestion(question);
  });

  function submitQuestion(question) {
    lastSendAt = Date.now();
    append('user', question);
    input.disabled = true;

    var pending = append('bot', 'Thinking…');
    history.push({ role: 'user', content: question });

    var reply = '';
    var gotAny = false;

    function doFetch(attempt) {
      return fetch(apiBase + '/chat', {
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
          var status = res.status;
          return res.text().then(function (text) {
            var data = null;
            try { data = JSON.parse(text); } catch (e) { /* non-JSON body */ }
            if (status === 429) {
              throw new Error('You are sending messages too quickly — give it a moment and try again.');
            }
            var isTransient = status >= 500 && status < 600;
            if (isTransient && attempt === 0) {
              return new Promise(function (resolve) {
                setTimeout(function () { resolve(doFetch(1)); }, 500);
              });
            }
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
    }
    doFetch(0);
  }

})();
