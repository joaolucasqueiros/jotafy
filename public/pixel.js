/* MetaTrack pixel v1. Consent must be granted explicitly by your CMP before init. */
(function () {
  'use strict';
  // The same script can be included twice by a page builder. Keep one instance.
  if (window.MetaTrack) return;
  var script = document.currentScript;
  var endpoint = script ? new URL(script.src).origin + '/api/tracking' : '';
  var settings, current, session, active = false;
  function uuid() { return crypto.randomUUID(); }
  function cookie(name) { return document.cookie.split('; ').find(function (v) { return v.startsWith(name + '='); })?.slice(name.length + 1); }
  function save() { try { localStorage.setItem('mt_attribution', JSON.stringify(current)); } catch (_) {} }
  function init(options) {
    if (!options || options.consent !== true || !options.key || !endpoint) return;
    if (active && settings.key === options.key) return;
    settings = options; active = true;
    var p = new URL(location.href).searchParams, stored;
    try { stored = JSON.parse(localStorage.getItem('mt_attribution') || 'null'); } catch (_) {}
    var campaignClick = p.has('fbclid') || p.has('utm_campaign');
    current = !campaignClick && stored && stored.expires > Date.now() ? stored : {
      clickId: uuid(), expires: Date.now() + 90 * 86400000,
      utm_source: p.get('utm_source') || undefined, utm_medium: p.get('utm_medium') || undefined,
      utm_campaign: p.get('utm_campaign') || undefined, utm_term: p.get('utm_term') || undefined, utm_content: p.get('utm_content') || undefined,
      fbc: p.get('fbclid') ? 'fb.1.' + Date.now() + '.' + p.get('fbclid') : cookie('_fbc'),
      fbp: cookie('_fbp') || 'fb.1.' + Date.now() + '.' + Math.floor(Math.random() * 1e10)
    };
    save(); track('PageView');
  }
  function track(name, options) {
    if (!active || !current || !['PageView','ViewContent','InitiateCheckout','Purchase'].includes(name)) return Promise.resolve();
    try { session = JSON.parse(sessionStorage.getItem('mt_session') || 'null'); } catch (_) {}
    if (!session || session.expires <= Date.now()) session = {id: uuid()};
    session.expires = Date.now() + 30 * 60000;
    try { sessionStorage.setItem('mt_session', JSON.stringify(session)); } catch (_) {}
    var eventId = options?.eventId || uuid();
    var data = Object.assign({}, current, {key:settings.key,consent:true,event:name,eventId:eventId,sessionId:session.id,occurredAt:new Date().toISOString(),isTest:settings.isTest === true,url:location.href});
    delete data.expires;
    return fetch(endpoint + '?key=' + encodeURIComponent(settings.key), {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),keepalive:true,credentials:'omit'}).catch(function () {});
  }
  function decorateCheckout(link) {
    if (!active || !current) return link;
    var u = new URL(link, location.href);
    if (!['https:','http:'].includes(u.protocol)) return link;
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content'].forEach(function (key) { if (current[key]) u.searchParams.set(key, current[key]); });
    u.searchParams.set('mt_click',current.clickId);
    return u.toString();
  }
  function revoke() { active = false; current = null; session = null; try { localStorage.removeItem('mt_attribution'); sessionStorage.removeItem('mt_session'); } catch (_) {} }
  window.MetaTrack = {init:init,track:track,decorateCheckout:decorateCheckout,revoke:revoke};
}());
