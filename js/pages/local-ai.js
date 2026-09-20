/* LocalAI build cart + consultation modal.
   Extracted from local-ai.html so the CSP can drop 'unsafe-inline'.
   Markup declares:
     data-action="consult-open" data-tier="mac-mini|amd-node|nvidia-super"
     data-action="cart-toggle"  data-sku="…"
     data-action="build-quote"
     data-close="consult-modal"
   Generated cart rows use programmatic listeners, never handler attributes. */
(function () {
  'use strict';

  window.QSSI = window.QSSI || {};
  window.QSSI.actions = window.QSSI.actions || {};

  var consultTierMap = {
    'mac-mini': 'Mac Mini Instance',
    'amd-node': 'AMD Node Instance',
    'nvidia-super': 'NVIDIA Supercomputing'
  };

  function openConsultModal(tier) {
    if (tier && consultTierMap[tier]) {
      document.getElementById('ci-tier').value = consultTierMap[tier];
    }
    document.getElementById('consult-modal').classList.add('open');
  }

  window.QSSI.actions['consult-open'] = function (el) {
    openConsultModal(el.getAttribute('data-tier') || '');
  };

  var build = {};

  window.QSSI.actions['cart-toggle'] = function (el) {
    var sku = el.getAttribute('data-sku');
    if (!sku) return;
    var card = document.querySelector('.mb-cart-card[data-sku="' + sku + '"]');
    if (build[sku]) {
      delete build[sku];
    } else if (card) {
      build[sku] = {
        name: card.getAttribute('data-name'),
        price: parseInt(card.getAttribute('data-price'), 10) || 0,
        qty: 1
      };
    }
    document.querySelectorAll('.mb-cart-card').forEach(function (elCard) {
      var active = !!build[elCard.getAttribute('data-sku')];
      var btn = elCard.querySelector('.btn-mb-add');
      elCard.classList.toggle('selected', active);
      if (btn) {
        btn.classList.toggle('added', active);
        btn.textContent = active ? 'Added to Build' : 'Add to Build';
      }
    });
    renderBuild();
  };

  function adjustMbQty(sku, delta) {
    if (!build[sku]) return;
    build[sku].qty = Math.max(1, (build[sku].qty || 1) + delta);
    renderBuild();
  }

  function renderBuild() {
    var list = document.getElementById('build-list');
    var totalEl = document.getElementById('build-total');
    var valueEl = document.getElementById('build-total-value');
    var quoteBtn = document.getElementById('btn-quote');
    var skus = Object.keys(build);
    var total = 0;
    list.innerHTML = '';
    skus.forEach(function (sku) {
      var item = build[sku];
      total += item.price * item.qty;
      var li = document.createElement('li');
      li.className = 'build-item';
      var left = document.createElement('div');
      var name = document.createElement('div');
      name.className = 'build-item-name';
      name.textContent = item.name;
      var meta = document.createElement('div');
      meta.className = 'build-item-meta';
      meta.textContent = sku;
      left.appendChild(name);
      left.appendChild(meta);
      var row = document.createElement('div');
      row.className = 'qty-row';
      var minus = document.createElement('button');
      minus.type = 'button';
      minus.className = 'btn-qty';
      minus.textContent = '\u2212';
      minus.addEventListener('click', function () { adjustMbQty(sku, -1); });
      var val = document.createElement('span');
      val.className = 'qty-value';
      val.textContent = item.qty;
      var plus = document.createElement('button');
      plus.type = 'button';
      plus.className = 'btn-qty';
      plus.textContent = '+';
      plus.addEventListener('click', function () { adjustMbQty(sku, 1); });
      row.appendChild(minus);
      row.appendChild(val);
      row.appendChild(plus);
      var right = document.createElement('div');
      right.className = 'build-item-right';
      var price = document.createElement('span');
      price.className = 'build-item-meta';
      price.textContent = '$' + (item.price * item.qty);
      var rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'btn-remove';
      rm.textContent = 'Remove';
      rm.addEventListener('click', function () {
        delete build[sku];
        renderBuild();
      });
      right.appendChild(price);
      right.appendChild(rm);
      li.appendChild(left);
      li.appendChild(row);
      li.appendChild(right);
      list.appendChild(li);
    });
    if (!skus.length) {
      var empty = document.createElement('li');
      empty.className = 'build-empty';
      empty.textContent = 'No motherboards selected yet.';
      list.appendChild(empty);
    }
    totalEl.style.display = skus.length ? 'flex' : 'none';
    valueEl.textContent = '$' + total;
    quoteBtn.disabled = !skus.length;
  }

  window.QSSI.actions['build-quote'] = function () {
    var skus = Object.keys(build);
    if (!skus.length) return;
    var lines = skus.map(function (sku) {
      return build[sku].qty + 'x ' + build[sku].name + ' (' + sku + ')';
    });
    document.getElementById('ci-message').value =
      'Build request:\n' + lines.join('\n') + '\n---\nDetails confirmed in consultation.';
    openConsultModal('general');
  };

  var submit = document.getElementById('ci-submit');
  if (submit) {
    submit.addEventListener('click', async function () {
      const btn = this;
      const statusEl = document.getElementById('ci-status');
      const name  = document.getElementById('ci-name').value.trim();
      const email = document.getElementById('ci-email').value.trim();
      if (!name || !email) {
        formFeedback(btn, statusEl, 'error', 'Name and email are required.');
        return;
      }
      formFeedback(btn, statusEl, 'loading');
      const { error } = await db.from('sales_enquiries').insert({
        name,
        email,
        organisation:     document.getElementById('ci-org').value.trim() || null,
        country:          document.getElementById('ci-country').value.trim() || null,
        enquiry_type:     'local-ai',
        deployment_scale: document.getElementById('ci-tier').value || null,
        industry:         document.getElementById('ci-sector').value || null,
        message:          document.getElementById('ci-message').value.trim() || null
      });
      if (error) {
        formFeedback(btn, statusEl, 'error', 'Submission failed; please email admin@quantumindssi.com');
      } else {
        formFeedback(btn, statusEl, 'success', "Consultation request received. We'll be in touch within 24 hours.");
        setTimeout(function () {
          document.getElementById('consult-modal').classList.remove('open');
        }, 2800);
      }
    });
  }
})();
