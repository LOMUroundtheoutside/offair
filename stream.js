/* Stream — makes the station look like a live stream: LIVE badge with uptime, station chip in the
   station's own colour, a (made-up) viewer count that drifts, a lower-third on each song and a
   ticker of what the station played recently. Purely a look: playback is the normal Watch mode. */
(() => {
  const { S, toast } = Offair;
  const $ = s => document.querySelector(s);
  let on = false, started = 0, tick = 0, viewers = 0, lowerT = 0;
  const hash = s => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
  const fmt = n => n.toLocaleString();
  const pad = n => String(n).padStart(2, '0');

  function baseViewers() {
    const st = S.station; if (!st) return 500;
    const h = new Date().getHours(), day = h >= 7 && h <= 22 ? 1 : .45;          /* quieter overnight */
    return Math.round((350 + hash(st.id) % 3200) * day);
  }
  function drift() {
    const base = baseViewers();
    viewers += Math.round((Math.random() - .47) * Math.max(6, viewers * .015)); /* random walk that leans slightly upward */
    viewers = Math.max(Math.round(base * .6), Math.min(Math.round(base * 1.6), viewers));
    $('#st-viewers-n').textContent = fmt(viewers);
  }
  function uptime() {
    const s = Math.floor((Date.now() - started) / 1000);
    $('#st-uptime').textContent = `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s % 3600 / 60))}:${pad(s % 60)}`;
  }
  function theme() {
    const st = S.station, col = (st && st.col) || '#c8ff3d';
    const ui = $('#stream-ui'); ui.style.setProperty('--st', col);
    ui.dataset.style = $('#stream-style').value; $('#video').classList.toggle('st-broadcast', ui.dataset.style === 'broadcast');
    ui.classList.toggle('no-viewers', !$('#stream-viewers').checked);
    ui.classList.toggle('no-ticker', !$('#stream-ticker').checked);
    if (st) { $('#st-logo').src = Offair.stationLogo ? Offair.stationLogo(st) : st.logo; $('#st-name').textContent = st.name; $('#st-meta').textContent = st.freq || st.genre || ''; }
  }
  function ticker() {
    const cur = S.cur, list = S.plays.filter(p => !cur || p.at < cur.at).slice(-12).reverse();
    const text = list.length ? list.map(p => `♪ ${p.a} – ${p.t}`).join('   •   ') : `♪ ${S.station ? S.station.name : 'Offair'} · live music videos, no ads`;
    const el = $('#st-ticker-text'); el.textContent = `${text}   •   ${text}   •   `;
    el.style.animationDuration = Math.max(20, text.length / 6) + 's';
  }
  function songChanged(play) {
    if (!on || !play) return;
    $('#st-title').textContent = play.t; $('#st-artist').textContent = play.a;
    const lower = $('#st-lower'); lower.classList.remove('show'); void lower.offsetWidth; lower.classList.add('show');
    clearTimeout(lowerT); lowerT = setTimeout(() => lower.classList.remove('show'), 9000);
    ticker();
  }
  function start() {
    if (on) return;
    if (!S.cur) { toast('Pick a station first, then go live'); return; }
    on = true; started = Date.now(); viewers = baseViewers();
    document.body.classList.add('stream'); $('#view-watch').hidden = false; $('#view-quiz').hidden = true; $('#view-saver').hidden = true; $('#view-stream').hidden = true;
    theme(); uptime(); drift(); tick = setInterval(() => { uptime(); if (Math.random() < .3) drift(); }, 1000);
    const p = Offair.player; if (p && S.ready && S.armed) { try { p.playVideo(); } catch {} }
    const el = $('#video'); if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    songChanged(S.cur);
  }
  function stop() {
    if (!on) return; on = false; clearInterval(tick); clearTimeout(lowerT);
    document.body.classList.remove('stream');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    Offair.setMode('watch');
  }
  function enter() { theme(); }
  /* leaving fullscreen (Esc, or the strip's Exit) ends the stream look; mouse movement does not */
  document.addEventListener('fullscreenchange', () => { if (on && !document.fullscreenElement && Date.now() - started > 1500) stop(); });
  $('#stream-go').onclick = start;
  ['#stream-style', '#stream-viewers', '#stream-ticker'].forEach(sel => $(sel).onchange = () => { S.streamStyle = $('#stream-style').value; S.streamViewers = $('#stream-viewers').checked; S.streamTicker = $('#stream-ticker').checked; Offair.save(); theme(); });
  $('#stream-style').value = S.streamStyle || 'studio'; $('#stream-viewers').checked = S.streamViewers !== false; $('#stream-ticker').checked = S.streamTicker !== false;
  window.Stream = { enter, start, stop, songChanged, get on() { return on; } };
})();
