/*
 * EICT prayer times - plain ES5 for old iPads (iOS 9 Safari).
 * No fetch, no arrow functions, no let/const, no Intl.
 *
 * Times in times.json are London wall-clock times. "London now" is worked out
 * from UTC plus the UK daylight-saving rule, so it is correct even if the
 * iPad's own time zone setting is wrong.
 */
(function () {
  'use strict';

  var PRAYERS = ['fajr', 'zuhr', 'asr', 'maghrib', 'isha'];          // prayers that trigger alerts
  var ROWS = ['fajr', 'sunrise', 'zuhr', 'asr', 'maghrib', 'isha'];   // rows shown in the table
  var NAMES = { fajr: 'Fajr', sunrise: 'Sunrise', zuhr: 'Zuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha' };
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  var ALERT_WINDOW = 90;              // seconds: skip alerts that are older than this (e.g. after a long pause)
  var REFRESH_MS = 20 * 60 * 1000;    // reload times.json this often
  var RETRY_MS = 5 * 60 * 1000;       // retry this often while the data is for an earlier day
  var CACHE_KEY = 'eict-times-v1';

  var data = null;
  var events = [];
  var lastFetch = 0;
  var fetching = false;
  var fired = {};
  var firedDay = '';
  var lastSec = null;
  var soundReady = false;
  var soundProblem = false;
  var audioMissing = '';
  var alertInfo = null;               // { text: string, until: ms }
  var shownState = '';                // remembers table highlight state to avoid needless DOM writes
  var stopStamp = 0;                  // when the user last pressed Stop

  function $(id) { return document.getElementById(id); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------- London time without Intl ---------- */

  // 01:00 UTC on the last Sunday of the given month (month is 0-based)
  function lastSundayUTC(year, month) {
    var d = new Date(Date.UTC(year, month + 1, 0, 1, 0, 0));
    return d.getTime() - d.getUTCDay() * 86400000;
  }
  function londonOffsetMs(utcMs) {
    var y = new Date(utcMs).getUTCFullYear();
    var start = lastSundayUTC(y, 2);    // clocks go forward (BST starts)
    var end = lastSundayUTC(y, 9);      // clocks go back (GMT returns)
    return (utcMs >= start && utcMs < end) ? 3600000 : 0;
  }
  // Returns a Date whose UTC fields hold the London wall-clock time. Read it with getUTC* only.
  function londonDate(utcMs) {
    return new Date(utcMs + londonOffsetMs(utcMs));
  }
  function dayKey(d) {
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  function secOfDay(d) {
    return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
  }
  function parseHM(s) {
    var p = String(s).split(':');
    return parseInt(p[0], 10) * 3600 + parseInt(p[1], 10) * 60;
  }

  /* ---------- Formatting ---------- */

  function fmt12(sec, withSeconds) {
    var h = Math.floor(sec / 3600) % 24;
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    var ap = h >= 12 ? 'pm' : 'am';
    var h12 = h % 12;
    if (h12 === 0) { h12 = 12; }
    return h12 + ':' + pad2(m) + (withSeconds ? ':' + pad2(s) : '') + '<span class="ap">' + ap + '</span>';
  }
  function fmtCount(sec) {
    if (sec < 0) { sec = 0; }
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    return h > 0 ? h + ':' + pad2(m) + ':' + pad2(s) : m + ':' + pad2(s);
  }
  function fmtKeyDate(key) {            // "2026-10-27" -> "27 Oct 2026"
    var p = key.split('-');
    return parseInt(p[2], 10) + ' ' + MONTHS[parseInt(p[1], 10) - 1].substring(0, 3) + ' ' + p[0];
  }
  function setText(node, text) {
    if (node.textContent !== text) { node.textContent = text; }
  }
  function setHtml(node, html) {
    if (node.innerHTML !== html) { node.innerHTML = html; }
  }
  function show(node, visible) {
    var v = visible ? 'block' : 'none';
    if (node.style.display !== v) { node.style.display = v; }
  }

  /* ---------- Data ---------- */

  function validData(d) {
    var i, p;
    if (!d || !d.prayers || !d.date) { return false; }
    for (i = 0; i < PRAYERS.length; i++) {
      p = d.prayers[PRAYERS[i]];
      if (!p || !/^\d{1,2}:\d{2}$/.test(p.start)) { return false; }
      if (p.jamaah && !/^\d{1,2}:\d{2}$/.test(p.jamaah)) { return false; }
    }
    return true;
  }

  function buildEvents() {
    var list = [], i, p, t;
    for (i = 0; i < PRAYERS.length; i++) {
      p = PRAYERS[i];
      t = data.prayers[p];
      list.push({ key: p, type: 'azan', sec: parseHM(t.start) });
      if (t.jamaah) { list.push({ key: p, type: 'jamaah', sec: parseHM(t.jamaah) }); }
    }
    list.sort(function (a, b) { return a.sec - b.sec; });
    return list;
  }

  function useData(d) {
    data = d;
    events = buildEvents();
    shownState = '';
    renderTable();
  }

  function saveCache(text) {
    try { window.localStorage.setItem(CACHE_KEY, text); } catch (e) { /* storage can be unavailable */ }
  }
  function loadCache() {
    try {
      var text = window.localStorage.getItem(CACHE_KEY);
      if (text) {
        var d = JSON.parse(text);
        if (validData(d)) { useData(d); }
      }
    } catch (e) { /* ignore */ }
  }

  function loadTimes() {
    var xhr;
    fetching = true;
    lastFetch = Date.now();
    try {
      xhr = new XMLHttpRequest();
      xhr.open('GET', 'times.json?t=' + Date.now(), true);
      xhr.onreadystatechange = function () {
        var d;
        if (xhr.readyState !== 4) { return; }
        fetching = false;
        if (xhr.status === 200 && xhr.responseText) {
          try {
            d = JSON.parse(xhr.responseText);
            if (validData(d)) {
              saveCache(xhr.responseText);
              useData(d);
              tick();
            }
          } catch (e) { /* keep the last known times */ }
        }
      };
      xhr.send();
    } catch (e2) {
      fetching = false;
    }
  }

  /* ---------- Table ---------- */

  function renderTable() {
    var i, k, row, t;
    if (!data) { return; }
    for (i = 0; i < ROWS.length; i++) {
      k = ROWS[i];
      row = $('row-' + k);
      t = data.prayers[k];
      if (!t) { continue; }
      setHtml(row.getElementsByTagName('td')[0], fmt12(parseHM(t.start), false));
      setHtml(row.getElementsByTagName('td')[1], t.jamaah ? fmt12(parseHM(t.jamaah), false) : '');
    }
  }

  function paintRows(nextKey, sec) {
    var i, k, row, t, last, cls, state = nextKey + '|';
    for (i = 0; i < ROWS.length; i++) {
      k = ROWS[i];
      t = data.prayers[k];
      if (!t) { continue; }
      last = parseHM(t.jamaah || t.start);
      cls = (k === 'sunrise' ? 'minor ' : '');
      if (k === nextKey) { cls += 'next'; }
      else if (last < sec) { cls += 'past'; }
      state += cls + ',';
    }
    if (state === shownState) { return; }
    shownState = state;
    for (i = 0; i < ROWS.length; i++) {
      k = ROWS[i];
      t = data.prayers[k];
      if (!t) { continue; }
      last = parseHM(t.jamaah || t.start);
      cls = (k === 'sunrise' ? 'minor ' : '');
      if (k === nextKey) { cls += 'next'; }
      else if (last < sec) { cls += 'past'; }
      $('row-' + k).className = cls;
    }
  }

  /* ---------- Audio ---------- */

  var audioAzan, audioChime;

  function primeAudio(a) {
    try {
      a.play();
      a.pause();
      a.currentTime = 0;
    } catch (e) { /* ignore */ }
  }

  function unlockAudio() {
    primeAudio(audioAzan);
    primeAudio(audioChime);
    soundReady = true;
    soundProblem = false;
    show($('unlock'), false);
    updateBanners(londonDate(Date.now()));
  }

  function playAudio(a) {
    var p;
    try {
      a.currentTime = 0;
    } catch (e) { /* not seekable yet */ }
    try {
      p = a.play();
      if (p && typeof p.catch === 'function') {
        p.catch(function () { flagSoundProblem(); });
      }
    } catch (e2) {
      flagSoundProblem();
    }
    window.setTimeout(function () {
      if (a.paused && !a.ended && a.currentTime === 0 && Date.now() - stopStamp > 4000) { flagSoundProblem(); }
    }, 2500);
  }

  function flagSoundProblem() {
    soundProblem = true;
    updateBanners(londonDate(Date.now()));
  }

  function stopAudio() {
    var list = [audioAzan, audioChime], i;
    stopStamp = Date.now();
    for (i = 0; i < list.length; i++) {
      try { list[i].pause(); list[i].currentTime = 0; } catch (e) { /* ignore */ }
    }
    alertInfo = null;
  }

  function watchAudioErrors(a, label, file) {
    a.addEventListener('error', function () {
      audioMissing = label + ' file not found. Add ' + file + '.';
    }, false);
  }

  /* ---------- Alerts ---------- */

  function fireEvent(ev, day) {
    var k = day + '|' + ev.key + '|' + ev.type;
    if (fired[k]) { return; }
    fired[k] = true;
    if (ev.type === 'azan') {
      alertInfo = { text: 'Azan: ' + NAMES[ev.key], until: Date.now() + 6 * 60 * 1000 };
      playAudio(audioAzan);
    } else {
      alertInfo = { text: 'Jama\u2019ah: ' + NAMES[ev.key], until: Date.now() + 90 * 1000 };
      playAudio(audioChime);
    }
  }

  function checkAlerts(day, sec) {
    var i, ev;
    if (day !== firedDay) {
      fired = {};
      firedDay = day;
      lastSec = sec;
      return;
    }
    if (lastSec === null) { lastSec = sec; return; }
    for (i = 0; i < events.length; i++) {
      ev = events[i];
      if (ev.sec > lastSec && ev.sec <= sec && (sec - ev.sec) <= ALERT_WINDOW) {
        fireEvent(ev, day);
      }
    }
    lastSec = sec;
  }

  /* ---------- Screen updates ---------- */

  function nextEvent(sec) {
    var i;
    for (i = 0; i < events.length; i++) {
      if (events[i].sec > sec) { return events[i]; }
    }
    return null;
  }

  function updateNext(sec) {
    var box = $('next'), label = $('next-label'), count = $('next-count');
    var ev, tomorrow, nowMs = Date.now();

    if (!data) {
      setText(label, 'Loading prayer times');
      setHtml(count, '&nbsp;');
      return;
    }
    if (alertInfo && alertInfo.until < nowMs) { alertInfo = null; }

    if (alertInfo) {
      box.className = 'alert';
      setText(label, alertInfo.text);
      setText(count, 'Now');
      count.className = 'pulse';
      paintRows(keyFromAlert(), sec);
      return;
    }
    box.className = '';
    count.className = '';

    ev = nextEvent(sec);
    if (ev) {
      setText(label, NAMES[ev.key] + (ev.type === 'azan' ? ' adhan in' : ' jama\u2019ah in'));
      setText(count, fmtCount(ev.sec - sec));
      paintRows(ev.key, sec);
    } else {
      tomorrow = 86400 - sec + parseHM(data.prayers.fajr.start);
      setText(label, 'Fajr adhan tomorrow in about');
      setText(count, fmtCount(tomorrow));
      paintRows('fajr', -1);
    }
  }

  function keyFromAlert() {
    var i, text = alertInfo ? alertInfo.text : '';
    for (i = 0; i < PRAYERS.length; i++) {
      if (text.indexOf(NAMES[PRAYERS[i]]) !== -1) { return PRAYERS[i]; }
    }
    return '';
  }

  function updateBanners(now) {
    var day = dayKey(now), msg = '';
    show($('banner-sound'), !soundReady || soundProblem);
    if (data && data.date !== day) {
      msg = 'Showing times for ' + fmtKeyDate(data.date) + '. Waiting for today\u2019s times to update.';
    } else if (data && data.updated_ts && (Date.now() / 1000 - data.updated_ts) > 3 * 86400) {
      msg = 'Times have not been refreshed since ' + fmtKeyDate(data.date) + '. Check the GitHub Action.';
    }
    setText($('banner-stale'), msg);
    show($('banner-stale'), msg !== '');
  }

  function updateStatus(now, day) {
    var parts = [], u;
    if (audioMissing) { parts.push(audioMissing); }
    if (data) {
      parts.push('Times for ' + fmtKeyDate(data.date));
      if (data.updated_ts) {
        u = londonDate(data.updated_ts * 1000);
        parts.push('updated ' + u.getUTCDate() + ' ' + MONTHS[u.getUTCMonth()].substring(0, 3) + ' ' + pad2(u.getUTCHours()) + ':' + pad2(u.getUTCMinutes()));
      }
    }
    parts.push(soundReady && !soundProblem ? 'sound on' : 'sound off');
    setText($('status'), parts.join(', '));
  }

  function tick() {
    var utc = Date.now();
    var now = londonDate(utc);
    var day = dayKey(now);
    var sec = secOfDay(now);
    var due;

    setHtml($('clock'), fmt12(sec, true));
    setText($('date'), DAYS[now.getUTCDay()] + ' ' + now.getUTCDate() + ' ' + MONTHS[now.getUTCMonth()] + ' ' + now.getUTCFullYear());
    setText($('hijri'), data && data.hijri && data.date === day ? data.hijri : '');

    if (data) { checkAlerts(day, sec); }
    updateNext(sec);
    updateBanners(now);
    updateStatus(now, day);

    if (!fetching) {
      if (!data) { due = utc - lastFetch > 15000; }
      else if (data.date !== day) { due = utc - lastFetch > RETRY_MS; }
      else { due = utc - lastFetch > REFRESH_MS; }
      if (due) { loadTimes(); }
    }
  }

  /* ---------- Start ---------- */

  function init() {
    audioAzan = $('azan');
    audioChime = $('chime');
    watchAudioErrors(audioAzan, 'Azan', 'audio/azan.mp3');
    watchAudioErrors(audioChime, 'Chime', 'audio/chime.wav');
    audioAzan.addEventListener('ended', function () { alertInfo = null; }, false);

    $('unlock-btn').onclick = unlockAudio;
    $('banner-sound').onclick = function () { show($('unlock'), true); };
    $('t-azan').onclick = function () { unlockAudio(); stopAudio(); stopStamp = 0; playAudio(audioAzan); };
    $('t-chime').onclick = function () { unlockAudio(); stopAudio(); stopStamp = 0; playAudio(audioChime); };
    $('t-stop').onclick = function () { stopAudio(); };

    loadCache();
    tick();
    window.setInterval(tick, 1000);

    document.addEventListener('visibilitychange', function () { if (!document.hidden) { tick(); } }, false);
    window.addEventListener('pageshow', function () { tick(); }, false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, false);
  } else {
    init();
  }
}());
