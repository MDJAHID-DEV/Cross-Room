/* Tiny synthesized sound engine (no audio files needed). */
(function (global) {
  'use strict';
  var ac = null, master = null, on = true, bpm = 0, nextBeat = 0, drone = null;

  function init() {
    if (!ac) {
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
      master = ac.createGain();
      master.gain.value = on ? 0.5 : 0;
      master.connect(ac.destination);
      startDrone();
      setInterval(tick, 80);
    }
    if (ac.state === 'suspended') { try { ac.resume(); } catch (e) {} }
  }

  function startDrone() {
    var g = ac.createGain(); g.gain.value = 0.05;
    var f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 140;
    [48, 48.7, 72].forEach(function (fr) {
      var o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.connect(f); o.start();
    });
    f.connect(g); g.connect(master); drone = g;
  }

  function env(g, t, a, peak, d) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  function tone(freq, type, t, a, d, peak, slideTo) {
    var o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + a + d);
    env(g, t, a, peak, d);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + a + d + 0.05);
  }

  function noise(t, d, peak, freq) {
    var n = Math.floor(ac.sampleRate * d);
    var b = ac.createBuffer(1, n, ac.sampleRate), ch = b.getChannelData(0);
    for (var i = 0; i < n; i++) ch[i] = Math.random() * 2 - 1;
    var s = ac.createBufferSource(); s.buffer = b;
    var f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq || 800;
    var g = ac.createGain(); env(g, t, 0.005, peak, d);
    s.connect(f); f.connect(g); g.connect(master); s.start(t);
  }

  function beat(t) {
    tone(55, 'sine', t, 0.01, 0.12, 0.9, 38);
    tone(48, 'sine', t + 0.16, 0.01, 0.14, 0.6, 34);
  }

  function tick() {
    if (!ac || !on || bpm <= 0) return;
    var t = ac.currentTime;
    if (t >= nextBeat) { beat(t + 0.02); nextBeat = t + 60 / bpm; }
  }

  function ok() { return ac && on; }

  global.Sfx = {
    init: init,
    setOn: function (v) { on = !!v; if (master) master.gain.value = on ? 0.5 : 0; },
    setHeart: function (b) { bpm = b; },
    setDrone: function (l) { if (drone) drone.gain.value = 0.03 + l * 0.06; },
    type: function () { if (!ok()) return; tone(1000 + Math.random() * 250, 'square', ac.currentTime, 0.002, 0.02, 0.03); },
    click: function () { if (!ok()) return; tone(300, 'square', ac.currentTime, 0.002, 0.04, 0.05, 180); },
    thud: function () { if (!ok()) return; var t = ac.currentTime; tone(90, 'sine', t, 0.005, 0.35, 1, 30); noise(t, 0.12, 0.5, 300); },
    release: function () {
      if (!ok()) return; var t = ac.currentTime;
      noise(t, 0.08, 0.25, 2400);
      tone(392, 'sine', t + 0.05, 0.01, 0.5, 0.25);
      tone(523, 'sine', t + 0.2, 0.01, 0.6, 0.22);
      tone(784, 'sine', t + 0.38, 0.01, 0.9, 0.2);
    },
    sting: function (p) {
      if (!ok()) return; var t = ac.currentTime;
      noise(t, 0.5, p || 0.3, 1800);
      tone(120, 'sawtooth', t, 0.05, 0.5, 0.15, 60);
    },
    bell: function () {
      if (!ok()) return; var t = ac.currentTime;
      tone(660, 'sine', t, 0.005, 1.2, 0.3); tone(990, 'sine', t, 0.005, 0.8, 0.12);
    }
  };
})(window);
