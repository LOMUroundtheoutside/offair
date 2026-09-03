/* Screensaver — fullscreen video with slow generative visuals coloured from the album art. */
(() => {
  const { S, toast } = Offair;
  const $ = s => document.querySelector(s);
  const canvas = $('#saver-canvas'), ctx = canvas.getContext('2d');
  let barsV = null, on = false, raf = 0, started = 0, clockTimer = 0, driftTimer = 0, style = 'aurora', palette = [{ h: 120, s: 80, l: 55 }], artImg = null, lastInput = Date.now();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hexToHsl = hex => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return { h: 120, s: 80, l: 55 }; const n = parseInt(m[1], 16); return rgbToHsl((n >> 16) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); };
  function rgbToHsl(r, g, b) { const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2; if (!d) return { h: 0, s: 0, l: l * 100 }; const s = d / (1 - Math.abs(2 * l - 1)); let h = max === r ? (g - b) / d % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; return { h: (h * 60 + 360) % 360, s: s * 100, l: l * 100 }; }
  const col = (i, a = 1, dl = 0) => { const c = palette[i % palette.length]; return `hsla(${c.h.toFixed(0)}, ${Math.max(45, c.s).toFixed(0)}%, ${Math.min(75, Math.max(40, c.l + dl)).toFixed(0)}%, ${a})`; };

  /* sample the album art (it is served with CORS) for a palette; fall back to the station colour */
  function loadArt(play) {
    palette = [hexToHsl(S.station && S.station.col)]; artImg = null;
    if (!play || !play.art) return;
    const img = new Image(); img.crossOrigin = 'anonymous'; img.src = play.art;
    img.onload = () => {
      artImg = img;
      try {
        const c = document.createElement('canvas'), x = c.getContext('2d'); c.width = c.height = 24; x.drawImage(img, 0, 0, 24, 24);
        const d = x.getImageData(0, 0, 24, 24).data, buckets = {};
        for (let i = 0; i < d.length; i += 4) { const { h, s, l } = rgbToHsl(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255); if (s < 25 || l < 12 || l > 92) continue; const k = Math.round(h / 20); (buckets[k] = buckets[k] || { n: 0, h: 0, s: 0, l: 0 }); buckets[k].n++; buckets[k].h += h; buckets[k].s += s; buckets[k].l += l; }
        const top = Object.values(buckets).sort((a, b) => b.n - a.n).slice(0, 3).map(b => ({ h: b.h / b.n, s: b.s / b.n, l: b.l / b.n }));
        if (top.length) palette = top;
      } catch {}
    };
  }

  function resize() { canvas.width = canvas.clientWidth * Math.min(2, devicePixelRatio || 1); canvas.height = canvas.clientHeight * Math.min(2, devicePixelRatio || 1); }
  function clock() { const d = new Date(); $('#saver-clock').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); $('#saver-date').textContent = d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }); }
  function drift() { /* nudge the text around slowly so nothing burns in */ $$('.saver-ui > *').forEach((el, i) => { el.style.transform = `translate(${Math.sin(Date.now() / 60000 + i) * 18}px, ${Math.cos(Date.now() / 45000 + i * 2) * 12}px)`; }); }
  const $$ = s => [...document.querySelectorAll(s)];

  const styles = {
    aurora(t, W, H) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 4; i++) {
        const a = t * (.00007 + i * .00002) + i * 1.7, x = W / 2 + Math.cos(a) * W * .35 + Math.sin(a * 1.3) * W * .1, y = H / 2 + Math.sin(a * .8) * H * .35, r = Math.max(W, H) * (.35 + .1 * Math.sin(a * 2));
        const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, col(i, .3)); g.addColorStop(1, 'hsla(0,0%,0%,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      }
      ctx.globalCompositeOperation = 'source-over';
    },
    vinyl(t, W, H) {
      const cx = W * .44, cy = H * .53, R = Math.min(W, H) * .33, spin = t * .0006;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(spin);
      ctx.fillStyle = '#0b0b0d'; ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1; for (let r = R * .42; r < R; r += R * .022) { ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.stroke(); }
      const sheen = ctx.createConicGradient ? ctx.createConicGradient(0, 0, 0) : null; if (sheen) { sheen.addColorStop(0, 'rgba(255,255,255,0)'); sheen.addColorStop(.12, col(0, .18, 10)); sheen.addColorStop(.25, 'rgba(255,255,255,0)'); sheen.addColorStop(.62, col(1, .16, 10)); sheen.addColorStop(.75, 'rgba(255,255,255,0)'); ctx.fillStyle = sheen; ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.fill(); }
      ctx.beginPath(); ctx.arc(0, 0, R * .36, 0, 7); ctx.closePath(); ctx.save(); ctx.clip();
      if (artImg) ctx.drawImage(artImg, -R * .36, -R * .36, R * .72, R * .72); else { ctx.fillStyle = col(0, 1); ctx.fillRect(-R, -R, 2 * R, 2 * R); }
      ctx.restore(); ctx.fillStyle = '#e8e8e8'; ctx.beginPath(); ctx.arc(0, 0, R * .022, 0, 7); ctx.fill(); ctx.restore();
      /* tonearm */
      ctx.save(); ctx.translate(cx + R * 1.18, cy - R * .62); ctx.rotate(.62 + Math.sin(t * .0004) * .01); ctx.strokeStyle = '#d6d6d6'; ctx.lineWidth = Math.max(4, R * .02); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, R * .82); ctx.stroke(); ctx.fillStyle = '#bdbdbd'; ctx.beginPath(); ctx.arc(0, 0, R * .06, 0, 7); ctx.fill(); ctx.restore();
    },
    bars(t, W, H) {
      const n = 48, w = W / n; barsV = barsV || Array.from({ length: n }, () => Math.random());
      for (let i = 0; i < n; i++) {
        const target = .25 + .55 * Math.abs(Math.sin(t * .0011 + i * .37) * Math.sin(t * .0007 + i * .11)) + (Math.random() - .5) * .12;
        barsV[i] += (target - barsV[i]) * .08; const h = barsV[i] * H * .55;
        const g = ctx.createLinearGradient(0, H - h, 0, H); g.addColorStop(0, col(i % 3, .9, 8)); g.addColorStop(1, col(i % 3, .05)); ctx.fillStyle = g; ctx.fillRect(i * w + w * .18, H - h, w * .64, h);
        ctx.fillStyle = col(i % 3, .9, 20); ctx.fillRect(i * w + w * .18, H - h - 6, w * .64, 3);
      }
    },
    waves(t, W, H) {
      ctx.lineWidth = Math.max(1.5, W / 700);
      for (let k = 0; k < 6; k++) {
        ctx.strokeStyle = col(k, .55 - k * .06, 5); ctx.beginPath();
        for (let x = 0; x <= W; x += 6) { const y = H * .55 + Math.sin(x / (W * .11) + t * .0009 + k * .8) * H * .09 * (1 + k * .25) + Math.sin(x / (W * .037) - t * .0013 + k) * H * .02; x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
        ctx.stroke();
      }
    },
    grid(t, W, H) {
      const horizon = H * .58, n = 18; ctx.strokeStyle = col(0, .55, 5); ctx.lineWidth = Math.max(1, W / 900);
      const glow = ctx.createLinearGradient(0, horizon - H * .2, 0, horizon); glow.addColorStop(0, 'hsla(0,0%,0%,0)'); glow.addColorStop(1, col(0, .35)); ctx.fillStyle = glow; ctx.fillRect(0, horizon - H * .2, W, H * .2);
      ctx.beginPath(); for (let i = -n; i <= n; i++) { ctx.moveTo(W / 2 + i * W * .08, horizon); ctx.lineTo(W / 2 + i * W * .6, H * 1.3); }
      const phase = (t * .00025) % 1; for (let k = 0; k < 14; k++) { const z = (k + phase) / 14, y = horizon + Math.pow(z, 2.2) * (H - horizon) * 1.05; ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();
      ctx.fillStyle = col(1, .18); ctx.beginPath(); ctx.arc(W * .78, horizon - H * .14, H * .13, 0, 7); ctx.fill();
    },
    orbit(t, W, H) {
      const cx = W / 2, cy = H / 2, R = Math.min(W, H) * .32;
      for (let ring = 0; ring < 5; ring++) {
        const r = R * (.45 + ring * .16), n = 24 + ring * 10, spin = t * (.00012 + ring * .00003) * (ring % 2 ? -1 : 1);
        ctx.fillStyle = col(ring, .55 - ring * .07, 10);
        for (let i = 0; i < n; i++) { const a = spin + i / n * Math.PI * 2, w = 1 + .12 * Math.sin(t * .0009 + i * .7 + ring), x = cx + Math.cos(a) * r * w, y = cy + Math.sin(a) * r * w * .62; ctx.beginPath(); ctx.arc(x, y, 1.6 + ring * .6 + Math.sin(t * .002 + i) * .8, 0, 7); ctx.fill(); }
      }
    },
  };
  function frame(t) {
    if (!on) return; const W = canvas.width, H = canvas.height; ctx.clearRect(0, 0, W, H);
    try { styles[style](reduced ? 1e6 : t, W, H); } catch (e) { console.error(e); }
    raf = requestAnimationFrame(frame);
  }
  function start() {
    if (on) return;
    if (!S.cur) { toast('Pick a station first, then start the screensaver'); return; }
    style = $('#saver-style').value; loadArt(S.cur);
    on = true; started = Date.now(); document.body.classList.add('saver'); document.body.classList.toggle('dim', $('#saver-dim').checked);
    $('#view-watch').hidden = false; $('#view-quiz').hidden = true; $('#view-saver').hidden = true;
    resize(); clock(); clockTimer = setInterval(clock, 1000); driftTimer = setInterval(drift, 20000); drift(); raf = requestAnimationFrame(frame);
    const p = Offair.player; if (p && S.ready) { try { if ($('#saver-mute').checked) p.mute(); else if (!S.muted) { p.unMute(); p.setVolume(S.vol); } if (S.armed) p.playVideo(); } catch {} }
    const el = $('#video'); if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    setTimeout(() => document.body.classList.add('settled'), 3000);
    songChanged(S.cur);
  }
  function stop() {
    if (!on) return; on = false; cancelAnimationFrame(raf); clearInterval(clockTimer); clearInterval(driftTimer);
    document.body.classList.remove('saver', 'dim', 'settled'); $$('.saver-ui > *').forEach(el => el.style.transform = '');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    Offair.setMode('watch');
  }
  function songChanged(play) {
    $('#saver-station').textContent = S.station ? `${S.station.name} · ${S.station.freq || S.station.genre}` : '';
    if (play) { $('#saver-title').textContent = play.t; $('#saver-artist').textContent = play.a; }
    const nx = $('#np-next'); $('#saver-next').textContent = nx && !nx.hidden ? nx.textContent.replace(/^Next: /, 'Up next · ') : '';
    if (on) loadArt(play);
  }
  const touch = () => { lastInput = Date.now(); if (on && Date.now() - started > 1500) stop(); };
  window.addEventListener('mousemove', touch); window.addEventListener('keydown', touch); window.addEventListener('pointerdown', touch); window.addEventListener('touchstart', touch, { passive: true });
  document.addEventListener('fullscreenchange', () => { if (on && !document.fullscreenElement && Date.now() - started > 1500) stop(); resize(); });
  window.addEventListener('resize', resize);
  /* idle auto-start while watching */
  $('#saver-idle').value = String(S.idleSaver || 0); $('#saver-idle').onchange = e => { S.idleSaver = +e.target.value; Offair.save(); toast(S.idleSaver ? `Screensaver will start after ${S.idleSaver / 60} minutes idle` : 'Auto-start off'); };
  setInterval(() => { if (!on && S.idleSaver && S.mode === 'watch' && S.cur && S.armed && !document.hidden && Date.now() - lastInput > S.idleSaver * 1000) start(); }, 5000);
  $('#saver-go').onclick = start;
  window.Saver = { start, stop, songChanged, enter() {} };
})();
