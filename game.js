/* THE CROSS ROOM — game logic, UI, state (saved in localStorage). */
(function () {
  'use strict';

  /* ---------- helpers ---------- */
  var $ = function (s) { return document.querySelector(s); };
  var KEY = 'crossroom_mvp_v1';
  var DAY = 86400000;
  function pad(n) { return String(n).padStart(2, '0'); }
  function dayKey(ts) { var d = new Date(ts); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function endOfDay(ts) { var d = new Date(ts); d.setHours(23, 59, 59, 999); return d.getTime(); }
  function midnight(ts) { var d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function rint(a, b) { return Math.floor(rnd(a, b + 1)); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function uid() { return Math.random().toString(36).slice(2, 9); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  /* ---------- state ---------- */
  var reducedPref = false;
  try { reducedPref = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  function defaults() {
    return {
      run: 1, nails: 3, neglect: 0, fatalAt: rint(9, 12),
      goals: [], pending: null, log: [], runs: [],
      settings: { sound: true, intensity: 1, reduced: reducedPref, quick: false,
        skin: '#d8a274', hair: 'short', hairCol: '#17110e', beard: false,
        vowMode: true, vowRakat: 20 },
      worship: null, vow: null, introSeen: false, dead: false,
      lastPen: 0, runStart: Date.now(), runDone: 0
    };
  }
  function load() {
    var s = defaults();
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var o = JSON.parse(raw);
        s = Object.assign(s, o);
        s.settings = Object.assign(defaults().settings, o.settings || {});
      }
    } catch (e) {}
    return s;
  }
  var S = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
  function logAdd(type, text) {
    S.log.unshift({ t: Date.now(), type: type, text: text });
    if (S.log.length > 200) S.log.length = 200;
  }

  function streak() {
    var days = {};
    S.log.forEach(function (l) { if (l.type === 'done' || l.type === 'partial') days[dayKey(l.t)] = 1; });
    var n = 0, t = Date.now();
    if (!days[dayKey(t)]) t -= DAY;
    while (days[dayKey(t)]) { n++; t -= DAY; }
    return n;
  }

  /* ---------- view model for the renderer ---------- */
  var view = {
    nails: S.nails, droop: 0, neglect: S.neglect, mode: 'idle', intensity: S.settings.intensity, reduced: S.settings.reduced,
    glitch: 0, flicker: 1, shadowK: 1, shadowX: 238, ambient: 0.13, fade: 0, deathT: null, relFlash: 0
  };
  var mode = 'idle'; // idle | ask | dying | ritual
  var ev = { flickerUntil: 0, glitchUntil: 0, lungeUntil: 0, nextAt: 0 };
  var deathStart = 0, deathThud = false, deathDone = false;

  /* ---------- toast / whisper ---------- */
  var toastTimer = null;
  function toast(t) {
    var e = $('#toast'); e.textContent = t; e.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { e.classList.remove('show'); }, 3200);
  }
  function whisper(t) {
    var sp = el('div', 'wsp', t);
    sp.style.left = rint(6, 58) + '%'; sp.style.top = rint(12, 68) + '%';
    $('#whisper').appendChild(sp);
    setTimeout(function () { sp.remove(); }, 3300);
  }

  /* ---------- neglect / nails ---------- */
  var THRESH = [3, 5, 7, 9];
  function bumpNeglect(d) {
    var a = S.neglect;
    S.neglect = Math.max(0, a + d);
    if (d > 0) {
      THRESH.forEach(function (t) {
        if (a < t && S.neglect >= t && S.nails < 7) {
          S.nails++; logAdd('nail', 'Another nail.'); nailIn();
        }
      });
    }
    save(); refreshUI();
    if (S.neglect >= S.fatalAt && (mode === 'idle' || mode === 'ask')) startDeath();
  }
  function nailIn() {
    var now = performance.now();
    ev.glitchUntil = now + 450; ev.flickerUntil = now + 500;
    Sfx.thud(); Sfx.sting(0.35);
  }
  function releaseNail() {
    if (S.nails <= 0) return;
    var idx = S.nails - 1;
    S.nails--;
    Art.dropNail(idx); Sfx.release(); view.relFlash = 1;
    logAdd('release', 'A nail came out.');
    if (S.nails === 0) toast('Every nail is out. The Shadow is still watching.');
    save(); refreshUI();
  }

  /* ---------- goals ---------- */
  function activeGoals() { return S.goals.filter(function (g) { return !g.done; }); }
  function addGoal(text, dueKey) {
    text = text.trim(); if (!text) return false;
    if (activeGoals().length >= 5) { toast('Max 5 commitments. Finish one first.'); return false; }
    var now = Date.now(), due = null;
    if (dueKey === 'today') due = endOfDay(now);
    else if (dueKey === 'tomorrow') due = endOfDay(now + DAY);
    else if (dueKey === 'week') due = endOfDay(now + 7 * DAY);
    S.goals.push({ id: uid(), text: text.slice(0, 80), due: due, done: false, pen: false, created: now });
    logAdd('goal', 'Committed: ' + text); save(); refreshUI(); return true;
  }
  function completeGoal(id) {
    var g = S.goals.filter(function (x) { return x.id === id; })[0];
    if (!g || g.done) return;
    g.done = true; g.doneAt = Date.now(); S.runDone++;
    logAdd('done', 'Completed: ' + g.text);
    releaseNail(); bumpNeglect(-2);
    toast('Noted.');
  }
  function checkOverdue() {
    if (mode !== 'idle' && mode !== 'ask') return;
    var now = Date.now();
    if (now - S.lastPen < 20 * 60000) return;
    var g = S.goals.filter(function (x) { return !x.done && x.due && now > x.due && !x.pen; })
      .sort(function (a, b) { return a.due - b.due; })[0];
    if (!g) return;
    g.pen = true; S.lastPen = now;
    logAdd('neglect', 'Missed: ' + g.text);
    toast('A commitment went overdue.');
    ev.glitchUntil = performance.now() + 300;
    bumpNeglect(2);
  }

  /* ---------- HUD ---------- */
  function refreshUI() {
    $('#stNails').textContent = S.nails;
    $('#stGoals').textContent = activeGoals().length;
    $('#stStreak').textContent = streak();
    $('#stRun').textContent = S.run;
    view.nails = S.nails; view.neglect = S.neglect;
    view.intensity = S.settings.intensity; view.reduced = S.settings.reduced;
    var p = S.pending, box = $('#pending');
    if (p && mode !== 'dying' && mode !== 'ritual') {
      box.classList.remove('hidden');
      $('#pdText').textContent = p.task + ' — ' + p.text;
    } else { box.classList.add('hidden'); }
  }

  function updatePending() {
    var p = S.pending; if (!p) return;
    var rem = p.endsAt - Date.now(), box = $('#pending');
    if (rem > 0) {
      $('#pdTime').textContent = pad(Math.floor(rem / 60000)) + ':' + pad(Math.floor(rem / 1000) % 60);
      $('#pdLabel').textContent = 'ACTIVE STEP';
      box.classList.remove('alert');
    } else {
      $('#pdTime').textContent = '00:00';
      $('#pdLabel').textContent = 'TIME. REPORT HONESTLY.';
      box.classList.add('alert');
      if (!p.alerted) { p.alerted = true; save(); Sfx.bell(); whisper('Well?'); }
    }
  }

  /* ---------- reporting a step ---------- */
  var RULES = {
    aligned:  { done: -2, partial: -1, not: 1, rel: true },
    recovery: { done: -1, partial: 0, not: 1 },
    duty:     { done: -1, partial: 0, not: 0 },
    open:     { done: -1, partial: 0, not: 0 },
    avoid:    { done: -1, partial: 0, not: 1 }
  };
  function report(res) {
    var p = S.pending; if (!p || mode === 'dying' || mode === 'ritual') return;
    var r = RULES[p.verdict] || RULES.recovery;
    S.pending = null;
    var label = { done: 'Done', partial: 'Partly', not: 'Not done' }[res];
    logAdd(res === 'done' ? 'done' : (res === 'partial' ? 'partial' : 'notdone'), label + ': ' + p.task + ' — ' + p.text);
    if (res === 'done') { S.runDone++; if (r.rel) releaseNail(); }
    var d = r[res];
    toast({ done: 'Noted.', partial: 'Half is more than none.', not: 'Then begin again. Smaller.' }[res]);
    save();
    if (d !== 0) bumpNeglect(d); else refreshUI();
    refreshUI();
  }

  /* ---------- interrogation ---------- */
  var KINDS = { work: 'Work toward a goal', rest: 'Sleep / rest (conscious)', duty: 'Urgent duty / helping someone', leisure: 'Scrolling / games / distraction' };
  var RESTISH = /\b(sleep|sleeping|nap|rest|resting|ghum|ghumai|ghumano|ghumabo)\b|ঘুম|বিশ্রাম/i;
  var MOTIVES = { need: 'A real need', pleasure: 'Pleasure', fear: 'Fear / anxiety', tired: 'I am exhausted', avoid: 'Avoiding something', duty: 'Responsibility' };
  var COSTS = { forward: 'Moves something important forward', neutral: 'Neither gives nor costs much', cost: 'Costs something important', unknown: "I don't know" };
  var A = null, step = 0, nudge = null, typeTimer = null;

  function typeText(node, txt) {
    clearInterval(typeTimer); node.textContent = ''; var i = 0;
    typeTimer = setInterval(function () {
      i++; node.textContent = txt.slice(0, i);
      if (i % 2 === 0) Sfx.type();
      if (i >= txt.length) clearInterval(typeTimer);
    }, 22);
  }

  function choiceGroup(map, key) {
    var w = el('div', 'chs');
    Object.keys(map).forEach(function (k) {
      var b = el('button', 'ch' + (A[key] === k ? ' sel' : ''), map[k]); b.type = 'button';
      b.onclick = function () {
        A[key] = k;
        Array.prototype.forEach.call(w.children, function (x) { x.classList.remove('sel'); });
        b.classList.add('sel'); Sfx.click(); updNext();
      };
      w.appendChild(b);
    });
    return w;
  }
  function minutesGroup() {
    var w = el('div', 'chs');
    [5, 10, 25, 45].forEach(function (m) {
      var b = el('button', 'ch' + (A.minutes === m ? ' sel' : ''), m + ' min'); b.type = 'button';
      b.onclick = function () {
        A.minutes = m;
        Array.prototype.forEach.call(w.children, function (x) { x.classList.remove('sel'); });
        b.classList.add('sel'); Sfx.click(); updNext();
      };
      w.appendChild(b);
    });
    return w;
  }
  function textInput(key, ph, focus) {
    var i = el('input'); i.type = 'text'; i.maxLength = 80; i.placeholder = ph; i.value = A[key];
    i.oninput = function () { A[key] = i.value; updNext(); };
    i.onkeydown = function (e) { if (e.key === 'Enter' && !$('#dlgNext').disabled) $('#dlgNext').click(); };
    if (focus) setTimeout(function () { i.focus(); }, 60);
    return i;
  }

  var STEPS = [
    { q: 'What are you about to do?', sub: 'Name it. Plainly.',
      build: function (c, f) { c.appendChild(textInput('text', 'e.g. 25 minutes of coding', f)); c.appendChild(choiceGroup(KINDS, 'kind')); },
      valid: function () { return !!A.kind && A.text.trim().length > 1; } },
    { q: 'Why are you choosing this?', sub: 'What is really driving it?',
      build: function (c) { c.appendChild(choiceGroup(MOTIVES, 'motive')); },
      valid: function () { return !!A.motive; } },
    { q: 'What will it cost — or give you?', sub: 'Today. And later.',
      build: function (c) { c.appendChild(choiceGroup(COSTS, 'cost')); },
      valid: function () { return !!A.cost; } },
    { q: 'What is the smallest honest step?', sub: 'Not the whole task. The first move.',
      build: function (c, f) { c.appendChild(textInput('step', 'e.g. open the file and read the first error', f)); c.appendChild(minutesGroup()); },
      valid: function () { return A.step.trim().length > 1 && A.minutes > 0; } }
  ];

  function updNext() {
    var btn = $('#dlgNext');
    if (step === 4) { btn.disabled = false; return; }
    if (S.settings.quick) btn.disabled = !STEPS.every(function (s) { return s.valid(); });
    else btn.disabled = !STEPS[step].valid();
  }

  function startAsk() {
    Sfx.init();
    if (mode !== 'idle') return;
    if (S.pending) { toast('Finish what you started first.'); $('#pending').classList.add('alert'); return; }
    mode = 'ask'; view.mode = 'ask';
    A = { kind: '', text: '', motive: '', cost: '', step: '', minutes: 10 };
    step = 0;
    document.body.classList.add('asking');
    $('#dialogue').classList.remove('hidden');
    clearTimeout(nudge); nudge = setTimeout(function () { if (mode === 'ask') whisper('Deciding is not doing.'); }, 90000);
    if (S.settings.quick) renderQuick(); else renderStep();
  }
  function closeAsk() {
    clearTimeout(nudge); clearInterval(typeTimer);
    if (mode === 'ask') { mode = 'idle'; view.mode = 'idle'; }
    document.body.classList.remove('asking');
    $('#dialogue').classList.add('hidden');
  }

  function renderStep() {
    var s = STEPS[step], body = $('#dlgBody');
    $('#dlgTag').textContent = 'THE SHADOW \u00b7 INTERROGATION 0' + (step + 1) + '/04';
    typeText($('#dlgQ'), s.q); $('#dlgSub').textContent = s.sub;
    body.innerHTML = ''; s.build(body, true);
    $('#dlgBack').style.visibility = step === 0 ? 'hidden' : 'visible';
    $('#dlgNext').textContent = step === 3 ? 'FACE THE VERDICT \u25b8' : 'NEXT \u25b8';
    updNext();
  }
  function renderQuick() {
    var body = $('#dlgBody');
    $('#dlgTag').textContent = 'THE SHADOW \u00b7 QUICK MODE';
    $('#dlgQ').textContent = 'Four answers. Be fast. Be honest.'; $('#dlgSub').textContent = '';
    body.innerHTML = '';
    STEPS.forEach(function (s, i) {
      var sec = el('div', 'qsec'); sec.appendChild(el('label', null, (i + 1) + '. ' + s.q));
      s.build(sec, i === 0); body.appendChild(sec);
    });
    $('#dlgBack').style.visibility = 'hidden';
    $('#dlgNext').textContent = 'FACE THE VERDICT \u25b8';
    updNext();
  }

  function judge(a) {
    if (a.kind === 'leisure' && RESTISH.test(a.text)) { a = Object.assign({}, a, { kind: 'rest' }); } // "Sleep" is rest, not distraction
    var avoid =a.motive === 'avoid' || a.motive === 'fear', costly = a.cost === 'cost';
    function neg(line) { return { id: 'avoid', title: 'AVOIDANCE', line: line, delta: 2 }; }
    if (a.kind === 'work') {
      return { id: 'aligned', title: 'ALIGNED', delta: 0,
        line: avoid ? 'You chose work. But is this the thing you are avoiding, or a cleaner thing to hide behind?'
          : 'This serves what you said you wanted. Prove it.' };
    }
    if (a.kind === 'duty') return { id: 'duty', title: 'A DUTY', delta: 0, line: 'A duty is not a delay. Go. Come back after.' };
    if (a.kind === 'rest') {
      if (avoid) return neg('You call it rest. The motive says escape. Which is it?');
      return { id: 'recovery', title: 'RECOVERY', delta: 0, line: 'Rest, chosen with open eyes, is part of the work. No guilt.' };
    }
    if (avoid || costly) return neg('You know what you intended. What will you do differently now?');
    if (a.motive === 'tired' || a.motive === 'need') return { id: 'recovery', title: 'RECOVERY', delta: 0, line: 'Tired is real. Rest, then return.' };
    return { id: 'open', title: 'CHOSEN WITH OPEN EYES', delta: 0, line: 'Pleasure is allowed. Set a limit and keep it.' };
  }

  var J = null;
  function renderVerdict() {
    step = 4; J = judge(A);
    $('#dlgTag').textContent = 'THE VERDICT';
    typeText($('#dlgQ'), J.title);
    $('#dlgSub').textContent = J.line;
    var body = $('#dlgBody'); body.innerHTML = '';
    var v = el('div', 'verd');
    v.innerHTML = '<b>You:</b> ' + esc(KINDS[A.kind]) + ' \u2014 ' + esc(A.text) +
      '<br><b>Driven by:</b> ' + esc(MOTIVES[A.motive]) + '<br><b>Effect:</b> ' + esc(COSTS[A.cost]) +
      '<br><b>Your step:</b> ' + esc(A.step) + ' (' + A.minutes + ' min)' +
      (J.delta > 0 ? '<br><br>The Shadow keeps count. Not out loud.' : '');
    body.appendChild(v);
    $('#dlgBack').style.visibility = 'visible';
    $('#dlgNext').textContent = 'ACCEPT \u00b7 BEGIN ' + A.minutes + ' MIN \u25b8';
    $('#dlgNext').disabled = false;
  }

  function accept() {
    var now = Date.now();
    S.pending = { id: uid(), task: A.text.trim(), text: A.step.trim(), minutes: A.minutes, verdict: J.id,
      startedAt: now, endsAt: now + A.minutes * 60000, alerted: false };
    logAdd('ask', KINDS[A.kind] + ': ' + A.text.trim() + ' \u2192 ' + J.title);
    var d = J.delta;
    closeAsk(); save(); refreshUI(); updatePending();
    if (d > 0) bumpNeglect(d);
  }

  /* ---------- death & ritual ---------- */
  function startDeath() {
    if (mode === 'dying' || mode === 'ritual') return;
    closeAsk(); closeModal(true);
    mode = 'dying'; view.mode = 'dying';
    S.dead = true; S.pending = null; save();
    deathStart = performance.now(); deathThud = false; deathDone = false;
    Sfx.setHeart(0);
    logAdd('death', 'The sentence was carried out (fiction).');
    document.body.classList.add('locked');
    refreshUI();
  }

  function enterRitual() {
    mode = 'ritual'; view.mode = 'ritual'; view.deathT = null;
    document.body.classList.add('locked');
    openModal('THE SENTENCE WAS CARRIED OUT', renderRitual, false);
  }

  function renderRitual(b) {
    var avoided = S.goals.filter(function (g) { return !g.done; }).map(function (g) { return g.text; });
    var vt = S.settings.vowRakat || 20;
    var worshipHtml = S.settings.vowMode
      ? '<h4>Your vow</h4><p>Your own promise, set by you: <b>7 days of Tahajjud</b> + <b>' + vt + ' rak’at nafl every day</b> = <b>' + (vt * 7) + ' rak’at</b>. ' +
        'Miss a day and the 7 days begin again from day 1. It starts with the new run. (You can change this in Settings.)</p>'
      : '<h4>Optional &mdash; 7-day worship goal (voluntary)</h4>' +
        '<p class="hint">Never a punishment. Between you and Allah. Start small. A missed day just means begin again.</p>' +
        '<div class="row"><select id="rW"><option value="">None for now</option><option value="tahajjud">Tahajjud — as I am able</option>' +
        '<option value="fard">Five daily prayers — tracker</option><option value="nafl">Nafl prayers — my own number</option></select>' +
        '<input id="rR" type="number" min="2" max="40" step="2" placeholder="rak’at (e.g. 2, 8, 20)" style="max-width:190px"></div>';
    var h = '<p class="dim">This was fiction. You are fine. Your real habit history is kept.</p>' +
      '<h4>Run ' + S.run + ' &mdash; summary</h4>' +
      '<p>Commitments & steps completed: <b>' + S.runDone + '</b><br>Still unfinished: <b>' + (avoided.length ? esc(avoided.join(' · ')) : 'none') + '</b></p>' +
      '<h4>Ritual</h4>' +
      '<p>1. Which commitment did I keep avoiding?</p><textarea id="rA" placeholder="Be honest. One line.">' + esc(avoided[0] || '') + '</textarea>' +
      '<p>2. What one behavior will I change next run?</p><textarea id="rB"></textarea>' +
      '<p>3. What realistic commitment will I take for the next 7 days?</p><textarea id="rC"></textarea>' +
      worshipHtml +
      '<div class="row"><button id="rGo" type="button" class="primary">BEGIN NEW RUN \u25b8</button></div>';
    b.innerHTML = h;
    $('#rGo').onclick = function () {
      var a = $('#rA').value.trim(), bb = $('#rB').value.trim(), c = $('#rC').value.trim();
      var w = $('#rW') ? $('#rW').value : '', r = $('#rR') ? (parseInt($('#rR').value, 10) || 0) : 0;
      S.runs.unshift({ run: S.run, started: S.runStart, ended: Date.now(), completed: S.runDone, avoided: a, change: bb, commit: c });
      S.run++; S.nails = 3; S.neglect = 0; S.fatalAt = rint(9, 12); S.dead = false; S.pending = null;
      S.goals = S.goals.filter(function (g) { return !g.done; }).map(function (g) {
        g.pen = false; if (g.due) g.due = endOfDay(Date.now() + DAY); return g;
      });
      S.runDone = 0; S.runStart = Date.now(); S.lastPen = Date.now();
      if (c) addGoal(c, 'week');
      if (S.settings.vowMode) { S.vow = newVow(0); logAdd('vow', 'Vow begun: 7 days Tahajjud + ' + S.vow.target + ' rak’at/day.'); }
      else if (w) S.worship = { type: w, rakat: r, start: midnight(Date.now()), days: [false, false, false, false, false, false, false] };
      logAdd('run', 'New run begins.');
      save(); mode = 'idle'; view.mode = 'idle';
      document.body.classList.remove('locked');
      closeModal(true); refreshUI(); toast('New run. Begin small.');
    };
  }

  /* ---------- modal ---------- */
  var modalRender = null, modalClosable = true;
  function openModal(title, fn, closable) {
    modalRender = fn; modalClosable = closable !== false;
    $('#mTitle').textContent = title;
    $('#mClose').style.display = modalClosable ? '' : 'none';
    $('#modal').classList.remove('hidden');
    fn($('#mBody'));
  }
  function closeModal(force) {
    if (!force && !modalClosable) return;
    $('#modal').classList.add('hidden'); modalRender = null;
  }
  function rerenderModal() { if (modalRender && !$('#modal').classList.contains('hidden')) modalRender($('#mBody')); }

  function dueLabel(g) {
    if (!g.due) return 'no deadline';
    if (Date.now() > g.due) return 'OVERDUE';
    return 'due ' + new Date(g.due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function renderGoals(b) {
    var act = activeGoals(), done = S.goals.filter(function (g) { return g.done; });
    var h = '<p class="hint">Pick 1\u20133 commitments that truly matter (max 5). Finish one and a nail comes out.</p>' +
      '<div class="addrow"><input id="gText" type="text" maxlength="80" placeholder="e.g. Finish the login module">' +
      '<select id="gDue"><option value="today">Today</option><option value="tomorrow">Tomorrow</option><option value="week">This week</option><option value="none">No deadline</option></select>' +
      '<button id="gAdd" type="button" class="primary">ADD</button></div><div id="gList">';
    h += act.length ? act.map(function (g) {
      var over = g.due && Date.now() > g.due;
      return '<div class="goal' + (over ? ' over' : '') + '"><div class="g-main"><b>' + esc(g.text) + '</b><small>' + dueLabel(g) + '</small></div>' +
        '<div class="g-btns"><button type="button" data-a="done" data-id="' + g.id + '" class="primary" title="Completed">\u2713</button>' +
        '<button type="button" data-a="push" data-id="' + g.id + '" title="Re-commit +1 day">+1d</button>' +
        '<button type="button" data-a="del" data-id="' + g.id + '" title="Remove (no effect)">\u2715</button></div></div>';
    }).join('') : '<p class="dim">No active commitments.</p>';
    h += '</div>';
    if (done.length) h += '<h4>Completed this run (' + done.length + ')</h4>' + done.map(function (g) {
      return '<div class="goal done"><div class="g-main"><b>' + esc(g.text) + '</b></div></div>';
    }).join('');
    b.innerHTML = h;
    var doAdd = function () {
      var t = $('#gText').value;
      if (addGoal(t, $('#gDue').value)) rerenderModal();
    };
    $('#gAdd').onclick = doAdd;
    $('#gText').onkeydown = function (e) { if (e.key === 'Enter') doAdd(); };
    $('#gList').onclick = function (e) {
      var t = e.target.closest('button'); if (!t) return;
      var id = t.getAttribute('data-id'), a = t.getAttribute('data-a');
      if (a === 'done') completeGoal(id);
      else if (a === 'push') {
        var g = S.goals.filter(function (x) { return x.id === id; })[0];
        if (g) { g.due = endOfDay(Math.max(Date.now(), g.due || 0) + DAY); g.pen = false; save(); toast('Re-committed. Honestly this time.'); }
      } else if (a === 'del') { S.goals = S.goals.filter(function (x) { return x.id !== id; }); save(); }
      refreshUI(); rerenderModal();
    };
  }

  /* ---------- the vow: 7 days Tahajjud + nafl; miss a day => restart from day 1 ---------- */
  var VSHIFT = 6 * 3600000; // a "night" ends at 6:00 AM, so a 3 AM Tahajjud counts for that night
  function vowIdx(v) { return Math.round((midnight(Date.now() - VSHIFT) - v.start) / DAY); }
  function dayOk(d, target) { return d.t && d.n >= target; }
  function newVow(restarts) {
    var t = S.settings.vowRakat || 20, d = [];
    for (var i = 0; i < 7; i++) d.push({ t: false, n: 0 });
    return { start: midnight(Date.now() - VSHIFT), days: d, target: t, restarts: restarts || 0, done: false };
  }
  function checkVow() {
    var v = S.vow; if (!v || v.done) return;
    var idx = vowIdx(v);
    for (var i = 0; i < Math.min(idx, 7); i++) {
      if (!dayOk(v.days[i], v.target)) {
        S.vow = newVow(v.restarts + 1);
        logAdd('vow', 'A day was missed. The 7 days begin again from day 1.');
        save(); toast('A day was missed. The 7 days begin again.'); rerenderModal(); return;
      }
    }
    if (v.days.every(function (d) { return dayOk(d, v.target); })) {
      v.done = true; logAdd('vow', 'Vow complete: 7 days.'); save(); toast('Seven days complete. Alhamdulillah.');
    }
  }
  function renderVow(b) {
    var v = S.vow, idx = vowIdx(v), total = 0, i;
    v.days.forEach(function (d) { total += Math.min(d.n, v.target); });
    var h = '<p class="hint">Your own vow: <b>7 days of Tahajjud + ' + v.target + ' rak’at nafl every day</b> (' + (v.target * 7) +
      ' in all). Miss a day and it begins again from day 1. A day ends at 6:00 AM, so a night prayer after midnight still counts for that night.</p>' +
      '<p><b>' + total + ' / ' + (v.target * 7) + ' rak’at</b>' + (v.restarts ? ' <span class="dim">· restarts: ' + v.restarts + '</span>' : '') +
      (v.done ? ' · <b>COMPLETE</b>' : '') + '</p>';
    for (i = 0; i < 7; i++) {
      var d = v.days[i], dt = new Date(v.start + i * DAY), ok = dayOk(d, v.target), lock = i > idx ? ' disabled' : '';
      h += '<div class="goal' + (ok ? ' done' : '') + '"><div class="g-main"><b>Day ' + (i + 1) + ' · ' +
        dt.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) + (i === idx && !v.done ? ' ← today' : '') + '</b>' +
        '<small>' + (ok ? 'complete' : 'Tahajjud ' + (d.t ? '✓' : '—') + ' · nafl ' + d.n + '/' + v.target) + '</small></div>' +
        '<div class="g-btns"><button type="button" data-a="t" data-i="' + i + '"' + lock + (d.t ? ' class="primary"' : '') + '>TAHAJJUD</button>' +
        '<button type="button" data-a="m" data-i="' + i + '"' + lock + '>−2</button>' +
        '<button type="button" data-a="p" data-i="' + i + '"' + lock + '>+2</button>' +
        '<button type="button" data-a="f" data-i="' + i + '"' + lock + '>' + v.target + '</button></div></div>';
    }
    h += '<div class="row"><button type="button" data-a="' + (v.done ? 'clear' : 'quit') + '" class="danger">' + (v.done ? 'CLEAR' : 'ABANDON VOW') + '</button></div>';
    b.innerHTML = h;
    b.onclick = function (e) {
      var t = e.target.closest('button'); if (!t || t.disabled) return;
      var a = t.getAttribute('data-a'), i2 = +t.getAttribute('data-i');
      if (a === 'clear' || a === 'quit') {
        if (a === 'quit' && !confirm('Abandon the vow? It will not be counted.')) return;
        S.vow = null; save(); rerenderModal(); return;
      }
      var dd = v.days[i2]; if (!dd || i2 > idx) return;
      if (a === 't') dd.t = !dd.t;
      else if (a === 'm') dd.n = Math.max(0, dd.n - 2);
      else if (a === 'p') dd.n = Math.min(v.target, dd.n + 2);
      else if (a === 'f') dd.n = v.target;
      Sfx.click(); save(); checkVow(); rerenderModal();
    };
  }

  var WTYPES = { tahajjud: 'Tahajjud \u2014 as I am able', fard: 'Five daily prayers \u2014 tracker', nafl: 'Nafl prayers \u2014 my own number' };
  function renderSeven(b) {
    if (S.vow) { renderVow(b); return; }
    b.onclick = null;
    var w = S.worship;
    var h = '<p class="hint">A voluntary 7-day worship goal. It is <b>not connected</b> to the game: nothing here is a punishment, and a missed day only means you begin again.</p>';
    if (!w) {
      h += '<div class="row"><select id="wT"><option value="tahajjud">Tahajjud \u2014 as I am able</option><option value="fard">Five daily prayers \u2014 tracker</option><option value="nafl">Nafl prayers \u2014 my own number</option></select>' +
        '<input id="wR" type="number" min="2" max="40" step="2" placeholder="rak\u2019at per day (optional)" style="max-width:210px"></div>' +
        '<div class="row"><button id="wGo" type="button" class="primary">START 7 DAYS</button></div>';
      b.innerHTML = h;
      $('#wGo').onclick = function () {
        S.worship = { type: $('#wT').value, rakat: parseInt($('#wR').value, 10) || 0, start: midnight(Date.now()), days: [false, false, false, false, false, false, false] };
        save(); rerenderModal();
      };
      return;
    }
    var todayIdx = Math.round((midnight(Date.now()) - w.start) / DAY);
    var cnt = w.days.filter(Boolean).length;
    h += '<p><b>' + WTYPES[w.type] + '</b>' + (w.rakat ? ' \u00b7 ' + w.rakat + ' rak\u2019at' : '') + '<br><span class="dim">' + cnt + ' / 7 days</span></p><div class="days">';
    for (var i = 0; i < 7; i++) {
      var d = new Date(w.start + i * DAY);
      var cls = 'day' + (w.days[i] ? ' on' : '') + (i === todayIdx ? ' today' : '') + (i > todayIdx ? ' future' : '');
      h += '<button type="button" class="' + cls + '" data-i="' + i + '">' + d.toLocaleDateString(undefined, { weekday: 'short' }) + '<b>' + (w.days[i] ? '\u2713' : d.getDate()) + '</b></button>';
    }
    h += '</div>';
    if (todayIdx > 6) h += '<p>Seven days are over. May it be accepted. Start another when ready.</p>';
    h += '<div class="row"><button id="wReset" type="button">RESET / CHANGE GOAL</button></div>';
    b.innerHTML = h;
    Array.prototype.forEach.call(b.querySelectorAll('.day'), function (btn) {
      btn.onclick = function () {
        var i = +btn.getAttribute('data-i');
        if (i > todayIdx) return;
        w.days[i] = !w.days[i]; save(); Sfx.click(); rerenderModal();
      };
    });
    $('#wReset').onclick = function () { S.worship = null; save(); rerenderModal(); };
  }

  var ICON = { done: '\u2713', partial: '\u25d0', notdone: '\u2715', neglect: '!', nail: '\u2020', release: '\u2191', ask: '?', goal: '+', death: '\u2620', run: '\u25b8', vow: '\u262a' };
  function renderHistory(b) {
    var h = '<p>Run <b>' + S.run + '</b> \u00b7 completed this run: <b>' + S.runDone + '</b> \u00b7 streak: <b>' + streak() + '</b> day(s)</p>';
    if (S.runs.length) {
      h += '<h4>Past runs</h4>' + S.runs.map(function (r) {
        return '<div class="log"><i>\u2620</i><span>Run ' + r.run + ' \u2014 ' + r.completed + ' completed' + (r.avoided ? ' \u00b7 avoided: ' + esc(r.avoided) : '') + (r.change ? ' \u00b7 change: ' + esc(r.change) : '') + '</span></div>';
      }).join('');
    }
    h += '<h4>Recent</h4>';
    h += S.log.length ? S.log.slice(0, 40).map(function (l) {
      var d = new Date(l.t);
      return '<div class="log"><i>' + (ICON[l.type] || '\u00b7') + '</i><span class="t">' + d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + '</span><span>' + esc(l.text) + '</span></div>';
    }).join('') : '<p class="dim">Nothing yet.</p>';
    b.innerHTML = h;
  }

  var SKINS = ['#f1c9a5', '#d8a274', '#b97b4f', '#8d5a36', '#5f3b22'];
  var HAIRC = ['#17110e', '#3b2416', '#6b4423', '#c9a24b', '#8a8a8a'];
  function applyAppearance() {
    Art.setAppearance({ skin: S.settings.skin, hair: S.settings.hair, hairCol: S.settings.hairCol, beard: S.settings.beard });
  }
  function renderSettings(b) {
    var st = S.settings;
    var sw = function (arr, cur, k) {
      return '<div class="swatches">' + arr.map(function (c) {
        return '<button type="button" class="sw' + (c === cur ? ' sel' : '') + '" data-k="' + k + '" data-c="' + c + '" style="background:' + c + '"></button>';
      }).join('') + '</div>';
    };
    b.innerHTML =
      '<h4>Atmosphere</h4>' +
      '<div class="row"><label class="chk"><input type="checkbox" id="sSound"' + (st.sound ? ' checked' : '') + '> Sound</label>' +
      '<label class="chk"><input type="checkbox" id="sRed"' + (st.reduced ? ' checked' : '') + '> Reduced flashing</label>' +
      '<label class="chk"><input type="checkbox" id="sQuick"' + (st.quick ? ' checked' : '') + '> Quick mode (4 questions on one screen)</label></div>' +
      '<h4>Vow</h4><div class="row"><label class="chk"><input type="checkbox" id="sVow"' + (st.vowMode ? ' checked' : '') + '> After a death: 7 days Tahajjud + nafl daily (miss a day = restart)</label></div>' +
      '<div class="row">Nafl rak’at per day: <input id="sVowN" type="number" min="2" max="60" step="2" value="' + (st.vowRakat || 20) + '" style="max-width:90px"> <span class="hint">(applies to the next vow)</span></div>' +
      '<div class="row">Horror intensity: <select id="sInt"><option value="0">Low</option><option value="1">Medium</option><option value="2">Full</option></select></div>' +
      '<h4>Your likeness</h4><p class="dim">Skin</p>' + sw(SKINS, st.skin, 'skin') +
      '<p class="dim">Hair colour</p>' + sw(HAIRC, st.hairCol, 'hairCol') +
      '<div class="row">Hair: <select id="sHair"><option value="short">Short</option><option value="medium">Medium</option><option value="long">Long</option><option value="curly">Curly</option><option value="bald">Bald</option></select>' +
      '<label class="chk"><input type="checkbox" id="sBeard"' + (st.beard ? ' checked' : '') + '> Beard</label></div>' +
      '<h4>Data</h4><div class="row"><button id="sReset" type="button" class="danger">ERASE ALL DATA</button></div>' +
      '<p class="hint">Everything is stored only in this browser. This is a habit game, not therapy. If things feel heavy, please talk to someone you trust.</p>';
    $('#sInt').value = String(st.intensity); $('#sHair').value = st.hair;
    $('#sSound').onchange = function (e) { st.sound = e.target.checked; Sfx.setOn(st.sound); Sfx.init(); save(); };
    $('#sRed').onchange = function (e) { st.reduced = e.target.checked; save(); refreshUI(); };
    $('#sQuick').onchange = function (e) { st.quick = e.target.checked; save(); };
    $('#sVow').onchange = function (e) { st.vowMode = e.target.checked; save(); };
    $('#sVowN').onchange = function (e) { st.vowRakat = clamp(parseInt(e.target.value, 10) || 20, 2, 60); save(); };
    $('#sInt').onchange = function (e) { st.intensity = +e.target.value; save(); refreshUI(); };
    $('#sHair').onchange = function (e) { st.hair = e.target.value; save(); applyAppearance(); };
    $('#sBeard').onchange = function (e) { st.beard = e.target.checked; save(); applyAppearance(); };
    Array.prototype.forEach.call(b.querySelectorAll('.sw'), function (btn) {
      btn.onclick = function () { st[btn.getAttribute('data-k')] = btn.getAttribute('data-c'); save(); applyAppearance(); rerenderModal(); };
    });
    $('#sReset').onclick = function () {
      if (confirm('Erase everything (commitments, history, settings)?')) {
        try { localStorage.removeItem(KEY); } catch (e) {}
        location.reload();
      }
    };
  }

  function renderIntro(b) {
    b.innerHTML =
      '<p>You hang on the cross. Behind you stands your Shadow \u2014 faceless, patient, honest. It does not shout. It asks.</p>' +
      '<p><b>1.</b> Add 1\u20133 real commitments (<b>GOALS</b>). Finish them: nails come out.<br>' +
      '<b>2.</b> Before any real decision, <b>FACE A DECISION</b>. Answer four questions. Do the small step you promise.<br>' +
      '<b>3.</b> Avoid what matters, again and again, and the room changes. You will not be told when.<br>' +
      '<b>4.</b> If the sentence is carried out, the <i>character</i> dies. You do a ritual and start a new run. Your real history stays.</p>' +
      '<p class="hint">Rest, sleep, illness and duty are never failures. The vow after a death (7 days Tahajjud + nafl) is a promise <i>you</i> set — change or switch it off in Settings. This is fiction \u2014 never hurt yourself over it.</p>' +
      '<div class="row"><button id="iGo" type="button" class="primary">ENTER THE ROOM \u25b8</button></div>';
    $('#iGo').onclick = function () { S.introSeen = true; save(); Sfx.init(); closeModal(true); if (!activeGoals().length) { openModal('GOALS', renderGoals); } };
  }

  /* ---------- random horror events ---------- */
  var WHISPERS = ['you know', 'not yet', 'still here', 'look at me', 'two minutes', 'begin', 'what are you running from'];
  function scheduleEvent(now) {
    var base = [28000, 18000, 11000][S.settings.intensity] || 18000;
    ev.nextAt = now + rnd(base * 0.6, base * 1.4) / (1 + S.neglect * 0.3);
  }
  function maybeEvent(now) {
    if (mode !== 'idle' && mode !== 'ask') return;
    if (now < ev.nextAt) return;
    scheduleEvent(now);
    if (S.neglect < 2 && S.settings.intensity < 2 && Math.random() < 0.7) return;
    var r = Math.random();
    if (r < 0.28) { ev.flickerUntil = now + rint(500, 1200); Sfx.sting(0.3); }
    else if (r < 0.5) { ev.glitchUntil = now + rint(200, 500); Sfx.sting(0.25); }
    else if (r < 0.7 && mode === 'idle') { ev.lungeUntil = now + 1400; Sfx.sting(0.4); }
    else if (r < 0.92) whisper(WHISPERS[rint(0, WHISPERS.length - 1)]);
    else { Sfx.setHeart(110); setTimeout(function () { updateAmbientAudio(); }, 4000); }
  }
  function updateAmbientAudio() {
    var n = S.neglect;
    Sfx.setHeart(mode === 'dying' ? 0 : (n >= 4 ? clamp(52 + (n - 3) * 9, 0, 120) : 0));
    Sfx.setDrone(clamp(n / 10, 0, 1));
  }

  /* ---------- main loop ---------- */
  var last = 0;
  function loop(ts) {
    requestAnimationFrame(loop);
    if (ts - last < 33) return;
    last = ts;
    var now = ts;
    maybeEvent(now);

    // targets
    var tK = 1, tX = 238;
    if (mode === 'ask') { tK = 1.22; tX = 205; }
    else if (ev.lungeUntil > now) { tK = view.reduced ? 1.12 : 1.4; tX = 200; }
    if (mode === 'dying') { tK = 1.4; tX = 205; }
    view.shadowK += (tK - view.shadowK) * 0.07;
    view.shadowX += (tX - view.shadowX) * 0.07;

    var flick = 1;
    if (ev.flickerUntil > now) flick = view.reduced ? 0.75 : (Math.random() < 0.5 ? 0.12 : 0.85);
    view.flicker += (flick - view.flicker) * (view.reduced ? 0.1 : 0.7);
    view.glitch = (ev.glitchUntil > now && !view.reduced) ? 0.8 : 0;

    var tD = mode === 'dying' || mode === 'ritual' ? 1 : clamp(S.neglect / 12 * 0.8 + (S.nails / 7) * 0.2, 0, 1);
    view.droop += (tD - view.droop) * 0.03;

    var amb = mode === 'ask' ? 0.08 : 0.13;
    if (S.nails === 0 && mode === 'idle') amb = 0.24;
    view.ambient += (amb - view.ambient) * 0.05;

    view.relFlash = Math.max(0, view.relFlash - 0.04);

    if (mode === 'dying') {
      var dt = now - deathStart; view.deathT = dt;
      if (dt > 1050 && !deathThud) { deathThud = true; Sfx.thud(); }
      view.fade = dt > 3000 ? (dt - 3000) / 1200 : 0;
      if (dt > 4300 && !deathDone) { deathDone = true; enterRitual(); }
    } else if (mode === 'ritual') {
      view.fade += (0.85 - view.fade) * 0.05;
    } else {
      view.deathT = null;
      view.fade += (0 - view.fade) * 0.06;
    }

    view.mode = mode;
    Art.render(now, view);
  }

  /* ---------- 1-second tick ---------- */
  function tick1() {
    checkVow();
    updatePending();
    checkOverdue();
    updateAmbientAudio();
    refreshUI();
  }

  /* ---------- wiring ---------- */
  function openPanel(name) {
    Sfx.init();
    if (mode === 'dying' || mode === 'ritual') return;
    var map = { goals: ['GOALS', renderGoals], seven: ['SEVEN DAYS', renderSeven], history: ['HISTORY', renderHistory], settings: ['SETTINGS', renderSettings] };
    var m = map[name]; if (m) openModal(m[0], m[1]);
  }

  function init() {
    Art.init($('#screen'));
    applyAppearance(); Sfx.setOn(S.settings.sound);
    $('#btnFace').onclick = startAsk;
    Array.prototype.forEach.call(document.querySelectorAll('[data-panel]'), function (b) {
      b.onclick = function () { openPanel(b.getAttribute('data-panel')); };
    });
    Array.prototype.forEach.call(document.querySelectorAll('#pending [data-r]'), function (b) {
      b.onclick = function () { report(b.getAttribute('data-r')); };
    });
    $('#mClose').onclick = function () { closeModal(); };
    $('#modal').addEventListener('click', function (e) { if (e.target.id === 'modal') closeModal(); });
    $('#dlgClose').onclick = closeAsk;
    $('#dlgBack').onclick = function () {
      if (mode !== 'ask') return;
      if (step === 4) { step = S.settings.quick ? 0 : 3; S.settings.quick ? renderQuick() : renderStep(); }
      else if (step > 0) { step--; renderStep(); }
    };
    $('#dlgNext').onclick = function () {
      if (mode !== 'ask') return;
      Sfx.click();
      if (step === 4) accept();
      else if (S.settings.quick || step === 3) renderVerdict();
      else { step++; renderStep(); }
    };
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('#modal').classList.contains('hidden')) closeModal();
      else if (mode === 'ask') closeAsk();
    });
    document.addEventListener('pointerdown', function () { Sfx.init(); }, { once: true });

    scheduleEvent(performance.now());
    checkVow(); refreshUI(); updatePending(); updateAmbientAudio();
    setInterval(tick1, 1000);
    requestAnimationFrame(loop);

    if (S.dead) { view.droop = 1; view.fade = 0.85; enterRitual(); }
    else if (!S.introSeen) openModal('THE SENTENCE', renderIntro, false);
  }

  init();
})();
