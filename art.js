/* Pixel renderer: 320x180 internal canvas, ordered-dither lighting, scaled up by CSS. */
(function (global) {
  'use strict';
  var W = 320, H = 180, CX = 160;

  function mk(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  var scn = mk(W, H), lgt = mk(W, H), bgc = mk(W, H), bld = mk(W, H);
  var sc = scn.getContext('2d', { willReadFrequently: true });
  var lc = lgt.getContext('2d', { willReadFrequently: true });
  var cv = null, ctx = null, img = null, bloodKey = -1, lastS = 0;
  var app = { skin: '#d8a274', hair: 'short', hairCol: '#17110e', beard: false };
  var falling = [];

  function mulberry(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function R(c, x, y, w, h, col) {
    w = Math.round(w); h = Math.round(h);
    if (w <= 0 || h <= 0) return;
    c.fillStyle = col; c.fillRect(Math.round(x), Math.round(y), w, h);
  }
  function shade(hex, f) {
    var n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    function q(v) { return Math.max(0, Math.min(255, Math.round(v * f))); }
    return 'rgb(' + q(r) + ',' + q(g) + ',' + q(b) + ')';
  }
  function ell(c, x, y, rx, ry, col) {
    for (var dy = -Math.floor(ry); dy <= Math.floor(ry); dy++) {
      var hw = rx * Math.sqrt(Math.max(0, 1 - (dy / ry) * (dy / ry)));
      R(c, x - hw, y + dy, hw * 2, 1, col);
    }
  }
  function radial(c, x, y, r, rgb, a) {
    if (a <= 0) return;
    var g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + a + ')');
    g.addColorStop(1, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0)');
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  }

  /* ---------- static background ---------- */
  function buildBG() {
    var c = bgc.getContext('2d'), rnd = mulberry(1337);
    R(c, 0, 0, W, H, '#14101a');
    var tones = ['#2b2630', '#312b37', '#38313e', '#252030'];
    for (var y = 0; y < 142; y += 9) {
      var off = ((y / 9) | 0) % 2 ? 10 : 0;
      for (var x = -20; x < W; x += 20) {
        R(c, x + off + 1, y + 1, 18, 7, tones[(rnd() * tones.length) | 0]);
        for (var i = 0; i < 6; i++) {
          R(c, x + off + 1 + ((rnd() * 18) | 0), y + 1 + ((rnd() * 7) | 0), 1, 1, rnd() < 0.5 ? '#403848' : '#171220');
        }
      }
    }
    R(c, 0, 142, W, 38, '#1c1820');
    for (var fx = 0; fx < W; fx += 26) R(c, fx, 142, 1, 38, '#0e0b12');
    for (var fy = 142; fy < H; fy += 9) R(c, 0, fy, W, 1, '#0e0b12');
    for (var s = 0; s < 160; s++) R(c, rnd() * W, 143 + rnd() * 36, 1, 1, rnd() < 0.5 ? '#2a242f' : '#120f16');
    R(c, 0, 141, W, 1, '#07050a');
    // hanging chains
    [44, 276].forEach(function (cx) {
      for (var cy = 0; cy < 70; cy += 4) { R(c, cx, cy, 2, 3, '#3b3942'); R(c, cx + (cy % 8 ? 1 : -1), cy + 2, 1, 2, '#24222a'); }
    });
  }

  var SPL = (function () {
    var r = mulberry(77), a = [];
    for (var i = 0; i < 80; i++) a.push({ x: 60 + r() * 200, y: 146 + r() * 30, r: 2 + r() * 7, s: (r() * 1e9) | 0 });
    a.sort(function (p, q) { return Math.abs(p.x - 160) - Math.abs(q.x - 160); });
    return a;
  })();

  function buildBlood(n) {
    var c = bld.getContext('2d');
    c.clearRect(0, 0, W, H);
    for (var i = 0; i < n && i < SPL.length; i++) {
      var p = SPL[i], r = mulberry(p.s);
      for (var k = 0; k < p.r * p.r * 0.9; k++) {
        var a = r() * 6.283, d = Math.sqrt(r()) * p.r;
        var x = p.x + Math.cos(a) * d * 1.5, y = p.y + Math.sin(a) * d * 0.55;
        var q = r();
        R(c, x, y, 1 + (r() < 0.25 ? 1 : 0), 1, q < 0.2 ? '#a32020' : (q < 0.6 ? '#6b1414' : '#4a0d10'));
      }
    }
  }

  /* ---------- scene pieces ---------- */
  function drawTorch(c, t) {
    R(c, 25, 99, 8, 3, '#2b2b30'); R(c, 28, 92, 3, 8, '#3a2b1a');
    var f = Math.floor(t / 110) % 3, o = f === 1 ? 1 : 0;
    R(c, 27 + o, 86, 5, 6, '#e8913a'); R(c, 28, 83 - f, 3, 4 + f, '#f6c35a'); R(c, 29, 81 - f, 1, 3, '#fff1b0');
  }

  function drawShadow(c, v, t) {
    var k = v.shadowK, x = v.shadowX + Math.sin(t / 1400) * 2;
    var ask = v.mode === 'ask';
    var pulse = 0.6 + 0.4 * Math.sin(t / 700);
    var rim = ask ? 'rgba(200,200,225,' + (0.5 + 0.15 * pulse) + ')' : 'rgba(150,50,70,' + (0.3 + 0.3 * pulse) + ')';
    for (var pass = 1; pass >= 0; pass--) {
      var e = pass ? 2 : 0, col = pass ? rim : '#030204';
      ell(c, x, 180 - 142 * k, 19 * k + e, 23 * k + e, col);
      R(c, x - 6 * k - e, 180 - 124 * k, 12 * k + 2 * e, 28 * k, col);
      var y0 = 180 - 100 * k;
      for (var y = Math.max(0, Math.floor(y0 - e)); y < H; y++) {
        var d = Math.max(0, y - y0);
        var hw = (12 + 90 * (1 - Math.exp(-d / (15 * k)))) * k + e;
        R(c, x - hw, y, hw * 2, 1, col);
      }
    }
  }

  function drawCross(c) {
    R(c, CX - 6, 14, 12, 150, '#4a2f1a'); R(c, CX - 6, 14, 3, 150, '#5e3b21'); R(c, CX + 3, 14, 3, 150, '#33200f');
    R(c, CX - 70, 44, 140, 10, '#4a2f1a'); R(c, CX - 70, 44, 140, 3, '#5e3b21'); R(c, CX - 70, 51, 140, 3, '#33200f');
    var y, x;
    for (y = 16; y < 164; y += 4) R(c, CX - 5 + ((y * 7) % 9), y, 1, 2, '#2b190c');
    for (x = CX - 68; x < CX + 68; x += 5) R(c, x, 45 + ((x * 3) % 7), 2, 1, '#2b190c');
    R(c, CX - 16, 160, 32, 8, '#3a2413'); R(c, CX - 16, 160, 32, 2, '#4d3119');
  }

  var SLOTS = [[-50, 50], [50, 50], [0, 130], [-30, 49], [30, 49], [3, 60], [-4, 100]];
  function slotPos(i, s) {
    var o = SLOTS[i] || [0, 60];
    return [CX + o[0], o[1] + (i === 5 || i === 6 ? (s || 0) : 0)];
  }

  function drawChar(c, v, t, s) {
    var sk = app.skin, sk2 = shade(sk, 0.72), sk3 = shade(sk, 0.5);
    var hc = app.hairCol, hx = Math.round(v.droop * 3), hy = Math.round(v.droop * 2);
    var i, y;
    // legs
    for (y = 84 + s; y <= 128; y++) {
      var p = (y - 84 - s) / (44 - s);
      R(c, CX - 8 + Math.round(p * 5), y, 5, 1, sk2);
      R(c, CX + 3 - Math.round(p * 5), y, 5, 1, sk);
    }
    R(c, CX - 5, 128, 10, 5, sk2); R(c, CX - 5, 132, 10, 1, sk3);
    // long hair behind
    var headX = CX - 5 + hx, headY = 29 + s + hy;
    if (app.hair === 'long') { R(c, headX - 2, headY + 2, 3, 20, hc); R(c, headX + 9, headY + 2, 3, 20, hc); }
    // arms
    if (v.nails > 0) {
      for (i = 0; i < 42; i++) {
        var sag = Math.round(i * v.droop * 0.08);
        R(c, CX - 10 - i, 46 + sag, 1, 5, i % 2 ? sk2 : sk3);
        R(c, CX + 10 + i, 46 + sag, 1, 5, i % 2 ? sk : sk2);
      }
      R(c, CX - 56, 46 + 3, 6, 8, sk2); R(c, CX + 50, 46 + 3, 6, 8, sk);
    } else {
      R(c, CX - 14, 46 + s, 4, 26, sk2); R(c, CX + 10, 46 + s, 4, 26, sk); R(c, CX - 14, 72 + s, 4, 4, sk3); R(c, CX + 10, 72 + s, 4, 4, sk2);
    }
    // torso
    R(c, CX - 8, 45 + s, 16, 26, sk); R(c, CX - 10, 44 + s, 20, 5, sk);
    for (y = 50; y <= 66; y += 3) R(c, CX - 5, y + s, 10, 1, sk2);
    R(c, CX, 48 + s, 1, 18, sk2);
    // cloth
    R(c, CX - 8, 70 + s, 16, 14, '#6a5a44'); R(c, CX - 8, 70 + s, 16, 2, '#7d6b52');
    R(c, CX - 3, 72 + s, 1, 10, '#4d402f'); R(c, CX + 2, 76 + s, 3, 5, '#6b1b17');
    // neck + head
    R(c, CX - 2 + Math.round(hx / 2), 40 + s, 5, 5, sk2);
    R(c, headX, headY, 10, 12, sk); R(c, headX + 7, headY + 1, 3, 10, sk2); R(c, headX + 1, headY + 11, 8, 1, sk2);
    // hair
    var st = app.hair;
    if (st !== 'bald') {
      R(c, headX - 1, headY - 2, 12, 5, hc);
      if (st === 'medium' || st === 'long') {
        R(c, headX - 1, headY + 2, 2, 8, hc); R(c, headX + 9, headY + 2, 2, 8, hc); R(c, headX, headY + 1, 10, 2, hc);
      } else {
        R(c, headX - 1, headY + 2, 2, 4, hc); R(c, headX + 9, headY + 2, 2, 4, hc);
      }
      if (st === 'curly') { R(c, headX - 2, headY - 3, 4, 3, hc); R(c, headX + 2, headY - 4, 5, 3, hc); R(c, headX + 8, headY - 3, 4, 3, hc); }
    }
    if (v.droop > 0.6 && st !== 'bald') R(c, headX, headY + 2, 10, 4, hc);
    else { R(c, headX + 2, headY + 5, 2, 1, '#1a0f0c'); R(c, headX + 6, headY + 5, 2, 1, '#1a0f0c'); }
    if (app.beard) { R(c, headX, headY + 7, 10, 5, hc); R(c, headX + 3, headY + 9, 4, 1, shade(hc, 1.9)); }
    else R(c, headX + 3, headY + 9, 4, 1, sk3);
  }

  function drawNail(c, x, y, i, t, gi) {
    var len = Math.round((3 + gi * 4) + (Math.sin(t / 900 + i * 1.7) + 1) * (1.5 + gi * 1.5));
    R(c, x, y + 2, 1, len, '#7a1414'); R(c, x - 1, y + 2, 1, Math.max(1, len - 4), '#5a0f10'); R(c, x, y + 2 + len, 1, 1, '#b02222');
    R(c, x - 1, y - 1, 3, 3, '#8b9099'); R(c, x - 1, y - 1, 3, 1, '#c9ced6'); R(c, x, y + 1, 1, 1, '#5a5f68');
    if (((t / 120 + i * 7) | 0) % 23 === 0) R(c, x - 1, y - 2, 1, 1, '#ffffff');
  }

  /* ---------- lighting ---------- */
  function lightPass(v, t, dt) {
    var a = Math.max(0, v.ambient), g = Math.round(a * 255);
    lc.globalCompositeOperation = 'source-over';
    lc.fillStyle = 'rgb(' + g + ',' + g + ',' + Math.round(g * 1.1) + ')';
    lc.fillRect(0, 0, W, H);
    lc.globalCompositeOperation = 'lighter';
    var fl = v.flicker * (0.92 + 0.08 * Math.sin(t / 90) * Math.sin(t / 37));
    var dim = dt != null ? Math.max(0.15, 1 - dt / 3500) : 1;
    radial(lc, CX, 70, 105, [255, 205, 165], 0.95 * fl * dim);
    radial(lc, 29, 90, 75, [255, 130, 50], 0.8 * (0.85 + 0.15 * Math.sin(t / 55)) * v.flicker * dim);
    var k = v.shadowK, hx = v.shadowX, hyc = 180 - 142 * k;
    radial(lc, hx, hyc, 62 * k, [110, 50, 80], (v.mode === 'ask' ? 0.7 : 0.4) * dim);
    for (var i = 0; i < v.nails && i < SLOTS.length; i++) {
      var p = slotPos(i, lastS);
      radial(lc, p[0], p[1], 16, [255, 80, 60], 0.22 * (0.7 + 0.3 * Math.sin(t / 300 + i)));
    }
    if (v.relFlash > 0) radial(lc, CX, 80, 130, [255, 240, 200], Math.min(1, v.relFlash) * 0.6);
  }

  var BAY = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  function composite() {
    var sd = sc.getImageData(0, 0, W, H).data, ld = lc.getImageData(0, 0, W, H).data, od = img.data;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var i = (y * W + x) * 4, b = (BAY[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
        for (var ch = 0; ch < 3; ch++) {
          var f = ld[i + ch] / 255;
          f = Math.min(1, Math.floor(f * 5 + b) / 5);
          od[i + ch] = sd[i + ch] * f * 1.3;
        }
        od[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /* ---------- public ---------- */
  function init(canvas) {
    cv = canvas; ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = false;
    img = ctx.createImageData(W, H);
    buildBG();
  }

  function render(t, v) {
    if (!ctx) return;
    var s = Math.round(v.droop * 3); lastS = s;
    var gi = v.intensity;
    var n = Math.min(80, [6, 20, 44][gi] + v.nails * 4);
    if (bloodKey !== n) { bloodKey = n; buildBlood(n); }
    var dt = v.deathT;

    sc.drawImage(bgc, 0, 0); sc.drawImage(bld, 0, 0);
    drawTorch(sc, t);
    drawShadow(sc, v, t);
    drawCross(sc);
    drawChar(sc, v, t, s);
    var i, p;
    for (i = 0; i < v.nails && i < SLOTS.length; i++) { p = slotPos(i, s); drawNail(sc, p[0], p[1], i, t, gi); }

    for (i = falling.length - 1; i >= 0; i--) {
      var f = falling[i]; f.y += f.vy; f.vy += 0.5;
      R(sc, f.x, f.y, 1, 5, '#8b9099'); R(sc, f.x - 1, f.y - 1, 3, 2, '#c9ced6');
      if (f.y > 174) falling.splice(i, 1);
    }

    // fatal nail (fiction)
    if (dt != null && dt > 700) {
      var nx = CX + 2, ny = 42 + s, pr = Math.min(1, (dt - 700) / 350);
      var xx = nx + 60 * (1 - pr * pr);
      R(sc, xx, ny, 9, 2, '#8b9099'); R(sc, xx + 9, ny - 1, 2, 4, '#c9ced6');
      if (pr >= 1) { R(sc, nx + 7, ny + 2, 1, 6, '#7a1414'); }
    }

    lightPass(v, t, dt);
    composite();

    // glitch
    if (v.glitch > 0.01 && !v.reduced) {
      var cnt = 1 + Math.floor(v.glitch * 5);
      for (i = 0; i < cnt; i++) {
        var y0 = Math.floor(Math.random() * (H - 14)), h = 2 + Math.floor(Math.random() * 12);
        var dx = Math.round((Math.random() * 28 - 14) * v.glitch);
        ctx.drawImage(cv, 0, y0, W, h, dx, y0, W, h);
      }
      if (Math.random() < 0.25) { ctx.fillStyle = 'rgba(160,0,0,0.18)'; ctx.fillRect(0, Math.random() * H, W, 3); }
    }
    // death impact: shake + flash
    if (dt != null && dt > 1050 && dt < 1350 && !v.reduced) {
      ctx.drawImage(cv, Math.round(Math.random() * 6 - 3), Math.round(Math.random() * 4 - 2));
    }
    if (dt != null && dt > 1050 && dt < 1250) {
      var fa = (1 - (dt - 1050) / 200) * (v.reduced ? 0.2 : 0.8);
      ctx.fillStyle = 'rgba(255,255,255,' + fa + ')'; ctx.fillRect(0, 0, W, H);
    }
    if (v.fade > 0.005) { ctx.fillStyle = 'rgba(0,0,0,' + Math.min(1, v.fade) + ')'; ctx.fillRect(0, 0, W, H); }
  }

  global.Art = {
    init: init,
    render: render,
    setAppearance: function (a) { app = Object.assign({}, app, a); },
    dropNail: function (i) { var p = slotPos(i, lastS); falling.push({ x: p[0], y: p[1], vy: 0 }); }
  };
})(window);
