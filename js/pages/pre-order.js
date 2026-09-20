/* Pre-order + waitlist modals, config pickers, SBC build cart.
   Extracted from pre-order.html so the CSP can drop 'unsafe-inline'.
   Markup declares:
     data-action="select-config"  data-prefix data-sku data-price data-gbp
     data-action="preorder-card"  data-prefix
     data-action="preorder-open"  data-sku data-price
     data-action="cart-toggle"    data-sku
     data-action="build-quote"
     data-open="waitlist-modal" / data-close="…"
   Rendered cart rows declare data-action="cart-qty" / "cart-remove" — the
   delegated listener in qssi.js resolves them at click time, so generated
   markup needs no handler attributes and no rebinding. */
(function () {
  'use strict';

  window.QSSI = window.QSSI || {};
  window.QSSI.actions = window.QSSI.actions || {};
  var actions = window.QSSI.actions;

  /* ── Modal state ── */
  var _currentSku = '';
  var _cardState = {
    mm:  { sku: 'LOCALAI-MAC-MINI-24',  price: 2999,  gbp: 2399,  label: '$2,999' },
    amd: { sku: 'LOCALAI-AMD-128',      price: 12999, gbp: 10399, label: '$12,999' },
    nv:  { sku: 'LOCALAI-NV-1H100',     price: 49999, gbp: 39999, label: '$49,999' }
  };

  actions['select-config'] = function (el) {
    var prefix = el.getAttribute('data-prefix');
    var sku = el.getAttribute('data-sku');
    var price = parseInt(el.getAttribute('data-price'), 10);
    var gbp = parseInt(el.getAttribute('data-gbp'), 10);
    if (!prefix || !sku || isNaN(price) || isNaN(gbp)) return;

    _cardState[prefix] = { sku: sku, price: price, gbp: gbp, label: '$' + price.toLocaleString('en-US') };
    var opts = el.parentElement.querySelectorAll('.config-opt');
    opts.forEach(function (o) { o.classList.remove('active'); });
    el.classList.add('active');

    var priceEl = document.getElementById(prefix + '-price');
    var gbpEl = document.getElementById(prefix + '-price-gbp');
    if (priceEl) {
      priceEl.textContent = '$' + price.toLocaleString('en-US') + ' ';
      var span = document.createElement('span');
      span.textContent = '/ one-time';
      priceEl.appendChild(span);
    }
    if (gbpEl) gbpEl.textContent = '\u2248 \u00a3' + gbp.toLocaleString('en-US') + ' GBP';
  };

  function openPreorderModal(sku, price) {
    _currentSku = sku;
    document.getElementById('preorder-sku').textContent = sku + ' \u00b7 ' + price;
    document.getElementById('preorder-modal').classList.add('open');
  }

  actions['preorder-open'] = function (el) {
    openPreorderModal(el.getAttribute('data-sku') || '', el.getAttribute('data-price') || '');
  };

  actions['preorder-card'] = function (el) {
    var s = _cardState[el.getAttribute('data-prefix')];
    if (s) openPreorderModal(s.sku, s.label);
  };

  document.querySelectorAll('.qssi-modal-overlay').forEach(function (el) {
    el.addEventListener('click', function (e) {
      if (e.target === el) el.classList.remove('open');
    });
  });

  /* ── SBC Motherboard Cart ── */
  var mbCart = [];
  var mbCatalog = {
    'QSSI-LAN-NVIDIA-NANO': { name: 'NVIDIA Jetson Nano LocalAI Node', subtitle: '4GB \u00b7 Low-cost edge AI', price: 299 },
    'QSSI-LAN-NVIDIA-ORIN-NANO': { name: 'NVIDIA Jetson Orin Nano LocalAI Node', subtitle: '8GB \u00b7 67 TOPS', price: 499 },
    'QSSI-LAN-NVIDIA-ORIN-NX': { name: 'NVIDIA Jetson Orin NX LocalAI Node', subtitle: '16GB \u00b7 100 TOPS', price: 699 },
    'QSSI-LAN-NVIDIA-AGX-ORIN': { name: 'NVIDIA Jetson AGX Orin LocalAI Node', subtitle: '64GB \u00b7 275 TOPS', price: 1499 },
    'QSSI-LAN-AMD-KRIA': { name: 'AMD Kria KR260 LocalAI Node', subtitle: 'Robotics Starter Kit', price: 449 },
    'QSSI-LAN-AMD-RYZEN-AI': { name: 'AMD Ryzen AI Embedded LocalAI Node', subtitle: 'V1000 / V2000 / R2000', price: 599 },
    'QSSI-LAN-AMD-VERSAL': { name: 'AMD Versal AI Edge LocalAI Node', subtitle: 'Adaptive SoC \u00b7 AI acceleration', price: 899 },
    'QSSI-LAN-ROCKCHIP-RK3568': { name: 'ROCKCHIP RK3568 LocalAI Node', subtitle: '1 TOPS NPU \u00b7 entry edge', price: 249 },
    'QSSI-LAN-ROCKCHIP-RK3576': { name: 'ROCKCHIP RK3576 LocalAI Node', subtitle: '6 TOPS NPU \u00b7 next-gen', price: 349 },
    'QSSI-LAN-ROCKCHIP-RK3588': { name: 'ROCKCHIP RK3588 LocalAI Node', subtitle: '8-core \u00b7 6 TOPS NPU', price: 399 },
    'QSSI-LAN-RADXA-ZERO3': { name: 'RADXA ZERO 3E LocalAI Node', subtitle: 'RK3566 \u00b7 tiny edge', price: 199 },
    'QSSI-LAN-RADXA-ROCK3C': { name: 'RADXA ROCK 3C LocalAI Node', subtitle: 'RK3566 \u00b7 mid-range', price: 279 },
    'QSSI-LAN-RADXA-ROCK5C': { name: 'RADXA ROCK 5C LocalAI Node', subtitle: 'RK3588S \u00b7 6 TOPS', price: 329 },
    'QSSI-LAN-RADXA-ROCK5B': { name: 'RADXA ROCK 5B+ LocalAI Node', subtitle: 'RK3588 \u00b7 full I/O', price: 379 }
  };

  actions['cart-toggle'] = function (el) {
    var sku = el.getAttribute('data-sku');
    if (!sku) return;
    var idx = mbCart.findIndex(function (i) { return i.sku === sku; });
    var card = document.querySelector('.mb-cart-card[data-sku="' + sku + '"]');
    var btn = card ? card.querySelector('.btn-mb-add') : null;
    if (idx >= 0) {
      mbCart.splice(idx, 1);
      if (card) card.classList.remove('selected');
      if (btn) { btn.textContent = 'Add to Build'; btn.classList.remove('added'); }
    } else {
      var item = mbCatalog[sku];
      if (item) {
        mbCart.push({ sku: sku, name: item.name, subtitle: item.subtitle, price: item.price, qty: 1 });
        if (card) card.classList.add('selected');
        if (btn) { btn.textContent = 'Added'; btn.classList.add('added'); }
      }
    }
    renderBuildPanel();
  };

  actions['cart-remove'] = function (el) {
    var sku = el.getAttribute('data-sku');
    var idx = mbCart.findIndex(function (i) { return i.sku === sku; });
    if (idx >= 0) {
      mbCart.splice(idx, 1);
      var card = document.querySelector('.mb-cart-card[data-sku="' + sku + '"]');
      var btn = card ? card.querySelector('.btn-mb-add') : null;
      if (card) card.classList.remove('selected');
      if (btn) { btn.textContent = 'Add to Build'; btn.classList.remove('added'); }
      renderBuildPanel();
    }
  };

  actions['cart-qty'] = function (el) {
    var sku = el.getAttribute('data-sku');
    var delta = parseInt(el.getAttribute('data-delta'), 10) || 0;
    var item = mbCart.find(function (i) { return i.sku === sku; });
    if (!item || !delta) return;
    item.qty = Math.max(1, item.qty + delta);
    renderBuildPanel();
  };

  function renderBuildPanel() {
    var list = document.getElementById('build-list');
    var totalRow = document.getElementById('build-total');
    var totalValue = document.getElementById('build-total-value');
    var quoteBtn = document.getElementById('btn-quote');
    list.innerHTML = '';
    var total = 0;
    if (mbCart.length === 0) {
      var empty = document.createElement('li');
      empty.className = 'build-empty';
      empty.textContent = 'No motherboards selected yet.';
      list.appendChild(empty);
      totalRow.style.display = 'none';
      quoteBtn.disabled = true;
      return;
    }
    mbCart.forEach(function (item) {
      total += item.price * item.qty;

      var li = document.createElement('li');
      li.className = 'build-item';

      var left = document.createElement('div');
      var name = document.createElement('div');
      name.className = 'build-item-name';
      name.textContent = item.name;
      var meta = document.createElement('div');
      meta.className = 'build-item-meta';
      meta.textContent = item.subtitle + ' \u00b7 $' + item.price + ' each';

      var qtyRow = document.createElement('div');
      qtyRow.className = 'qty-row';
      var minus = document.createElement('button');
      minus.className = 'btn-qty';
      minus.textContent = '\u2212';
      minus.setAttribute('data-action', 'cart-qty');
      minus.setAttribute('data-sku', item.sku);
      minus.setAttribute('data-delta', '-1');
      var qtyVal = document.createElement('span');
      qtyVal.className = 'qty-value';
      qtyVal.textContent = item.qty;
      var plus = document.createElement('button');
      plus.className = 'btn-qty';
      plus.textContent = '+';
      plus.setAttribute('data-action', 'cart-qty');
      plus.setAttribute('data-sku', item.sku);
      plus.setAttribute('data-delta', '1');
      qtyRow.appendChild(minus);
      qtyRow.appendChild(qtyVal);
      qtyRow.appendChild(plus);

      left.appendChild(name);
      left.appendChild(meta);
      left.appendChild(qtyRow);

      var right = document.createElement('div');
      right.className = 'build-item-right';
      var rm = document.createElement('button');
      rm.className = 'btn-remove';
      rm.textContent = 'Remove';
      rm.setAttribute('data-action', 'cart-remove');
      rm.setAttribute('data-sku', item.sku);
      right.appendChild(rm);

      li.appendChild(left);
      li.appendChild(right);
      list.appendChild(li);
    });
    totalRow.style.display = 'flex';
    totalValue.textContent = '$' + total.toLocaleString('en-US');
    quoteBtn.disabled = false;
  }

  actions['build-quote'] = function () {
    if (mbCart.length === 0) return;
    var lines = mbCart.map(function (i) {
      return '\u2022 ' + i.name + ' (' + i.subtitle + '); ' + i.qty + 'x @ $' + i.price;
    }).join('\n');
    var total = mbCart.reduce(function (sum, i) { return sum + i.price * i.qty; }, 0);
    _currentSku = mbCart.map(function (i) { return i.sku; }).join(', ');
    document.getElementById('preorder-sku').textContent =
      'LOCALAI BUILD \u00b7 ' + mbCart.length + ' node(s) \u00b7 $' + total.toLocaleString('en-US');
    document.getElementById('po-usecase').value =
      'QSSI LocalAI build quote:\n' + lines +
      '\n\nEstimated build total: $' + total.toLocaleString('en-US') +
      '\n\nPlease confirm availability, configuration options, and volume pricing.';
    document.getElementById('preorder-modal').classList.add('open');
  };

  /* ── Pre-order submit ── */
  var poSubmit = document.getElementById('po-submit');
  if (poSubmit) {
    poSubmit.addEventListener('click', async function () {
      const btn = this;
      const statusEl = document.getElementById('po-status');
      const name  = document.getElementById('po-name').value.trim();
      const email = document.getElementById('po-email').value.trim();
      if (!name || !email) {
        formFeedback(btn, statusEl, 'error', 'Name and email are required.');
        return;
      }
      formFeedback(btn, statusEl, 'loading');
      const { error } = await db.from('preorders').insert({
        name,
        email,
        organisation: document.getElementById('po-org').value.trim() || null,
        country:      document.getElementById('po-country').value.trim() || null,
        sku:          _currentSku,
        quantity:     parseInt(document.getElementById('po-qty').value),
        use_case:     document.getElementById('po-usecase').value.trim() || null
      });
      if (error) {
        formFeedback(btn, statusEl, 'error', 'Submission failed; please email admin@quantumindssi.com');
      } else {
        formFeedback(btn, statusEl, 'success', "Slot reserved. We'll be in touch within 48 hours.");
        setTimeout(function () {
          document.getElementById('preorder-modal').classList.remove('open');
        }, 2500);
      }
    });
  }

  /* ── Waitlist submit ── */
  var wlSubmit = document.getElementById('wl-submit');
  if (wlSubmit) {
    wlSubmit.addEventListener('click', async function () {
      const btn = this;
      const statusEl = document.getElementById('wl-status');
      const name  = document.getElementById('wl-name').value.trim();
      const email = document.getElementById('wl-email').value.trim();
      if (!name || !email) {
        formFeedback(btn, statusEl, 'error', 'Name and email are required.');
        return;
      }
      formFeedback(btn, statusEl, 'loading');
      const { error } = await db.from('heimdall_waitlist').insert({
        name, email,
        organisation: document.getElementById('wl-org').value.trim() || null,
        country:      document.getElementById('wl-country').value.trim() || null,
        variant:      document.getElementById('wl-variant').value || null,
        use_case:     document.getElementById('wl-usecase').value.trim() || null
      });
      if (error) {
        formFeedback(btn, statusEl, 'error', 'Submission failed; please email admin@quantumindssi.com');
      } else {
        formFeedback(btn, statusEl, 'success', "You're on the waitlist. We'll contact you before launch.");
        setTimeout(function () {
          document.getElementById('waitlist-modal').classList.remove('open');
        }, 2500);
      }
    });
  }
})();
