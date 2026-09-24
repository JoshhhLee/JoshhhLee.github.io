/* ═══════════════════════════════════════════════════════════════════
   imgproc.js — the shared workbench for the Image Processing series
   Loaded after lab.js. Owns everything every IP lab needs and none of
   them should rebuild: the working image (samples, upload, drag-drop,
   paste), the before/after view with its pixel inspector, and the
   histogram / curve plots. Lab-specific operations stay in each lab.

   Images are plain grayscale objects: { w, h, data: Uint8ClampedArray }.
   ═══════════════════════════════════════════════════════════════════ */

const IP = (() => {
  const MAX_SIDE = 480;              // uploads are scaled so the long side fits this
  const SW = 360, SH = 270;          // sample image size (4:3)

  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const COL = {};
  const col = k => COL[k] || (COL[k] = cssVar('--' + k));

  /* ═════ image basics ═════ */

  const make = (w, h, data) => ({ w, h, data: data || new Uint8ClampedArray(w * h) });
  const clone = img => make(img.w, img.h, new Uint8ClampedArray(img.data));

  /** Apply a 256-entry lookup table — the definition of a point operation. */
  function applyLUT(img, lut) {
    const out = make(img.w, img.h), s = img.data, d = out.data;
    for (let i = 0; i < s.length; i++) d[i] = lut[s[i]];
    return out;
  }

  function histogram(img) {
    const h = new Uint32Array(256), s = img.data;
    for (let i = 0; i < s.length; i++) h[s[i]]++;
    return h;
  }

  /** Normalised cumulative histogram: cdf[k] = P(r ≤ k), in [0, 1]. */
  function cdf(hist) {
    const out = new Float64Array(256);
    let n = 0, acc = 0;
    for (let k = 0; k < 256; k++) n += hist[k];
    for (let k = 0; k < 256; k++) { acc += hist[k]; out[k] = n ? acc / n : 0; }
    return out;
  }

  function stats(img, hist) {
    hist = hist || histogram(img);
    const n = img.data.length;
    let sum = 0, sq = 0, min = 255, max = 0, levels = 0;
    for (let k = 0; k < 256; k++) {
      const c = hist[k];
      if (!c) continue;
      levels++; sum += k * c; sq += k * k * c;
      if (k < min) min = k;
      if (k > max) max = k;
    }
    const mean = sum / n;
    return { n, mean, std: Math.sqrt(Math.max(0, sq / n - mean * mean)), min, max, levels };
  }

  /* ═════ sample images ═════
     Generated in the page, so the series ships no image assets and every
     sample is one we are free to use. Each is built to have a histogram
     worth looking at. */

  function build(fn) {
    const img = make(SW, SH);
    for (let y = 0; y < SH; y++)
      for (let x = 0; x < SW; x++)
        img.data[y * SW + x] = clamp(Math.round(fn(x / SW, y / SH, x, y)), 0, 255);
    return img;
  }
  const grain = (x, y, s) => (hash2(x, y, s) - 0.5);

  const SAMPLES = {
    // everything squeezed into a narrow mid-grey band
    fog: {
      label: 'Foggy hills',
      make: () => build((u, v, x, y) => {
        let t = 0.82 - 0.25 * v + 0.06 * fbm(u * 4, v * 3, 3);
        for (let k = 0; k < 4; k++) {
          const ridge = 0.38 + 0.13 * k + 0.09 * (fbm(u * (2.5 + k), k * 7.3, 11 + k, 4) - 0.5) * 2;
          if (v > ridge) t = 0.62 - 0.14 * k + 0.08 * fbm(u * 9, v * 9, 20 + k, 3);
        }
        return 108 + t * 58 + grain(x, y, 1) * 5;
      })
    },
    // piled against black, with a thin bright tail
    night: {
      label: 'Night street',
      make: () => {
        const bld = [];
        let x = 0, s = 3;
        while (x < SW) {
          const bw = 28 + Math.floor(hash2(s, 1, 9) * 46), bh = 90 + Math.floor(hash2(s, 2, 9) * 120);
          bld.push({ x0: x, x1: x + bw, top: SH - bh, seed: s });
          x += bw + 2 + Math.floor(hash2(s, 3, 9) * 8); s++;
        }
        return build((u, v, px, py) => {
          let t = 30 - 18 * v + 5 * fbm(u * 3, v * 2, 4, 3);
          const dm = Math.hypot(px - 292, py - 52);
          if (dm < 17) t = 225 - dm * 1.5;
          else if (dm < 40) t += (40 - dm) * 0.9;
          for (const b of bld) {
            if (px < b.x0 || px >= b.x1 || py < b.top) continue;
            t = 13 + 7 * hash2(b.seed, 5, 9) + 4 * fbm(px / 9, py / 9, b.seed, 2);
            const wx = (px - b.x0 - 5) % 11, wy = (py - b.top - 8) % 15;
            const cx = Math.floor((px - b.x0 - 5) / 11), cy = Math.floor((py - b.top - 8) / 15);
            if (px - b.x0 > 4 && px < b.x1 - 5 && py - b.top > 7 && wx < 6 && wy < 8 &&
                hash2(cx, cy, b.seed) > 0.72) t = 150 + 90 * hash2(cx, cy, b.seed + 1);
          }
          if (py > SH - 18) t = 10 + 12 * (1 - (SH - py) / 18) + 3 * fbm(u * 20, v * 4, 8, 2);
          return t + grain(px, py, 2) * 4;
        });
      }
    },
    // two clean populations — the textbook case for a single threshold
    coins: {
      label: 'Coins',
      make: () => {
        const coins = [[70, 70, 38], [178, 62, 44], [290, 88, 34], [96, 190, 46], [210, 180, 40], [312, 205, 30], [148, 120, 22]];
        return build((u, v, x, y) => {
          let t = 58 + 22 * fbm(u * 5, v * 5, 30, 3) + 14 * u;
          for (const [cx, cy, r] of coins) {
            const d = Math.hypot(x - cx, y - cy);
            if (d < r) {
              const rim = d > r - 4 ? -22 : 0;
              t = 196 - 38 * (d / r) * (d / r) + rim + 10 * fbm(x / 6, y / 6, cx, 2);
            } else if (d < r + 5 && y > cy) t -= (r + 5 - d) * 4;   // soft shadow
          }
          return t + grain(x, y, 3) * 10;
        });
      }
    },
    // edges, fine lines, steps and text — something for every filter to act on
    chart: {
      label: 'Test chart',
      make: () => {
        const c = document.createElement('canvas');
        c.width = SW; c.height = SH;
        const x = c.getContext('2d');
        x.fillStyle = '#9a9a9a'; x.fillRect(0, 0, SW, SH);
        x.fillStyle = '#2a2a2a'; x.fillRect(18, 18, 112, 112);
        x.fillStyle = '#e8e8e8'; x.beginPath(); x.arc(74, 74, 36, 0, Math.PI * 2); x.fill();
        // line gratings of width 1, 2, 3, 4 px
        x.fillStyle = '#1e1e1e';
        for (let g = 1; g <= 4; g++) {
          const x0 = 148 + (g - 1) * 52;
          for (let i = 0; i < 5; i++) x.fillRect(x0 + i * g * 2, 18, g, 52);
        }
        // step wedge, 8 levels
        for (let i = 0; i < 8; i++) {
          const v = Math.round(20 + i * 30);
          x.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
          x.fillRect(148 + i * 25.5, 82, 26, 46);
        }
        // smooth ramp
        const g = x.createLinearGradient(18, 0, 342, 0);
        g.addColorStop(0, '#000'); g.addColorStop(1, '#fff');
        x.fillStyle = g; x.fillRect(18, 142, 324, 22);
        // text, large and small
        x.fillStyle = '#141414';
        x.font = '600 28px Georgia, "Times New Roman", serif'; x.fillText('Filter 3×3', 18, 208);
        x.font = '12px Georgia, "Times New Roman", serif'; x.fillText('fine print survives a small kernel', 18, 234);
        x.fillText('but not a large one', 18, 250);
        // checkerboard and a thin diagonal
        for (let j = 0; j < 10; j++) for (let i = 0; i < 12; i++) {
          x.fillStyle = (i + j) % 2 ? '#f2f2f2' : '#101010';
          x.fillRect(250 + i * 8, 178 + j * 8, 8, 8);
        }
        x.strokeStyle = '#f2f2f2'; x.lineWidth = 1;
        x.beginPath(); x.moveTo(214.5, 176); x.lineTo(238.5, 258); x.stroke();
        const d = x.getImageData(0, 0, SW, SH).data;
        return build((u, v, px, py) => d[(py * SW + px) * 4] + grain(px, py, 5) * 3);
      }
    },
    // text under a strong lighting gradient — defeats any single global threshold
    page: {
      label: 'Uneven page',
      make: () => {
        const c = document.createElement('canvas');
        c.width = SW; c.height = SH;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, SW, SH);
        ctx.fillStyle = '#000';
        ctx.font = '600 17px Georgia, "Times New Roman", serif';
        ['A histogram counts pixels.', 'It forgets where they were.', 'Two images can share one',
         'histogram and look nothing', 'alike. Equalization reshapes',
         'the counts; thresholding', 'splits them in two.', 'Neither can see the lamp.']
          .forEach((line, i) => ctx.fillText(line, 22, 48 + i * 29));
        const ink = ctx.getImageData(0, 0, SW, SH).data;
        return build((u, v, x, y) => {
          const light = 0.2 + 0.8 * Math.exp(-((u - 0.15) ** 2 + (v - 0.1) ** 2) * 1.6);
          const paper = 225 + 12 * fbm(u * 8, v * 8, 41, 3);
          const a = 1 - ink[(y * SW + x) * 4] / 255;
          return (paper * (1 - a) + 40 * a) * light + grain(x, y, 4) * 6;
        });
      }
    }
  };

  /* ═════ loading a reader's own image ═════ */

  function fromElement(el) {
    const s = Math.min(1, MAX_SIDE / Math.max(el.width, el.height));
    const w = Math.max(1, Math.round(el.width * s)), h = Math.max(1, Math.round(el.height * s));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(el, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data, img = make(w, h);
    for (let i = 0; i < w * h; i++)
      img.data[i] = Math.round(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]);
    return img;
  }

  function loadFile(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) { reject(new Error('That is not an image file.')); return; }
      const url = URL.createObjectURL(file), el = new Image();
      el.onload = () => { URL.revokeObjectURL(url); resolve(fromElement(el)); };
      el.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that file — try a JPG or PNG.')); };
      el.src = url;
    });
  }

  /* ═════ the working image ═════
     One image per page, shared by every section. Pickers stay in sync. */

  const bus = { key: null, img: null, subs: [], pickers: [] };
  const cache = {};

  function setImage(key, img) {
    bus.key = key; bus.img = img;
    bus.pickers.forEach(p => p());
    bus.subs.forEach(fn => fn(img, key));
  }
  function useSample(key) {
    if (!cache[key]) cache[key] = SAMPLES[key].make();
    setImage(key, cache[key]);
  }
  function useFile(file, msgId) {
    loadFile(file).then(img => setImage('own', img))
      .catch(err => msgId ? labMsg(msgId, err.message) : console.warn(err));
  }

  /** Render the sample chips + upload button into `el`. Any number per page. */
  function picker(el) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return;
    const msgId = (el.id || 'ip') + '-msg';
    el.classList.add('ip-picker');
    el.innerHTML =
      '<div class="chiprow"></div>' +
      '<div class="ip-own"><span class="chip filebtn">Use your own image' +
      '<input type="file" accept="image/*" aria-label="Use your own image"></span>' +
      '<span class="ip-hint">or drop / paste one anywhere on the page</span></div>' +
      '<span class="upload-msg" id="' + msgId + '" role="status" aria-live="polite"></span>';
    const row = el.querySelector('.chiprow');
    const render = () => {
      row.innerHTML = '';
      const items = Object.keys(SAMPLES).map(k => [k, SAMPLES[k].label]);
      if (bus.key === 'own') items.push(['own', 'Your image']);
      items.forEach(([k, label]) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'chip'; b.textContent = label;
        b.setAttribute('aria-pressed', String(k === bus.key));
        if (k !== 'own') b.addEventListener('click', () => useSample(k));
        row.appendChild(b);
      });
    };
    el.querySelector('input[type=file]').addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      if (f) useFile(f, msgId);
      e.target.value = '';
    });
    bus.pickers.push(render);
    render();
  }

  // Drop or paste an image anywhere on the page
  let dragDepth = 0;
  const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  document.addEventListener('dragenter', e => {
    if (!hasFiles(e)) return;
    dragDepth++; document.body.classList.add('ip-dragging');
  });
  document.addEventListener('dragleave', e => {
    if (!hasFiles(e)) return;
    if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('ip-dragging'); }
  });
  document.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; document.body.classList.remove('ip-dragging');
    const f = e.dataTransfer.files[0];
    if (f) useFile(f, document.querySelector('.ip-picker') ? document.querySelector('.ip-picker').id + '-msg' : null);
  });
  document.addEventListener('paste', e => {
    const items = e.clipboardData ? Array.from(e.clipboardData.items) : [];
    const it = items.find(i => i.kind === 'file' && /^image\//.test(i.type));
    if (it) { e.preventDefault(); useFile(it.getAsFile()); }
  });

  /* ═════ drawing ═════ */

  function drawGray(canvas, img) {
    canvas.width = img.w; canvas.height = img.h;
    const ctx = canvas.getContext('2d'), id = ctx.createImageData(img.w, img.h), d = id.data;
    for (let i = 0; i < img.data.length; i++) {
      const v = img.data[i];
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
  }

  /** Size a chart canvas to its CSS width at device resolution; draw in CSS pixels. */
  function fit(canvas, cssH) {
    const w = canvas.clientWidth || canvas.parentElement.clientWidth || 360;
    const h = cssH === 'square' ? w : cssH;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = '10px Inter, sans-serif';
    return { ctx, w, h };
  }

  function vline(ctx, x, y0, y1, color, dash) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1.25;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); ctx.restore();
  }

  /** Vertical marker lines; labels stack downwards so two close markers stay readable. */
  function markers(ctx, list, X, T, B, w) {
    let row = 0;
    (list || []).forEach(m => {
      if (m.v == null) return;
      const x = X(m.v);
      vline(ctx, x, T - 6, B, m.color || col('vermillion'), m.dash);
      if (!m.label) return;
      ctx.fillStyle = m.color || col('vermillion');
      const right = x > w - 70;
      ctx.textAlign = right ? 'right' : 'left';
      ctx.fillText(m.label, x + (right ? -4 : 4), T + 2 + row++ * 12);
    });
  }

  /**
   * Histogram with optional overlays.
   * o.cdf: Float64Array to draw as a line · o.split: threshold k, shades the two classes
   * o.markers: [{ v, color, dash, label }] · o.height: CSS px
   */
  function drawHist(canvas, hist, o) {
    o = o || {};
    const { ctx, w, h } = fit(canvas, o.height || 150);
    const L = 6, R = 6, T = 12, B = h - 18, pw = w - L - R, bw = pw / 256;
    const xOf = k => L + k * bw;

    if (o.split != null) {
      const xs = xOf(o.split + 1);
      ctx.fillStyle = 'rgba(107,122,90,.11)'; ctx.fillRect(L, T, xs - L, B - T);
      ctx.fillStyle = 'rgba(184,65,46,.08)'; ctx.fillRect(xs, T, L + pw - xs, B - T);
    }

    // One or two spikes (clipping at 0 or 255) would flatten everything else — cap them
    const sorted = Array.from(hist).sort((a, b) => a - b);
    let cap = sorted[255];
    if (sorted[252] > 0 && cap > 4 * sorted[252]) cap = sorted[252] * 1.3;
    cap = Math.max(cap, 1);

    ctx.fillStyle = o.color || col('ink');
    for (let k = 0; k < 256; k++) {
      if (!hist[k]) continue;
      const bh = Math.min(hist[k], cap) / cap * (B - T);
      ctx.fillRect(xOf(k), B - bh, Math.max(bw - 0.25, 0.9), bh);
      if (hist[k] > cap) { ctx.fillStyle = col('vermillion'); ctx.fillRect(xOf(k) - 1, T - 5, Math.max(bw, 3), 3); ctx.fillStyle = o.color || col('ink'); }
    }

    ctx.strokeStyle = col('line') || 'rgba(26,26,26,.12)';
    ctx.beginPath(); ctx.moveTo(L, B + 0.5); ctx.lineTo(L + pw, B + 0.5); ctx.stroke();
    ctx.fillStyle = col('ink-light');
    [0, 64, 128, 192, 255].forEach((k, i) => {
      ctx.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center';
      ctx.fillText(k, xOf(k + (i === 4 ? 1 : 0.5)), h - 4);
    });

    if (o.cdf) {
      ctx.save(); ctx.strokeStyle = col('vermillion'); ctx.lineWidth = 1.6; ctx.beginPath();
      for (let k = 0; k < 256; k++) {
        const x = xOf(k + 0.5), y = B - o.cdf[k] * (B - T);
        k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke(); ctx.restore();
    }
    markers(ctx, o.markers, k => xOf(k + 0.5), T, B, w);
  }

  /** Axes shared by the square plots: r across, s up, both 0–255. */
  function squareAxes(canvas) {
    const { ctx, w } = fit(canvas, 'square');
    const L = 28, B = w - 22, R = w - 8, T = 8, S = Math.min(R - L, B - T);
    const X = r => L + (r / 255) * S, Y = s => B - (s / 255) * S;
    ctx.strokeStyle = 'rgba(26,26,26,.07)';
    for (let q = 0; q <= 4; q++) {
      const v = q * 255 / 4;
      ctx.beginPath(); ctx.moveTo(X(v), Y(0)); ctx.lineTo(X(v), Y(255)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(X(0), Y(v)); ctx.lineTo(X(255), Y(v)); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(26,26,26,.35)';
    ctx.strokeRect(X(0), Y(255), S, S);
    ctx.fillStyle = col('ink-light');
    ctx.textAlign = 'center';
    ctx.fillText('0', X(0), B + 13); ctx.fillText('255', X(255) - 6, B + 13);
    ctx.font = 'italic 13px "Cormorant Garamond", serif'; ctx.fillText('r', X(128), B + 16);
    ctx.textAlign = 'right'; ctx.font = '10px Inter, sans-serif';
    ctx.fillText('255', L - 4, Y(255) + 8); ctx.fillText('0', L - 4, Y(0));
    ctx.font = 'italic 13px "Cormorant Garamond", serif'; ctx.fillText('s', L - 6, Y(128) + 4);
    ctx.font = '10px Inter, sans-serif';
    return { ctx, X, Y, S, L, T, B };
  }

  /**
   * Transfer function s = T(r).
   * o.knots: [{r, s}] drawn as handles · o.probe: r to trace to its s
   * Returns the pixel↔value mapping so a lab can make the knots draggable.
   */
  function drawCurve(canvas, lut, o) {
    o = o || {};
    const a = squareAxes(canvas), { ctx, X, Y } = a;
    ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(26,26,26,.3)';
    ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.lineTo(X(255), Y(255)); ctx.stroke(); ctx.restore();

    ctx.save(); ctx.strokeStyle = col('vermillion'); ctx.lineWidth = 2; ctx.beginPath();
    for (let r = 0; r < 256; r++) r ? ctx.lineTo(X(r), Y(lut[r])) : ctx.moveTo(X(r), Y(lut[r]));
    ctx.stroke(); ctx.restore();

    if (o.probe != null) {
      const r = o.probe, s = lut[r];
      ctx.save(); ctx.setLineDash([2, 3]); ctx.strokeStyle = col('ink');
      ctx.beginPath(); ctx.moveTo(X(r), Y(0)); ctx.lineTo(X(r), Y(s)); ctx.lineTo(X(0), Y(s)); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = col('ink'); ctx.beginPath(); ctx.arc(X(r), Y(s), 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.font = '10px Inter, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(r, X(r), Y(0) - 4); ctx.textAlign = 'left'; ctx.fillText(s, X(0) + 4, Y(s) - 4);
    }
    (o.knots || []).forEach(k => {
      ctx.fillStyle = col('paper'); ctx.strokeStyle = col('vermillion'); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(X(k.r), Y(k.s), 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    });
    return a;
  }

  /** A plain line over k = 0…255 (e.g. Otsu's between-class variance). */
  function drawSeries(canvas, arr, o) {
    o = o || {};
    const { ctx, w, h } = fit(canvas, o.height || 120);
    const L = 6, R = 6, T = 12, B = h - 18, pw = w - L - R;
    let max = 0;
    for (let k = 0; k < 256; k++) if (isFinite(arr[k]) && arr[k] > max) max = arr[k];
    max = max || 1;
    const X = k => L + ((k + 0.5) / 256) * pw, Y = v => B - (v / max) * (B - T);
    ctx.strokeStyle = 'rgba(26,26,26,.12)';
    ctx.beginPath(); ctx.moveTo(L, B + 0.5); ctx.lineTo(L + pw, B + 0.5); ctx.stroke();
    ctx.save(); ctx.fillStyle = 'rgba(107,122,90,.16)'; ctx.strokeStyle = col('sage'); ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(X(0), B);
    for (let k = 0; k < 256; k++) ctx.lineTo(X(k), Y(isFinite(arr[k]) ? arr[k] : 0));
    ctx.lineTo(X(255), B); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    ctx.fillStyle = col('ink-light'); ctx.textAlign = 'left'; ctx.fillText('0', L, h - 4);
    ctx.textAlign = 'right'; ctx.fillText('255', L + pw, h - 4);
    markers(ctx, o.markers, X, T, B, w);
  }

  // Charts are sized from CSS, so they redraw when the layout changes
  const resizers = [];
  let rsTimer;
  window.addEventListener('resize', () => {
    clearTimeout(rsTimer);
    rsTimer = setTimeout(() => resizers.forEach(fn => fn()), 120);
  });
  const onResize = fn => resizers.push(fn);

  /* ═════ the stage: before/after view + pixel inspector ═════
     const st = IP.stage(el, { compare: true, explain: (r, s, x, y) => html })
     st.set(before, after)     — after may be omitted for a single image
     st.onProbe = (r, s, x, y) => {}   — called as the reader points at pixels
  */
  function stage(el, opts) {
    if (typeof el === 'string') el = document.getElementById(el);
    opts = opts || {};
    const compare = opts.compare !== false;
    el.classList.add('ip-stage');
    el.innerHTML =
      '<div class="ip-view">' +
        '<div class="ip-frame" tabindex="0" aria-label="Image. Point at it, or use the arrow keys, to read pixel values.">' +
          '<canvas class="ip-after"></canvas>' +
          (compare ? '<canvas class="ip-before"></canvas>' : '') +
          '<div class="ip-mark" hidden></div>' +
          (compare ? '<div class="ip-divider" role="slider" tabindex="0" aria-label="Before and after divider" ' +
                     'aria-valuemin="0" aria-valuemax="100" aria-valuenow="50"><span></span></div>' +
                     '<span class="ip-tag l">' + (opts.beforeLabel || 'Before') + '</span>' +
                     '<span class="ip-tag r">' + (opts.afterLabel || 'After') + '</span>' : '') +
        '</div>' +
        '<span class="ip-dim"></span>' +
      '</div>' +
      '<div class="ip-inspect" aria-live="polite">' +
        '<span class="label">Pixel inspector</span>' +
        '<p class="ip-where">Point at the image to read its pixels.</p>' +
        '<div class="ip-hoods">' +
          '<div><span class="ip-hood-cap">' + (compare ? 'Before' : 'Values') + '</span><div class="ip-hood" data-k="a"></div></div>' +
          (compare ? '<div><span class="ip-hood-cap">After</span><div class="ip-hood" data-k="b"></div></div>' : '') +
        '</div>' +
        '<div class="ip-explain"></div>' +
      '</div>';

    const frame = el.querySelector('.ip-frame');
    const cA = el.querySelector('.ip-after'), cB = el.querySelector('.ip-before');
    const mark = el.querySelector('.ip-mark'), div = el.querySelector('.ip-divider');
    const where = el.querySelector('.ip-where'), explain = el.querySelector('.ip-explain');
    const dim = el.querySelector('.ip-dim');
    const hoods = Array.from(el.querySelectorAll('.ip-hood')).map(h => {
      const cells = [];
      for (let i = 0; i < 25; i++) {
        const c = document.createElement('div');
        c.className = 'cell' + (i === 12 ? ' here' : '');
        h.appendChild(c); cells.push(c);
      }
      return cells;
    });

    const api = { before: null, after: null, onProbe: null, probe: null };
    let pct = 50;

    const setDivider = p => {
      pct = clamp(p, 0, 100);
      if (!div) return;
      div.style.left = pct + '%';
      div.setAttribute('aria-valuenow', String(Math.round(pct)));
      cB.style.clipPath = 'inset(0 ' + (100 - pct) + '% 0 0)';
    };

    function fillHood(cells, img, x, y) {
      for (let j = -2; j <= 2; j++)
        for (let i = -2; i <= 2; i++) {
          const c = cells[(j + 2) * 5 + (i + 2)], xx = x + i, yy = y + j;
          const inside = img && xx >= 0 && yy >= 0 && xx < img.w && yy < img.h;
          const v = inside ? img.data[yy * img.w + xx] : null;
          c.textContent = v == null ? '·' : v;
          c.classList.toggle('pad', v == null);
          if (i || j) {
            c.style.background = v == null ? '' : 'rgb(' + v + ',' + v + ',' + v + ')';
            c.style.color = v == null ? '' : v < 128 ? '#f4ede0' : '#1a1a1a';
          }
        }
    }

    function probe(x, y) {
      const img = api.before;
      if (!img) return;
      x = clamp(x, 0, img.w - 1); y = clamp(y, 0, img.h - 1);
      api.probe = { x, y };
      const out = api.after || img, i = y * img.w + x;
      const r = img.data[i], s = out.data[i];
      mark.hidden = false;
      mark.style.left = ((x - 2) / img.w * 100) + '%';
      mark.style.top = ((y - 2) / img.h * 100) + '%';
      mark.style.width = (5 / img.w * 100) + '%';
      mark.style.height = (5 / img.h * 100) + '%';
      where.innerHTML = 'Pixel <b>(' + x + ', ' + y + ')</b>';
      fillHood(hoods[0], img, x, y);
      if (hoods[1]) fillHood(hoods[1], out, x, y);
      explain.innerHTML = opts.explain ? opts.explain(r, s, x, y) : '';
      if (api.onProbe) api.onProbe(r, s, x, y);
    }

    function pixelAt(e) {
      const rc = frame.getBoundingClientRect(), img = api.before;
      return {
        x: Math.floor((e.clientX - rc.left) / rc.width * img.w),
        y: Math.floor((e.clientY - rc.top) / rc.height * img.h)
      };
    }

    let dragging = false;
    frame.addEventListener('pointermove', e => {
      if (!api.before) return;
      if (dragging) {
        const rc = frame.getBoundingClientRect();
        setDivider((e.clientX - rc.left) / rc.width * 100);
        return;
      }
      const p = pixelAt(e); probe(p.x, p.y);
    });
    frame.addEventListener('pointerdown', e => {
      if (!api.before) return;
      if (div && (e.target === div || div.contains(e.target))) {
        dragging = true; frame.setPointerCapture(e.pointerId); e.preventDefault(); return;
      }
      const p = pixelAt(e); probe(p.x, p.y);
    });
    const endDrag = e => { if (dragging) { dragging = false; try { frame.releasePointerCapture(e.pointerId); } catch (_) {} } };
    frame.addEventListener('pointerup', endDrag);
    frame.addEventListener('pointercancel', endDrag);
    frame.addEventListener('pointerleave', () => { if (!dragging) mark.hidden = true; });

    frame.addEventListener('keydown', e => {
      if (!api.before || e.target !== frame) return;
      const p = api.probe || { x: api.before.w >> 1, y: api.before.h >> 1 }, st = e.shiftKey ? 10 : 1;
      const mv = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.key];
      if (!mv) return;
      e.preventDefault(); probe(p.x + mv[0], p.y + mv[1]);
    });
    if (div) div.addEventListener('keydown', e => {
      const st = e.shiftKey ? 10 : 2;
      if (e.key === 'ArrowLeft') setDivider(pct - st);
      else if (e.key === 'ArrowRight') setDivider(pct + st);
      else return;
      e.preventDefault(); e.stopPropagation();
    });

    api.set = (before, after) => {
      const sizeChanged = !api.before || api.before.w !== before.w || api.before.h !== before.h;
      api.before = before; api.after = after || null;
      if (compare) { drawGray(cB, before); drawGray(cA, after || before); }
      else drawGray(cA, after || before);
      frame.style.aspectRatio = before.w + ' / ' + before.h;
      dim.textContent = before.w + ' × ' + before.h + ' px · ' + (before.w * before.h).toLocaleString() + ' pixels';
      if (sizeChanged) { api.probe = null; mark.hidden = true; }
      else if (api.probe) probe(api.probe.x, api.probe.y);
    };
    api.refreshProbe = () => { if (api.probe) probe(api.probe.x, api.probe.y); };
    setDivider(50);
    return api;
  }

  /* ═════ "try this" challenges ═════
     const tries = IP.tries(el, [{ text, test: () => bool }]);  tries.check();
     A challenge, once met, stays ticked — the reader earned it. */
  function tries(el, items) {
    if (typeof el === 'string') el = document.getElementById(el);
    el.classList.add('ip-tries');
    el.innerHTML = '<span class="label">Try this</span><ol></ol>';
    const ol = el.querySelector('ol'), done = items.map(() => false);
    const lis = items.map(it => {
      const li = document.createElement('li');
      li.innerHTML = '<span class="ip-box" aria-hidden="true"></span><span>' + it.text + '</span>';
      ol.appendChild(li); return li;
    });
    return {
      check() {
        items.forEach((it, i) => {
          if (done[i]) return;
          let ok = false;
          try { ok = Boolean(it.test()); } catch (_) {}
          if (ok) { done[i] = true; lis[i].classList.add('done'); lis[i].setAttribute('aria-label', 'Done: ' + lis[i].textContent); }
        });
      }
    };
  }

  /* ═════ neighbourhood operations ═════
     Float images are { w, h, data: Float32Array } — filters can go negative
     or past 255, and the lab decides how to display that. */

  const makeF = (w, h) => ({ w, h, data: new Float32Array(w * h) });

  /** Seeded PRNG, so "the same noise" really is the same between renders. */
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /**
   * Index map for coordinates -r … n-1+r under a border rule.
   * zero → -1 (read as 0) · replicate → nearest edge · reflect → mirror, edge not repeated
   */
  function borderMap(n, r, mode) {
    const m = new Int32Array(n + 2 * r);
    for (let i = -r; i < n + r; i++) {
      let j = i;
      if (i < 0 || i >= n) {
        if (mode === 'zero') j = -1;
        else if (mode === 'reflect') { j = i < 0 ? -i : 2 * (n - 1) - i; j = clamp(j, 0, n - 1); }
        else j = clamp(i, 0, n - 1);
      }
      m[i + r] = j;
    }
    return m;
  }

  /**
   * Correlation: g(x,y) = Σ_s Σ_t w(s,t) f(x+s, y+t), kernel k is kw×kh row-major.
   * For convolution pass flip(k) — convolution is correlation with the kernel rotated 180°.
   */
  function correlate(img, k, kw, kh, border) {
    const { w, h, data } = img, rx = kw >> 1, ry = kh >> 1, out = makeF(w, h), o = out.data;
    const mx = borderMap(w, rx, border || 'replicate'), my = borderMap(h, ry, border || 'replicate');
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let acc = 0, i = 0;
        for (let t = 0; t < kh; t++) {
          const yy = my[y + t];
          if (yy < 0) { i += kw; continue; }
          const row = yy * w;
          for (let s = 0; s < kw; s++, i++) {
            const wt = k[i];
            if (!wt) continue;
            const xx = mx[x + s];
            if (xx >= 0) acc += wt * data[row + xx];
          }
        }
        o[y * w + x] = acc;
      }
    return out;
  }
  const flip = k => Array.from(k).reverse();

  /** A symmetric 1-D kernel applied along rows then columns — n² work becomes 2n. */
  function separable(img, k1, border) {
    const n = k1.length;
    return correlate(correlate(img, k1, n, 1, border), k1, 1, n, border);
  }

  /** Sampled Gaussian, radius ⌈3σ⌉, normalised to sum 1. */
  function gauss1d(sigma) {
    const r = Math.max(1, Math.ceil(3 * sigma)), k = [];
    let sum = 0;
    for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(v); sum += v; }
    return k.map(v => v / sum);
  }

  /**
   * Order-statistic filter over a (2r+1)² window, replicate border.
   * q = 0 → min, 0.5 → median, 1 → max. A running histogram per row (Huang's
   * method) keeps it fast enough for a slider.
   */
  function rank(img, r, q) {
    const { w, h, data } = img, out = make(w, h), hist = new Int32Array(256);
    const n = (2 * r + 1) * (2 * r + 1), target = Math.round(q * (n - 1));
    const cx = x => x < 0 ? 0 : x >= w ? w - 1 : x, cy = y => y < 0 ? 0 : y >= h ? h - 1 : y;
    for (let y = 0; y < h; y++) {
      hist.fill(0);
      for (let dy = -r; dy <= r; dy++) {
        const row = cy(y + dy) * w;
        for (let dx = -r; dx <= r; dx++) hist[data[row + cx(dx)]]++;
      }
      for (let x = 0; x < w; x++) {
        if (x > 0) {
          const xo = cx(x - r - 1), xi = cx(x + r);
          for (let dy = -r; dy <= r; dy++) {
            const row = cy(y + dy) * w;
            hist[data[row + xo]]--; hist[data[row + xi]]++;
          }
        }
        let acc = 0, v = 0;
        for (; v < 256; v++) { acc += hist[v]; if (acc > target) break; }
        out.data[y * w + x] = v;
      }
    }
    return out;
  }

  /** 'sp': salt-and-pepper with density `amount` · 'gauss': additive, σ = `amount` grey levels */
  function noise(img, type, amount, seed) {
    const out = clone(img), d = out.data, rnd = rng(seed || 1);
    if (type === 'sp') {
      for (let i = 0; i < d.length; i++) if (rnd() < amount) d[i] = rnd() < 0.5 ? 0 : 255;
    } else {
      for (let i = 0; i < d.length; i += 2) {
        const u = Math.max(rnd(), 1e-12), v = rnd(), m = Math.sqrt(-2 * Math.log(u));
        d[i] = img.data[i] + amount * m * Math.cos(2 * Math.PI * v);
        if (i + 1 < d.length) d[i + 1] = img.data[i + 1] + amount * m * Math.sin(2 * Math.PI * v);
      }
    }
    return out;
  }

  /** Peak signal-to-noise ratio in dB against a clean reference. Higher is closer. */
  function psnr(ref, test) {
    let se = 0;
    const a = ref.data, b = test.data;
    for (let i = 0; i < a.length; i++) { const e = a[i] - b[i]; se += e * e; }
    const mse = se / a.length;
    return mse === 0 ? Infinity : 10 * Math.log10(255 * 255 / mse);
  }

  /**
   * Float → displayable 8-bit.
   * clamp: round and clip · abs: |v| scaled so the 99.5th percentile is white
   * offset: 128 + v·scale, so zero is mid-grey and sign is visible
   */
  function toDisplay(f, how) {
    const out = make(f.w, f.h), d = f.data, o = out.data;
    if (how === 'clamp' || !how) {
      for (let i = 0; i < d.length; i++) o[i] = d[i];
      return { img: out, scale: 1 };
    }
    const step = Math.max(1, Math.floor(d.length / 20000)), sample = [];
    for (let i = 0; i < d.length; i += step) sample.push(Math.abs(d[i]));
    sample.sort((a, b) => a - b);
    const p = Math.max(sample[Math.floor(sample.length * 0.995)] || 0, 1e-6);
    const scale = how === 'abs' ? 255 / p : 127 / p;
    for (let i = 0; i < d.length; i++) o[i] = how === 'abs' ? Math.abs(d[i]) * scale : 128 + d[i] * scale;
    return { img: out, scale };
  }

  /**
   * Intensity along one row. series: [{ data, color, width, dash, label }]
   * The range grows past 0–255 when a filter overshoots, so clipping is visible.
   */
  function drawProfile(canvas, series, o) {
    o = o || {};
    const { ctx, w, h } = fit(canvas, o.height || 140);
    let lo = 0, hi = 255;
    series.forEach(s => { for (let i = 0; i < s.data.length; i++) { if (s.data[i] < lo) lo = s.data[i]; if (s.data[i] > hi) hi = s.data[i]; } });
    const L = 30, R = 6, T = 16, B = h - 16, n = series[0].data.length;
    const X = i => L + (i / Math.max(1, n - 1)) * (w - L - R), Y = v => B - (v - lo) / (hi - lo) * (B - T);
    ctx.fillStyle = col('ink-light'); ctx.textAlign = 'right';
    [0, 255].forEach(v => {
      ctx.save(); ctx.strokeStyle = 'rgba(26,26,26,.18)'; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(L, Y(v)); ctx.lineTo(w - R, Y(v)); ctx.stroke(); ctx.restore();
      ctx.fillText(v, L - 4, Y(v) + 3);
    });
    if (lo < 0) ctx.fillText(Math.round(lo), L - 4, B + 3);
    if (hi > 255) ctx.fillText(Math.round(hi), L - 4, T + 3);
    if (o.shade) { ctx.fillStyle = 'rgba(184,65,46,.07)'; ctx.fillRect(L, T, w - L - R, Y(255) - T); ctx.fillRect(L, Y(0), w - L - R, B - Y(0)); }
    let lx = L + 4;
    series.forEach(s => {
      ctx.save(); ctx.strokeStyle = s.color || col('ink'); ctx.lineWidth = s.width || 1.2;
      if (s.dash) ctx.setLineDash(s.dash);
      ctx.beginPath();
      for (let i = 0; i < n; i++) i ? ctx.lineTo(X(i), Y(s.data[i])) : ctx.moveTo(X(i), Y(s.data[i]));
      ctx.stroke(); ctx.restore();
      if (s.label) {
        ctx.fillStyle = s.color || col('ink'); ctx.textAlign = 'left';
        ctx.fillRect(lx, 5, 10, 2); ctx.fillText(s.label, lx + 14, 10);
        lx += ctx.measureText(s.label).width + 30;
      }
    });
    if (o.marker != null) vline(ctx, X(o.marker), T, B, col('vermillion'), [2, 3]);
  }

  /* ═════ frequency domain ═════
     A radix-2 FFT on n×n images, n a power of two. Spectra are kept
     un-centred (DC at [0]); centring is a display concern — see shiftIndex. */

  /** Centre-crop to a square and resample to n×n, so the DFT is exact and fast. */
  function square(img, n) {
    const s = Math.min(img.w, img.h), x0 = (img.w - s) >> 1, y0 = (img.h - s) >> 1;
    const src = document.createElement('canvas'); src.width = img.w; src.height = img.h;
    drawGray(src, img);
    const c = document.createElement('canvas'); c.width = c.height = n;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, x0, y0, s, s, 0, 0, n, n);
    const d = ctx.getImageData(0, 0, n, n).data, out = make(n, n);
    for (let i = 0; i < n * n; i++) out.data[i] = d[i * 4];
    return out;
  }

  const twiddles = {};
  function fft1(re, im, inverse) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {                      // bit-reversal permutation
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    let tw = twiddles[n];
    if (!tw) {
      tw = twiddles[n] = { c: new Float64Array(n / 2), s: new Float64Array(n / 2) };
      for (let k = 0; k < n / 2; k++) { tw.c[k] = Math.cos(2 * Math.PI * k / n); tw.s[k] = Math.sin(2 * Math.PI * k / n); }
    }
    const sg = inverse ? 1 : -1;
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1, step = n / len;
      for (let i = 0; i < n; i += len)
        for (let k = 0; k < half; k++) {
          const wr = tw.c[k * step], wi = sg * tw.s[k * step];
          const a = i + k, b = a + half;
          const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
    }
  }
  /** In-place 2-D FFT of n×n real/imag arrays. The inverse includes the 1/n² factor. */
  function fft2(re, im, n, inverse) {
    const r = new Float64Array(n), i = new Float64Array(n);
    for (let y = 0; y < n; y++) {
      const o = y * n;
      for (let x = 0; x < n; x++) { r[x] = re[o + x]; i[x] = im[o + x]; }
      fft1(r, i, inverse);
      for (let x = 0; x < n; x++) { re[o + x] = r[x]; im[o + x] = i[x]; }
    }
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) { r[y] = re[y * n + x]; i[y] = im[y * n + x]; }
      fft1(r, i, inverse);
      for (let y = 0; y < n; y++) { re[y * n + x] = r[y]; im[y * n + x] = i[y]; }
    }
    if (inverse) { const s = 1 / (n * n); for (let k = 0; k < n * n; k++) { re[k] *= s; im[k] *= s; } }
  }
  /** DFT of an n×n image → { n, re, im }. */
  function dft(img) {
    const n = img.w, re = new Float64Array(n * n), im = new Float64Array(n * n);
    for (let k = 0; k < n * n; k++) re[k] = img.data[k];
    fft2(re, im, n, false);
    return { n, re, im };
  }
  /** Inverse DFT → float image (real part; the imaginary part is rounding noise for a real input). */
  function idft(F) {
    const n = F.n, re = Float64Array.from(F.re), im = Float64Array.from(F.im);
    fft2(re, im, n, true);
    const out = makeF(n, n);
    for (let k = 0; k < n * n; k++) out.data[k] = re[k];
    return out;
  }
  /** Map display pixel (x, y) to spectrum index, optionally centred (DC in the middle). */
  const shiftIndex = (x, y, n, centred) => centred ? ((y + n / 2) % n) * n + (x + n / 2) % n : y * n + x;
  /** Frequency (u, v) of a spectrum index, in cycles per image, −n/2 … n/2−1. */
  const freqOf = (k, n) => { const x = k % n, y = (k / n) | 0; return { u: x < n / 2 ? x : x - n, v: y < n / 2 ? y : y - n }; };

  /** Spectrum → displayable image. how: 'log' | 'linear' | 'phase'. */
  function spectrumImage(F, how, centred) {
    const n = F.n, out = make(n, n), val = new Float64Array(n * n);
    let max = 0;
    for (let k = 0; k < n * n; k++) {
      const m = Math.hypot(F.re[k], F.im[k]);
      val[k] = how === 'phase' ? Math.atan2(F.im[k], F.re[k]) : how === 'log' ? Math.log(1 + m) : m;
      if (how !== 'phase' && val[k] > max) max = val[k];
    }
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const v = val[shiftIndex(x, y, n, centred)];
        out.data[y * n + x] = how === 'phase' ? (v + Math.PI) / (2 * Math.PI) * 255 : max ? v / max * 255 : 0;
      }
    return out;
  }

  /** One row of an image (8-bit or float) as a plain array, for drawProfile. */
  const row = (img, y) => Array.from(img.data.subarray(y * img.w, (y + 1) * img.w));

  return {
    SAMPLES, make, makeF, clone, applyLUT, histogram, cdf, stats,
    useSample, setImage, onImage: fn => bus.subs.push(fn),
    get image() { return bus.img; }, get key() { return bus.key; },
    picker, stage, tries, drawGray, drawHist, drawCurve, drawSeries, drawProfile, onResize, col,
    rng, correlate, flip, separable, gauss1d, rank, noise, psnr, toDisplay, row,
    square, fft2, dft, idft, shiftIndex, freqOf, spectrumImage
  };
})();
