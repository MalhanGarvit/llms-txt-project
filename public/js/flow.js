/*
 * Progressive enhancement for the multi-step flows (/start, /check, /contact, /subscribe).
 *
 * Every flow works without this file: each step is a plain GET form whose action is
 * the next step's path. This script only makes it nicer for people:
 *   - carries answers from earlier steps forward, so the review page can show them
 *   - fills [data-echo="field"] elements with the matching query parameter
 *   - reports each step to Mixpanel, without field values
 */
(function () {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  // Bookkeeping fields every step sets for itself; never carried forward.
  var OWN = { flow: 1, step: 1, src: 1 };

  function track(name, props) {
    if (window.mixpanel && typeof window.mixpanel.track === 'function') {
      window.mixpanel.track(name, props || {});
    }
  }

  // 1. Carry earlier answers forward as hidden inputs.
  document.querySelectorAll('form[data-carry]').forEach(function (form) {
    // Snapshot the form's own fields first. Checking as we go would let the first
    // carried value of a repeated parameter (goal=a&goal=b) block the rest.
    var own = {};
    Array.prototype.forEach.call(form.elements, function (el) { if (el.name) own[el.name] = 1; });
    params.forEach(function (value, key) {
      if (OWN[key]) return;
      if (own[key]) return;
      var input = document.createElement('input');
      input.type = 'hidden';
      input.name = key;
      input.value = value;
      form.appendChild(input);
    });
  });

  // 2. Echo answers into the page. textContent, never innerHTML: these come from the URL.
  document.querySelectorAll('[data-echo]').forEach(function (el) {
    var keys = el.getAttribute('data-echo').split(',');
    var values = [];
    keys.forEach(function (k) {
      params.getAll(k.trim()).forEach(function (v) { if (v) values.push(v); });
    });
    if (values.length) el.textContent = values.join(', ');
  });

  // 3. Pre-select an entry-point value passed by a CTA (e.g. ?site=semrush).
  document.querySelectorAll('[data-prefill]').forEach(function (el) {
    var v = params.get(el.getAttribute('data-prefill'));
    if (v && !el.value) el.value = v;
  });

  // 4. Analytics: which flow and step, never what was typed.
  var page = document.body.getAttribute('data-flow-page');
  if (page) {
    track('Flow Step Viewed', {
      flow: document.body.getAttribute('data-flow'),
      step: page,
      src: params.get('src') || 'direct'
    });
  }
  document.querySelectorAll('form[data-flow]').forEach(function (form) {
    form.addEventListener('submit', function () {
      track('Flow Step Submitted', {
        flow: form.getAttribute('data-flow'),
        step: form.getAttribute('data-step')
      });
    });
  });
  document.querySelectorAll('[data-cta]').forEach(function (el) {
    el.addEventListener('click', function () {
      track('CTA Clicked', { cta: el.getAttribute('data-cta') });
    });
  });
})();
