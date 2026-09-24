/* ═══════════════════════════════════════════════════════════════════
   lab.js — shared helpers for the Lab series
   Extracted from convolution-lab.html. Everything here is generic;
   anything that knows about a specific lab's subject stays in that lab.
   ═══════════════════════════════════════════════════════════════════ */

/* ═════ control builders ═════ */

/** Segmented button row. Renders `values` as buttons, marks `cur` pressed. */
function seg(id, values, cur, onPick, labels, disabled) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = '';
  values.forEach((v, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = labels ? labels[i] : v;
    b.setAttribute('aria-pressed', String(v === cur));
    if (disabled) b.disabled = true;
    b.addEventListener('click', () => onPick(v));
    el.appendChild(b);
  });
}

/** Chip row. `items` is an array of [key, label] pairs. */
function chips(id, items, cur, onPick, disabledFn) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = '';
  items.forEach(([k, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = label;
    b.setAttribute('aria-pressed', String(k === cur));
    if (disabledFn && disabledFn(k)) b.disabled = true;
    b.addEventListener('click', () => onPick(k));
    el.appendChild(b);
  });
}

/* ═════ number formatting ═════ */

/** Integers stay bare, everything else gets one decimal. Uses a real minus sign. */
function fmt(v) {
  if (v === -Infinity) return '−∞';
  if (!isFinite(v)) return '·';
  const s = Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(1);
  return s.replace('-', '−');
}
const f2 = v => v.toFixed(2).replace('-', '−');
const f3 = v => v.toFixed(3).replace('-', '−');
const pct = v => (v * 100).toFixed(1) + '%';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Summation sign with limits above and below, for the equation boxes. */
const sigma = (sub, sup) =>
  `<span class="sigma"><small>${sup}</small><span class="big">Σ</span><small>${sub}</small></span>`;

/* ═════ canvas painting ═════ */

/** Paint an n×n grayscale array (0–255) into a canvas at native resolution. */
function paint(canvas, data, n) {
  if (!canvas) return;
  canvas.width = n; canvas.height = n;
  const ctx = canvas.getContext('2d'), img = ctx.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    const v = clamp(Math.round(data[i]), 0, 255);
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Paint an n×n mask tinted in one colour, over an optional grayscale base.
 * `mask` values are 0–1. Used wherever a segmentation overlay is drawn.
 */
function paintMask(canvas, mask, n, rgb, base, alpha) {
  if (!canvas) return;
  canvas.width = n; canvas.height = n;
  const ctx = canvas.getContext('2d'), img = ctx.createImageData(n, n);
  const a = alpha === undefined ? 0.75 : alpha;
  for (let i = 0; i < n * n; i++) {
    const g = base ? clamp(base[i], 0, 255) : 244;
    const m = clamp(mask[i], 0, 1) * a;
    img.data[i * 4]     = g * (1 - m) + rgb[0] * m;
    img.data[i * 4 + 1] = g * (1 - m) + rgb[1] * m;
    img.data[i * 4 + 2] = g * (1 - m) + rgb[2] * m;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

/* ═════ procedural texture (so labs need no image assets) ═════ */

function hash2(x, y, s) {
  const n = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return n - Math.floor(n);
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s);
  const c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
function fbm(x, y, s, oct) {
  let val = 0, amp = .5, f = 1;
  for (let i = 0; i < (oct || 4); i++) { val += amp * vnoise(x * f, y * f, s + i * 13); f *= 2; amp *= .5; }
  return val;
}

/* ═════ transport ═════
   Playback controls shared by every stepped demo. The lab owns the state;
   this owns the buttons, the timer, and keeping them in sync.

   new Transport({
     ids:   {reset, prev, play, next, speed, counter},
     max:   () => totalSteps,
     get:   () => currentIndex,
     set:   i  => { ...store i... },
     render:() => { ...redraw... },
     label: (i, max) => 'Step 3 of 25',
     interval: speedValue => ms
   })
*/
class Transport {
  constructor(opts) {
    this.o = opts;
    this.playing = false;
    this.timer = null;
    const id = k => document.getElementById(opts.ids[k]);
    this.el = {
      reset: id('reset'), prev: id('prev'), play: id('play'),
      next: id('next'), speed: id('speed'), counter: id('counter')
    };
    if (this.el.reset) this.el.reset.addEventListener('click', () => { this.stop(); this.go(0); });
    if (this.el.prev)  this.el.prev.addEventListener('click',  () => { this.stop(); this.go(this.o.get() - 1); });
    if (this.el.next)  this.el.next.addEventListener('click',  () => { this.stop(); this.go(this.o.get() + 1); });
    if (this.el.play)  this.el.play.addEventListener('click',  () => this.toggle());
    if (this.el.speed) this.el.speed.addEventListener('input', () => { if (this.playing) this.restart(); });
    // Never leave a timer running in a hidden tab
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.stop(); });
    if (opts.keys) this.bindKeys();
  }
  /** ← → to step, space to play. Ignored while the reader is in a field. */
  bindKeys() {
    document.addEventListener('keydown', e => {
      const t = e.target, tag = t && t.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); this.stop(); this.go(this.o.get() + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); this.stop(); this.go(this.o.get() - 1); }
      else if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); this.toggle(); }
    });
  }
  interval() {
    const v = this.el.speed ? Number(this.el.speed.value) : 5;
    return this.o.interval ? this.o.interval(v) : (1150 - v * 100);
  }
  go(i) {
    const max = this.o.max();
    i = clamp(i, 0, max - 1);
    this.o.set(i);
    this.o.render();
    this.sync();
  }
  tick() {
    const i = this.o.get(), max = this.o.max();
    if (i >= max - 1) { this.stop(); return; }
    this.go(i + 1);
  }
  restart() { clearInterval(this.timer); this.timer = setInterval(() => this.tick(), this.interval()); }
  start() {
    if (this.o.get() >= this.o.max() - 1) this.go(0);
    this.playing = true; this.restart(); this.sync();
  }
  stop() { this.playing = false; clearInterval(this.timer); this.timer = null; this.sync(); }
  toggle() { this.playing ? this.stop() : this.start(); }
  /** Refresh button states and the counter. Call after any external state change. */
  sync() {
    const i = this.o.get(), max = this.o.max();
    if (this.el.play) this.el.play.textContent = this.playing ? 'Pause' : 'Play';
    if (this.el.prev) this.el.prev.disabled = i <= 0;
    if (this.el.next) this.el.next.disabled = i >= max - 1;
    if (this.el.counter) {
      this.el.counter.textContent = this.o.label ? this.o.label(i, max) : `${i + 1} / ${max}`;
    }
  }
}

/* ═════ readout builders ═════ */

/** One figure in a .scoreboard. `hero` renders it in vermillion at a larger size. */
function score(key, value, note, hero) {
  return '<div class="score' + (hero ? ' hero-metric' : '') + '">' +
    '<span class="k">' + key + '</span>' +
    '<span class="v">' + value + '</span>' +
    '<span class="n">' + (note || '') + '</span></div>';
}

/** One row in a .bars group. `cls` may be "sage" to recolour the fill. */
function bar(key, value, total, cls) {
  const w = total ? (value / total) * 100 : 0;
  return '<div class="bar-row"><span>' + key + '</span>' +
    '<span class="bar-track"><span class="bar-fill ' + (cls || '') +
    '" style="width:' + w.toFixed(2) + '%"></span></span>' +
    '<span class="bar-val">' + value + '</span></div>';
}

/* ═════ draggable mask ═════
   Pointer drag plus an arrow-key path, so the interaction is not mouse-only.
   `onMove` receives an offset from the canvas centre, in grid cells.
   Returns a setter so the caller can move it programmatically (presets). */
function dragMask(canvas, getN, onMove) {
  if (!canvas) return () => {};
  let dx = 0, dy = 0, held = false;

  if (!canvas.hasAttribute('tabindex')) canvas.tabIndex = 0;
  canvas.style.touchAction = 'none';
  canvas.classList.add('draggable');

  const toOffset = e => {
    const r = canvas.getBoundingClientRect(), N = getN();
    return {
      x: ((e.clientX - r.left) / r.width) * N - N / 2,
      y: ((e.clientY - r.top) / r.height) * N - N / 2
    };
  };
  const apply = (nx, ny) => { dx = nx; dy = ny; onMove(dx, dy); };

  canvas.addEventListener('pointerdown', e => {
    held = true;
    canvas.setPointerCapture(e.pointerId);
    const p = toOffset(e); apply(p.x, p.y);
  });
  canvas.addEventListener('pointermove', e => {
    if (!held) return;
    const p = toOffset(e); apply(p.x, p.y);
  });
  const end = e => { held = false; try { canvas.releasePointerCapture(e.pointerId); } catch (_) {} };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  canvas.addEventListener('keydown', e => {
    const step = e.shiftKey ? 3 : 1;
    let handled = true;
    if (e.key === 'ArrowLeft') apply(dx - step, dy);
    else if (e.key === 'ArrowRight') apply(dx + step, dy);
    else if (e.key === 'ArrowUp') apply(dx, dy - step);
    else if (e.key === 'ArrowDown') apply(dx, dy + step);
    else if (e.key === 'Home' || e.key === '0') apply(0, 0);
    else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  });

  return (nx, ny) => apply(nx, ny);
}

/* ═════ inline status message (replaces alert) ═════ */
const _msgTimers = {};
function labMsg(id, text, ms) {
  const el = document.getElementById(id);
  if (!el) return;
  clearTimeout(_msgTimers[id]);
  el.textContent = text;
  el.classList.toggle('show', Boolean(text));
  if (text) _msgTimers[id] = setTimeout(() => el.classList.remove('show'), ms || 5000);
}

/* ═════ reveal on scroll ═════ */
(function () {
  const start = () => {
    const els = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window) ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      els.forEach(el => el.classList.add('visible'));
      return;
    }
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    els.forEach(el => io.observe(el));
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
