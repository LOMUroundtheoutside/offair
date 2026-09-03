/* Lyrics — timed lines from LRCLIB (https://lrclib.net), popped up over the video as bubbles.
   Each line appears when it is sung and pops away when the next one starts. Music videos often
   have an intro the audio track doesn't, so there is a nudge to shift the timing. */
(() => {
  const { S, toast, playerPos } = Offair;
  const $ = s => document.querySelector(s);
  const API = 'https://lrclib.net/api', HOLD_S = 12;
  let prefs = { on: true, offset: 0 };
  try { Object.assign(prefs, JSON.parse(localStorage.getItem('offair-lyrics') || '{}')); } catch {}
  const save = () => { try { localStorage.setItem('offair-lyrics', JSON.stringify(prefs)); } catch {} };
  const cache = new Map();
  let curId = null, lines = [], idx = -1, status = 'off', hideTimer = 0, told = null;
  const bubble = $('#lyric'), inner = $('#lyric-text');

  /* ---------- LRC parsing ---------- */
  function parseLrc(text) {
    const out = [];
    for (const raw of String(text).split(/\r?\n/)) {
      const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)]; if (!stamps.length) continue;
      const body = raw.replace(/\[[^\]]*\]/g, '').trim();
      for (const m of stamps) out.push({ t: +m[1] * 60 + parseFloat(m[2]), text: body });
    }
    return out.sort((a, b) => a.t - b.t);
  }

  /* ---------- fetching ---------- */
  const clean = s => String(s).replace(/\s*[\(\[].*?[\)\]]\s*/g, ' ').replace(/\s+/g, ' ').trim();
  async function lookup(play) {
    const key = `${play.a}|${play.t}|${Math.round(play.dur)}`;
    if (cache.has(key)) return cache.get(key);
    const artist = clean(play.a).split(/\s*(?:,|&|\/|\bfeat\.?\b|\bft\.?\b|\bx\b)\s*/i)[0] || play.a, title = clean(play.t);
    let found = null;
    try {
      const r = await fetch(`${API}/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}&duration=${Math.round(play.dur)}`);
      if (r.ok) { const d = await r.json(); if (d && d.syncedLyrics) found = d.syncedLyrics; }
    } catch {}
    if (!found) {
      try {
        const r = await fetch(`${API}/search?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`);
        if (r.ok) { const list = (await r.json()).filter(x => x.syncedLyrics); const near = list.find(x => Math.abs((x.duration || 0) - play.dur) <= 8) || list[0]; if (near) found = near.syncedLyrics; }
      } catch {}
    }
    const parsed = found ? parseLrc(found) : [];
    cache.set(key, parsed); return parsed;
  }

  /* ---------- the bubble ---------- */
  function show(text) {
    clearTimeout(hideTimer);
    inner.textContent = text; bubble.hidden = false;
    bubble.classList.remove('in', 'out'); void bubble.offsetWidth; bubble.classList.add('in');
  }
  function hide() {
    if (bubble.hidden || bubble.classList.contains('out')) return;
    bubble.classList.remove('in'); bubble.classList.add('out');
    clearTimeout(hideTimer); hideTimer = setTimeout(() => { bubble.hidden = true; bubble.classList.remove('out'); }, 420);
  }

  /* ---------- follow the song ---------- */
  async function songChanged(play) {
    curId = play ? play.id : null; lines = []; idx = -1; hide(); status = play ? 'loading' : 'off'; render();
    if (!play || !prefs.on) return;
    const got = await lookup(play);
    if (!S.cur || S.cur.id !== play.id) return;         /* moved on while we were fetching */
    lines = got; idx = -1; status = lines.length ? 'ok' : 'none'; render();
    if (!lines.length && told !== play.id) { told = play.id; toast(`No timed lyrics for “${play.t}”`); }
  }
  function tick() {
    if (!prefs.on || !S.cur || !S.ready) { if (!bubble.hidden) hide(); return; }
    if (S.cur.id !== curId) { songChanged(S.cur); return; }
    if (!lines.length) return;
    let st = -1; try { st = Offair.player.getPlayerState(); } catch {}
    if (st !== 1) return;                                 /* paused, buffering: leave whatever is up */
    const pos = playerPos() + prefs.offset;
    let i = -1; for (let k = 0; k < lines.length; k++) { if (lines[k].t <= pos) i = k; else break; }
    if (i !== idx) { idx = i; if (i >= 0 && lines[i].text) show(lines[i].text); else hide(); }
    else if (i >= 0 && !bubble.hidden && pos - lines[i].t > HOLD_S && (i + 1 >= lines.length || lines[i + 1].t - pos > 2)) hide();   /* long instrumental: let it go */
  }
  setInterval(tick, 200);

  /* ---------- controls ---------- */
  function render() {
    const onNow = prefs.on;
    ['#btn-lyrics', '#fsb-lyrics'].forEach(sel => { const b = $(sel); if (b) { b.classList.toggle('on', onNow); b.title = onNow ? 'Lyrics on (Y) – click for timing' : 'Lyrics off (Y)'; } });
    $('#ly-switch').checked = onNow;
    $('#ly-offset').textContent = (prefs.offset > 0 ? '+' : '') + prefs.offset.toFixed(1) + 's';
    $('#ly-status').textContent = !onNow ? 'off' : status === 'ok' ? `${lines.length} lines · LRCLIB` : status === 'none' ? 'no timed lyrics for this song' : status === 'loading' ? 'looking…' : '';
  }
  function setOn(v) { prefs.on = v; save(); if (v && S.cur) songChanged(S.cur); else { lines = []; idx = -1; hide(); status = 'off'; } render(); toast(v ? 'Lyrics on' : 'Lyrics off'); }
  function nudge(d) { prefs.offset = Math.round((prefs.offset + d) * 10) / 10; save(); idx = -1; render(); }
  const pop = $('#lyrics-pop');
  const togglePop = () => { pop.hidden = !pop.hidden; };
  $('#btn-lyrics').onclick = togglePop;
  const fsb = $('#fsb-lyrics'); if (fsb) fsb.onclick = () => setOn(!prefs.on);
  $('#ly-switch').onchange = e => setOn(e.target.checked);
  $('#ly-minus').onclick = () => nudge(-0.5); $('#ly-plus').onclick = () => nudge(0.5); $('#ly-reset').onclick = () => { prefs.offset = 0; save(); idx = -1; render(); };
  $('#ly-close').onclick = () => pop.hidden = true;
  document.addEventListener('click', e => { if (!pop.hidden && !pop.contains(e.target) && e.target !== $('#btn-lyrics')) pop.hidden = true; });
  document.addEventListener('keydown', e => { if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) return; if ((e.key === 'y' || e.key === 'Y') && !e.ctrlKey && !e.metaKey && !e.altKey) setOn(!prefs.on); });
  render();
  window.Lyrics = { show, hide, setOn, parseLrc, get lines() { return lines; }, get prefs() { return prefs; } };
})();
