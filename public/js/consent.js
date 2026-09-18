/*
 * Cookie consent for txtllms.com
 *
 * Nothing that tracks a visitor loads until consent is granted. The three
 * analytics tools named in the Privacy Policy are booted from loadAnalytics()
 * below and from nowhere else - if you add a fourth, add it here, and add it
 * to /privacy at the same time.
 */
(function () {
  'use strict';

  var KEY = 'txtllms_cookie_consent';
  var GA_ID = 'G-XZVZG1427H';
  var MIXPANEL_TOKEN = '16f9900d03a958ca11da118565aed556';
  var loaded = false;

  function read() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function write(v) {
    try { localStorage.setItem(KEY, v); } catch (e) {}
  }

  function inject(src, attrs) {
    var s = document.createElement('script');
    s.src = src;
    s.async = true;
    Object.keys(attrs || {}).forEach(function (k) { s.setAttribute(k, attrs[k]); });
    document.head.appendChild(s);
    return s;
  }

  function loadAnalytics() {
    if (loaded) return;
    loaded = true;

    // Google Analytics 4
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    inject('https://www.googletagmanager.com/gtag/js?id=' + GA_ID);
    window.gtag('js', new Date());
    window.gtag('config', GA_ID, { anonymize_ip: true });

    // Vercel Analytics
    window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
    inject('/_vercel/insights/script.js');

    // Mixpanel
    var mp = inject('https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js');
    mp.onload = function () {
      if (!window.mixpanel || !window.mixpanel.init) return;
      window.mixpanel.init(MIXPANEL_TOKEN, { debug: false, ip: false });
      window.mixpanel.track('Page View');
    };
  }

  function styles() {
    if (document.getElementById('cc-styles')) return;
    var css = document.createElement('style');
    css.id = 'cc-styles';
    css.textContent = [
      '.cc-banner{position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483000;',
      'max-width:720px;margin:0 auto;background:rgba(20,22,40,.98);color:#F5F7FF;',
      'border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:20px 22px;',
      'box-shadow:0 12px 40px rgba(0,0,0,.5);font-family:Inter,system-ui,sans-serif;',
      'font-size:.92rem;line-height:1.6;backdrop-filter:blur(8px)}',
      '.cc-banner h2{margin:0 0 6px;font-size:1rem;font-weight:600;color:#F5F7FF;',
      "font-family:'Space Grotesk',Inter,sans-serif}",
      '.cc-banner p{margin:0 0 14px;color:#B4B7C5}',
      '.cc-banner a{color:#6C63FF;text-decoration:underline}',
      '.cc-actions{display:flex;gap:10px;flex-wrap:wrap}',
      '.cc-btn{font:inherit;font-weight:600;cursor:pointer;border-radius:8px;',
      'padding:9px 18px;border:1px solid transparent;transition:opacity .2s}',
      '.cc-btn:hover{opacity:.85}',
      '.cc-accept{background:#6C63FF;color:#fff}',
      '.cc-reject{background:transparent;color:#B4B7C5;border-color:rgba(255,255,255,.18)}',
      '@media(max-width:520px){.cc-actions .cc-btn{flex:1 1 100%}}'
    ].join('');
    document.head.appendChild(css);
  }

  function close(el) { if (el && el.parentNode) el.parentNode.removeChild(el); }

  function banner() {
    styles();
    var el = document.createElement('div');
    el.className = 'cc-banner';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-label', 'Cookie consent');
    el.innerHTML =
      '<h2>Cookies on txtllms.com</h2>' +
      '<p>We use analytics cookies to understand how the generator is used. ' +
      'They are not needed to make the site work, so they stay off until you say yes. ' +
      'See our <a href="/privacy">Privacy Policy</a>.</p>' +
      '<div class="cc-actions">' +
      '<button type="button" class="cc-btn cc-accept">Accept analytics</button>' +
      '<button type="button" class="cc-btn cc-reject">Reject non-essential</button>' +
      '</div>';
    el.querySelector('.cc-accept').addEventListener('click', function () {
      write('granted'); close(el); loadAnalytics();
    });
    el.querySelector('.cc-reject').addEventListener('click', function () {
      write('denied'); close(el);
    });
    document.body.appendChild(el);
  }

  // Footer "Cookie settings" link re-opens the choice.
  window.txtllmsCookieSettings = function () {
    try { localStorage.removeItem(KEY); } catch (e) {}
    if (!document.querySelector('.cc-banner')) banner();
  };

  function start() {
    var choice = read();
    if (choice === 'granted') loadAnalytics();
    else if (choice !== 'denied') banner();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
