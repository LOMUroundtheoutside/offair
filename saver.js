/* Screensaver — fullscreen video with slow generative colour in the station's own palette. */
(() => {
  const { S, toast } = Offair;
  const $ = s => document.querySelector(s);
  const canvas = $('#saver-canvas'), ctx = canvas.getContext('2d');
  let on = false, raf = 0, started = 0, clockTimer = 0, style = 'aurora', hue = 120;

  const hexToHue = hex => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 120; const n = parseInt(m[1], 16), r = (n >> 16) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255, max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min; if (!d) return 120; let h = max === r ? (g - b) / d % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; return (h * 60 + 360) % 360; };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function resize() { canvas.width = canvas.clientWidth * Math.min(2, devicePixelRatio || 1); canvas.height = canvas.clientHeight * Math.min(2, devicePixelRatio || 1); }
  function clock() { const d = new Date(); $('#saver-clock').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

  const styles = {
    aurora(t, W, H) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 4; i++) {
        const a = t * (.00007 + i * .00002) + i * 1.7, x = W / 2 + Math.cos(a) * W * .35 + Math.sin(a * 1.3) * W * .1, y = H / 2 + Math.sin(a * .8) * H * .35, r = Math.max(W, H) * (.35 + .1 * Math.sin(a * 2));
        const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `hsla(${(hue + i * 40) % 360}, 90%, 55%, .28)`); g.addColorStop(1, 'hsla(0,0%,0%,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      }
      ctx.globalCompositeOperation = 'source-over';
    },
    grid(t, W, H) {
      const horizon = H * .58, n = 18; ctx.strokeStyle = `hsla(${hue}, 90%, 60%, .55)`; ctx.lineWidth = Math.max(1, W / 900);
      const glow = ctx.createLinearGradient(0, horizon - H * .2, 0, horizon); glow.addColorStop(0, 'hsla(0,0%,0%,0)'); glow.addColorStop(1, `hsla(${hue}, 90%, 55%, .35)`); ctx.fillStyle = glow; ctx.fillRect(0, horizon - H * .2, W, H * .2);
      ctx.beginPath(); for (let i = -n; i <= n; i++) { ctx.moveTo(W / 2 + i * W * .08, horizon); ctx.lineTo(W / 2 + i * W * .6, H * 1.3); }
      const phase = (t * .00025) % 1; for (let k = 0; k < 14; k++) { const z = (k + phase) / 14, y = horizon + Math.pow(z, 2.2) * (H - horizon) * 1.05; ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();
      ctx.fillStyle = `hsla(${(hue + 180) % 360}, 90%, 60%, .18)`; ctx.beginPath(); ctx.arc(W * .78, horizon - H * .14, H * .13, 0, 7); ctx.fill();
    },
    orbit(t, W, H) {
      const cx = W / 2, cy = H / 2, R = Math.min(W, H) * .32;
      for (let ring = 0; ring < 5; ring++) {
        const r = R * (.45 + ring * .16), n = 24 + ring * 10, spin = t * (.00012 + ring * .00003) * (ring % 2 ? -1 : 1);
        ctx.fillStyle = `hsla(${(hue + ring * 25) % 360}, 90%, 65%, ${.55 - ring * .07})`;
        for (let i = 0; i < n; i++) { const a = spin + i / n * Math.PI * 2, w = 1 + .12 * Math.sin(t * .0009 + i * .7 + ring), x = cx + Math.cos(a) * r * w, y = cy + Math.sin(a) * r * w * .62; ctx.beginPath(); ctx.arc(x, y, 1.6 + ring * .6 + Math.sin(t * .002 + i) * .8, 0, 7); ctx.fill(); }
      }
    },
  };
  function frame(t) {
    if (!on) return; const W = canvas.width, H = canvas.height; ctx.clearRect(0, 0, W, H);
    if (!reduced) styles[style](t, W, H); else styles[style](1e6, W, H);
    raf = requestAnimationFrame(frame);
  }
  function start() {
    if (on) return;
    if (!S.cur) { toast('Pick a station first, then start the screensaver'); return; }
    style = $('#saver-style').value; hue = hexToHue(S.station && S.station.col);
    on = true; started = Date.now(); document.body.classList.add('saver'); document.body.classList.toggle('dim', $('#saver-dim').checked);
    $('#view-watch').hidden = false; $('#view-quiz').hidden = true; $('#view-saver').hidden = true;
    resize(); clock(); clockTimer = setInterval(clock, 1000); raf = requestAnimationFrame(frame);
    const p = Offair.player; if (p && S.ready) { try { if ($('#saver-mute').checked) p.mute(); else { p.unMute(); p.setVolume(S.vol); } if (S.armed) p.playVideo(); } catch {} }
    const el = $('#video'); if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    setTimeout(() => document.body.classList.add('settled'), 3000);
    $('#saver-station').textContent = S.station ? `${S.station.name} · ${S.station.freq}` : ''; if (S.cur) { $('#saver-title').textContent = S.cur.t; $('#saver-artist').textContent = S.cur.a; }
  }
  function stop() {
    if (!on) return; on = false; cancelAnimationFrame(raf); clearInterval(clockTimer);
    document.body.classList.remove('saver', 'dim', 'settled');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    Offair.setMode('watch');
  }
  const leave = () => { if (on && Date.now() - started > 1500) stop(); };
  window.addEventListener('mousemove', leave); window.addEventListener('keydown', e => { if (on && e.key === 'Escape') stop(); else leave(); }); window.addEventListener('pointerdown', leave); window.addEventListener('touchstart', leave, { passive: true });
  document.addEventListener('fullscreenchange', () => { if (on && !document.fullscreenElement && Date.now() - started > 1500) stop(); resize(); });
  window.addEventListener('resize', resize);
  $('#saver-go').onclick = start;
  window.Saver = { start, stop };
})();
