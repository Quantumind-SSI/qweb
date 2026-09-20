/* ============================================================================
   QUANTUMINDSSI — SITE BEHAVIOUR
   No dependencies. Progressive enhancement: every feature degrades to a
   working, readable page if this file fails to load.

   Modules:
     navDrawer      accessible off-canvas menu (the previous build's menu
                    could not open on any page)
     currentPage    marks the active nav item with aria-current
     clock          UTC readouts for the HUD and system bar
     ticker         pause control for WCAG 2.2.2
     backdrop       opt-in image cycling, reduced-motion aware
     dialogs        native <dialog> wiring with focus restoration
     forms          submission state + announced status messages
     depthFX        3D tilt + cursor specular, fine pointers only
   ========================================================================= */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  /* ══════════════════════════════════════════════════════════════════════
     NAV DRAWER
     ══════════════════════════════════════════════════════════════════ */
  var FOCUSABLE = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled])',
    'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  function navDrawer() {
    var toggles = $$('[data-nav-toggle]');
    var drawer = $('[data-nav-drawer]');
    if (!toggles.length || !drawer) return;

    var scrim = $('[data-nav-scrim]');
    var lastFocus = null;

    function isOpen() { return drawer.getAttribute('data-open') === 'true'; }

    function setExpanded(expanded) {
      toggles.forEach(function (t) { t.setAttribute('aria-expanded', String(expanded)); });
    }

    function open() {
      lastFocus = document.activeElement;
      drawer.setAttribute('data-open', 'true');
      setExpanded(true);
      if (scrim) scrim.setAttribute('data-open', 'true');
      document.body.setAttribute('data-scroll-locked', '');

      var first = drawer.querySelector(FOCUSABLE);
      if (first) first.focus();
    }

    function close(restoreFocus) {
      drawer.setAttribute('data-open', 'false');
      setExpanded(false);
      if (scrim) scrim.setAttribute('data-open', 'false');
      document.body.removeAttribute('data-scroll-locked');

      if (restoreFocus !== false && lastFocus && lastFocus.focus) lastFocus.focus();
    }

    toggles.forEach(function (toggle) {
      toggle.addEventListener('click', function () {
        isOpen() ? close() : open();
      });
    });

    if (scrim) scrim.addEventListener('click', function () { close(); });

    // Navigating away should not leave the drawer open behind the new page
    drawer.addEventListener('click', function (e) {
      if (e.target.closest('a[href]')) close(false);
    });

    document.addEventListener('keydown', function (e) {
      if (!isOpen()) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }

      // Focus trap
      if (e.key !== 'Tab') return;

      var items = $$(FOCUSABLE, drawer).filter(function (el) {
        return el.offsetParent !== null;
      });
      if (!items.length) return;

      var first = items[0];
      var last = items[items.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });

    // Returning to desktop width must reset all drawer state
    var desktop = window.matchMedia('(min-width: 1024px)');
    var onChange = function (e) { if (e.matches && isOpen()) close(false); };
    desktop.addEventListener ? desktop.addEventListener('change', onChange)
                             : desktop.addListener(onChange);
  }

  /* ══════════════════════════════════════════════════════════════════════
     CURRENT PAGE
     Marks the active link with aria-current so the state reaches assistive
     tech, not just the stylesheet. Previously only 2 of 19 pages did this,
     and two more pointed it at the wrong page.
     ══════════════════════════════════════════════════════════════════ */
  function currentPage() {
    /* Azure Static Web Apps serves extensionless URLs (/products, not
       /products.html) and 301s the .html form. Normalise both sides so the
       same code works locally, in production, and against either link style. */
    function slug(path) {
      var last = String(path).split('#')[0].split('?')[0].split('/').pop();
      return last.replace(/\.html$/, '') || 'index';
    }

    var here = slug(window.location.pathname);

    $$('[data-nav-links] a[href]').forEach(function (link) {
      var target = slug(link.getAttribute('href'));

      var alsoMatches = (link.getAttribute('data-nav-match') || '')
        .split(/\s+/)
        .filter(Boolean)
        .map(slug);

      if (target === here || alsoMatches.indexOf(here) > -1) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     CLOCK
     ══════════════════════════════════════════════════════════════════ */
  function clock() {
    var timeEls = $$('[data-clock-time]');
    var dateEls = $$('[data-clock-date]');
    if (!timeEls.length && !dateEls.length) return;

    function pad(n) { return String(n).padStart(2, '0'); }

    function tick() {
      var now = new Date();

      var time = pad(now.getUTCHours()) + ':' +
                 pad(now.getUTCMinutes()) + ':' +
                 pad(now.getUTCSeconds()) + ' UTC';

      var date = now.toLocaleDateString('en-GB', {
        weekday: 'short', day: '2-digit', month: 'short',
        year: 'numeric', timeZone: 'UTC'
      });

      timeEls.forEach(function (el) {
        el.textContent = time;
        if (el.tagName === 'TIME') el.setAttribute('datetime', now.toISOString());
      });

      dateEls.forEach(function (el) {
        el.textContent = date;
        if (el.tagName === 'TIME') el.setAttribute('datetime', now.toISOString().slice(0, 10));
      });
    }

    tick();
    setInterval(tick, 1000);
  }

  /* ══════════════════════════════════════════════════════════════════════
     TICKER
     Duplicates its own content so the -50% scroll loops seamlessly, and
     exposes a pause control. WCAG 2.2.2 requires moving content to be
     stoppable; the previous build had no control on any of its 8 tickers.
     ══════════════════════════════════════════════════════════════════ */
  var ICON_PAUSE = '<svg viewBox="0 0 10 10" aria-hidden="true"><rect x="1" y="1" width="2.5" height="8" fill="currentColor"/><rect x="6.5" y="1" width="2.5" height="8" fill="currentColor"/></svg>';
  var ICON_PLAY  = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1 L9 5 L2 9 Z" fill="currentColor"/></svg>';

  function ticker() {
    $$('[data-ticker]').forEach(function (root) {
      var track = $('.ticker__track', root);
      if (!track) return;

      // Seamless loop: the -50% keyframe assumes exactly two copies
      if (!track.hasAttribute('data-cloned')) {
        var clone = track.cloneNode(true);
        clone.setAttribute('aria-hidden', 'true');
        Array.prototype.forEach.call(clone.children, function (child) {
          child.setAttribute('aria-hidden', 'true');
        });
        while (clone.firstChild) track.appendChild(clone.firstChild);
        track.setAttribute('data-cloned', 'true');
      }

      if (reduceMotion.matches) return;

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ticker__pause';
      btn.innerHTML = ICON_PAUSE;
      btn.setAttribute('aria-label', 'Pause scrolling headlines');
      btn.addEventListener('click', function () {
        var paused = root.getAttribute('data-paused') === 'true';
        root.setAttribute('data-paused', String(!paused));
        btn.innerHTML = paused ? ICON_PAUSE : ICON_PLAY;
        btn.setAttribute('aria-label',
          paused ? 'Pause scrolling headlines' : 'Resume scrolling headlines');
      });

      root.appendChild(btn);
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     BACKDROP
     Opt-in via data-backdrop-cycle. Static by default: the previous build
     cross-faded seven photographs behind every page permanently.
     ══════════════════════════════════════════════════════════════════ */
  function backdrop() {
    $$('[data-backdrop-cycle]').forEach(function (root) {
      if (reduceMotion.matches) return;

      var layers = $$('.backdrop__layer', root);
      if (layers.length < 2) return;

      var interval = parseInt(root.getAttribute('data-backdrop-cycle'), 10) || 9000;
      var index = 0;

      setInterval(function () {
        if (document.hidden) return;
        layers[index].classList.remove('is-active');
        index = (index + 1) % layers.length;
        layers[index].classList.add('is-active');
      }, interval);
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     DIALOGS
     Native <dialog>: the platform gives us the focus trap, Escape handling
     and background inertness the previous hand-rolled overlays lacked.
     ══════════════════════════════════════════════════════════════════ */
  function dialogs() {
    $$('[data-dialog-open]').forEach(function (trigger) {
      trigger.addEventListener('click', function (e) {
        e.preventDefault();
        var dlg = document.getElementById(trigger.getAttribute('data-dialog-open'));
        if (!dlg) return;

        if (typeof dlg.showModal === 'function') {
          dlg.showModal();
          document.body.setAttribute('data-scroll-locked', '');
          var first = dlg.querySelector(FOCUSABLE);
          if (first) first.focus();
        } else {
          dlg.setAttribute('open', '');
        }
      });
    });

    $$('dialog').forEach(function (dlg) {
      $$('[data-dialog-close]', dlg).forEach(function (btn) {
        btn.addEventListener('click', function () { dlg.close(); });
      });

      // Click outside the panel closes, but only when the press started there
      var downOnBackdrop = false;
      dlg.addEventListener('mousedown', function (e) { downOnBackdrop = e.target === dlg; });
      dlg.addEventListener('click', function (e) {
        if (e.target === dlg && downOnBackdrop) dlg.close();
        downOnBackdrop = false;
      });

      dlg.addEventListener('close', function () {
        document.body.removeAttribute('data-scroll-locked');
      });
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     FORMS
     Real <form> submission, per-field validity, and a status region that
     is actually announced. Previously none of the 10 status containers had
     aria-live, so screen reader users got no confirmation at all.
     ══════════════════════════════════════════════════════════════════ */
  function forms() {
    $$('form[data-form]').forEach(function (form) {
      var status = $('[data-form-status]', form);
      var submit = form.querySelector('[type="submit"]');

      function setStatus(state, message) {
        if (!status) return;
        status.setAttribute('data-state', state);
        status.textContent = message;
      }

      function clearFieldError(field) {
        field.removeAttribute('aria-invalid');
        var wrap = field.closest('.field');
        var err = wrap && $('.field__error', wrap);
        if (err) err.textContent = '';
      }

      function setFieldError(field, message) {
        field.setAttribute('aria-invalid', 'true');
        var wrap = field.closest('.field');
        var err = wrap && $('.field__error', wrap);
        if (err) err.textContent = message;
      }

      $$('input, select, textarea', form).forEach(function (field) {
        field.addEventListener('input', function () { clearFieldError(field); });
      });

      form.addEventListener('submit', function (e) {
        e.preventDefault();

        var invalid = null;

        $$('input, select, textarea', form).forEach(function (field) {
          clearFieldError(field);
          if (!field.checkValidity()) {
            setFieldError(field, field.validationMessage);
            if (!invalid) invalid = field;
          }
        });

        if (invalid) {
          setStatus('error', 'Please correct the highlighted fields.');
          invalid.focus();
          return;
        }

        setStatus('pending', 'Sending…');
        if (submit) submit.setAttribute('aria-busy', 'true');

        var payload = {};
        new FormData(form).forEach(function (value, key) { payload[key] = value; });

        var handler = window.QSSI && window.QSSI.submit;
        var task = handler
          ? handler(form.getAttribute('data-form'), payload)
          : Promise.reject(new Error('No submission handler configured.'));

        task.then(function () {
          setStatus('success', form.getAttribute('data-success') ||
            'Received. Our team will respond within two working days.');
          form.reset();
        }).catch(function (err) {
          setStatus('error', (err && err.message) ||
            'Could not send. Please email hello@quantumindssi.com.');
        }).then(function () {
          if (submit) submit.removeAttribute('aria-busy');
        });
      });
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     DEPTH FX — 3D tilt and cursor specular
     Feeds --tilt-x/--tilt-y/--tilt-lift and --mx/--my custom properties
     to [data-tilt] / [data-light] elements. One shared rAF loop, running
     only while a surface is being tracked; easing is a lerp, so the HUD
     drifts toward the cursor instead of snapping. Fine pointers only —
     touch and reduced-motion users get the flat, static page.
     ══════════════════════════════════════════════════════════════════ */
  function depthFX() {
    var fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    if (!fine.matches || reduceMotion.matches) return;

    var root = document.documentElement;
    var maxTilt = parseFloat(
      getComputedStyle(root).getPropertyValue('--depth-rotate')
    ) || 7;

    var SURFACES = '[data-tilt],[data-light]';
    var els = $$(SURFACES);
    if (!els.length) return;

    var tracked = new Set();       // elements currently under the pointer
    var state = {};                // el -> cursor targets + eased values
    var raf = null;

    function start() {
      if (raf) return;
      raf = requestAnimationFrame(loop);
    }

    function stop() {
      if (raf) { cancelAnimationFrame(raf); raf = null; }
    }

    function loop() {
      tracked.forEach(function (el) {
        var t = state[el];
        var k = 0.18;
        t.tx += (t.cx - t.tx) * k;
        t.ty += (t.cy - t.ty) * k;
        t.mx += ((t.cx + 0.5) * 100 - t.mx) * k;
        t.my += ((t.cy + 0.5) * 100 - t.my) * k;
        el.style.setProperty('--tilt-x', t.tx.toFixed(2) + 'deg');
        el.style.setProperty('--tilt-y', t.ty.toFixed(2) + 'deg');
        el.style.setProperty('--mx', t.mx.toFixed(1) + '%');
        el.style.setProperty('--my', t.my.toFixed(1) + '%');
      });
      raf = requestAnimationFrame(loop);
    }

    function track(el, x, y) {
      var r = el.getBoundingClientRect();
      var px = (x - r.left) / r.width - 0.5;
      var py = (y - r.top) / r.height - 0.5;
      var t = state[el] || (state[el] = { tx: 0, ty: 0, mx: 50, my: 50, cx: 0, cy: 0 });
      t.cx = Math.max(-0.5, Math.min(0.5, px));
      t.cy = Math.max(-0.5, Math.min(0.5, py));
    }

    function release(el) {
      tracked.delete(el);
      el.classList.remove('is-tracking');
      el.style.removeProperty('--tilt-x');
      el.style.removeProperty('--tilt-y');
      el.style.removeProperty('--mx');
      el.style.removeProperty('--my');
      if (!tracked.size) stop();
    }

    document.addEventListener('pointermove', function (e) {
      var el = e.target.closest ? e.target.closest(SURFACES) : null;
      if (!el) return;
      if (!tracked.has(el)) {
        tracked.add(el);
        el.classList.add('is-tracking');
        start();
      }
      track(el, e.clientX, e.clientY);
    }, { passive: true });

    els.forEach(function (el) {
      el.addEventListener('pointerleave', function () { release(el); });
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     FOOTER YEAR
     ══════════════════════════════════════════════════════════════════ */
  function year() {
    $$('[data-year]').forEach(function (el) {
      el.textContent = new Date().getFullYear();
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     DELEGATED ACTIONS — the CSP seam

     No page carries inline event handlers: script-src is 'self'. Interactive
     intent is declared in markup as data attributes and resolved here by a
     single document-level listener.

       data-open="id"        add .open to that element (modals)
       data-close="id"       remove .open from it
       data-action="name"    call QSSI.actions[name](el, event)

     Page scripts register their behaviours on QSSI.actions. Markup that
     arrives later (rendered carts, cloned templates) needs no rebinding —
     delegation reads the attributes at click time.
     ══════════════════════════════════════════════════════════════════ */
  function actions() {
    window.QSSI = window.QSSI || {};
    window.QSSI.actions = window.QSSI.actions || {};

    document.addEventListener('click', function (e) {
      var el = e.target.closest
        ? e.target.closest('[data-open],[data-close],[data-action]')
        : null;
      if (!el) return;

      var open = el.getAttribute('data-open');
      if (open) {
        var target = document.getElementById(open);
        if (target) target.classList.add('open');
      }

      var close = el.getAttribute('data-close');
      if (close) {
        var closing = document.getElementById(close);
        if (closing) closing.classList.remove('open');
      }

      var name = el.getAttribute('data-action');
      if (name && typeof window.QSSI.actions[name] === 'function') {
        window.QSSI.actions[name](el, e);
      }
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     INIT
     ══════════════════════════════════════════════════════════════════ */
  function init() {
    navDrawer();
    currentPage();
    clock();
    ticker();
    backdrop();
    dialogs();
    forms();
    depthFX();
    year();
    actions();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
