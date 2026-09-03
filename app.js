/* Offair — radio stations as music-video channels, minus the ads.
   The idea: FM.video logs every song a station plays. We only ever play those songs,
   so when the station goes to an ad break we're simply a few minutes behind instead. */

const API = 'https://api.fm.video/api';
const BUFFER = 40;                    /* songs to fetch = roughly the last four hours */
const POLL_MS = 45000, WINDOW_MS = 4 * 3600e3, BREAK_MIN = 3.5;
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];

const S = { station: null, plays: [], cur: null, played: new Set(), family: true, vol: 80, favs: [], last: '', mode: 'watch', ready: false, armed: false, fetchedAt: 0, badVideos: new Set() };
try { Object.assign(S, JSON.parse(localStorage.getItem('offair') || '{}'), { plays: [], cur: null, played: new Set(), badVideos: new Set() }); } catch {}
const save = () => { try { localStorage.setItem('offair', JSON.stringify({ family: S.family, vol: S.vol, favs: S.favs, last: S.last })); } catch {} };
const byId = Object.fromEntries(STATIONS.map(s => [s.id, s]));
const fmtTime = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtViews = n => n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'K' : String(n);
function toast(msg, ms = 1800) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.id); toast.id = setTimeout(() => t.hidden = true, ms); }

/* ---------- station rail ---------- */
const ORDER = ['NZ', 'AU', 'GB', 'US', 'CA'];
function stationLogo(st, cls = 'st-logo') {
  const img = document.createElement('img'); img.className = cls; img.alt = ''; img.loading = 'lazy'; img.src = st.logo;
  img.onerror = () => { const d = document.createElement('div'); d.className = cls + ' fallback'; d.style.background = st.col; d.textContent = st.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase(); img.replaceWith(d); };
  return img;
}
function renderRail() {
  const q = $('#search').value.trim().toLowerCase(), list = $('#stations'); list.innerHTML = '';
  const match = st => !q || st.name.toLowerCase().includes(q) || (COUNTRIES[st.cc] && COUNTRIES[st.cc].name.toLowerCase().includes(q)) || st.genre.toLowerCase().includes(q) || st.cc.toLowerCase() === q;
  const groups = [];
  const favs = STATIONS.filter(st => S.favs.includes(st.id) && match(st)); if (favs.length) groups.push(['★ Favourites', favs]);
  const ccs = [...ORDER, ...Object.keys(COUNTRIES).filter(c => !ORDER.includes(c)).sort((a, b) => COUNTRIES[a].name.localeCompare(COUNTRIES[b].name))];
  for (const cc of ccs) { const items = STATIONS.filter(st => st.cc === cc && match(st)); if (items.length) groups.push([`${COUNTRIES[cc].flag} ${COUNTRIES[cc].name}`, items]); }
  for (const [title, items] of groups) {
    const h = document.createElement('div'); h.className = 'rail-group'; h.textContent = title; list.appendChild(h);
    for (const st of items) {
      const b = document.createElement('button'); b.className = 'st' + (S.station && S.station.id === st.id ? ' on' : ''); b.dataset.id = st.id;
      b.appendChild(stationLogo(st));
      const txt = document.createElement('div'); txt.innerHTML = '<div class="st-name"></div><div class="st-meta"></div>'; txt.querySelector('.st-name').textContent = st.name; txt.querySelector('.st-meta').textContent = [st.freq, st.genre].filter(Boolean).join(' · '); b.appendChild(txt);
      const fav = document.createElement('span'); fav.className = 'st-fav' + (S.favs.includes(st.id) ? ' on' : ''); fav.textContent = '★'; fav.title = 'Favourite';
      fav.onclick = e => { e.stopPropagation(); S.favs = S.favs.includes(st.id) ? S.favs.filter(i => i !== st.id) : [...S.favs, st.id]; save(); renderRail(); };
      b.appendChild(fav); b.onclick = () => { selectStation(st); $('#rail').classList.remove('open'); };
      list.appendChild(b);
    }
  }
}
$('#search').oninput = renderRail;
$('#btn-rail').onclick = () => $('#rail').classList.toggle('open');

/* ---------- data ---------- */
async function fetchPlays(id, n = BUFFER) {
  const r = await fetch(`${API}/PlayedSongs/${encodeURIComponent(id)}/${n}`, { cache: 'no-store' });
  if (!r.ok) throw new Error('api ' + r.status);
  const raw = await r.json(), out = [];
  for (const p of raw) {
    if (!p.youTubeVideoId) continue;
    const at = Date.parse(p.playedOn); if (!at) continue;
    out.push({ id: p.id, y: p.youTubeVideoId, t: p.title, a: p.artist, at, dur: p.durationInSeconds || 210, x: !!p.isExplicit, art: p.artworkUrl || '', views: p.viewCount || 0, vt: p.videoTitle || '' });
  }
  out.sort((a, b) => a.at - b.at);
  return out.filter((p, i) => !i || p.y !== out[i - 1].y || p.at - out[i - 1].at > 600e3);   /* the log sometimes double-writes a play */
}
const playable = p => !S.badVideos.has(p.y) && !(S.family && p.x);

/* ---------- choosing what to play (the ad-skipping) ---------- */
function pickLive() {
  const list = S.plays.filter(playable); if (!list.length) return null;
  const n = list[list.length - 1], elapsed = (Date.now() - n.at) / 1000;
  /* still inside the newest song: join it in progress. Otherwise the station is in a break (or the next
     song hasn't been logged yet) – play the newest song from the top, i.e. go back a tiny bit. */
  return { play: n, offset: elapsed < n.dur - 15 ? elapsed : 0 };
}
function pickNext() {
  const cur = S.cur; const list = S.plays.filter(playable);
  const newer = list.filter(p => cur && p.at > cur.at && !S.played.has(p.id));
  if (newer.length) return { play: newer[0], offset: 0 };                       /* catch up in order */
  const older = list.filter(p => (!cur || p.at < cur.at) && !S.played.has(p.id));
  if (older.length) return { play: older[older.length - 1], offset: 0 };        /* nothing new yet: step back one more song */
  S.played.clear(); return list.length ? { play: list[list.length - 1], offset: 0 } : null;
}
function pickPrev() {
  const list = S.plays.filter(playable), i = S.cur ? list.findIndex(p => p.id === S.cur.id) : -1;
  return i > 0 ? { play: list[i - 1], offset: 0 } : null;
}

/* ---------- YouTube ---------- */
let player = null;
function onYouTubeIframeAPIReady() {
  player = new YT.Player('yt', {
    width: '100%', height: '100%',
    playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, rel: 0, iv_load_policy: 3, modestbranding: 1, playsinline: 1, ...(/^https?:/.test(location.protocol) ? { origin: location.origin } : {}) },
    events: {
      onReady() { S.ready = true; player.setVolume(S.vol); if (S.cur) startPlay(S.cur, startPlay.offset || 0); },
      onStateChange(e) {
        if (e.data === YT.PlayerState.ENDED) next();
        if (e.data === YT.PlayerState.PLAYING) { $('#video-msg').hidden = true; $('#bigplay').hidden = true; S.armed = true; $('#btn-play').textContent = '⏸'; }
        if (e.data === YT.PlayerState.PAUSED) $('#btn-play').textContent = '⏵';
      },
      onError() { if (S.cur) { S.badVideos.add(S.cur.y); toast('That video will not play here – skipping'); setTimeout(next, 600); } },
    },
  });
}
window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;

function startPlay(play, offset = 0) {
  S.cur = play; S.played.add(play.id); startPlay.offset = offset;
  renderNow(); renderTimeline(); renderQueue();
  if (!S.ready) return;
  player.loadVideoById({ videoId: play.y, startSeconds: Math.max(0, Math.floor(offset)) });
  if (!S.armed) { $('#bigplay').hidden = false; $('#video-msg').hidden = true; }
}
function next() { const n = pickNext(); if (n) startPlay(n.play, n.offset); }
function prev() { const p = pickPrev(); if (p) startPlay(p.play, p.offset); else toast('Nothing earlier in the log'); }
async function goLive() { await refresh(true); const l = pickLive(); if (l) startPlay(l.play, l.offset); }

/* ---------- station switching & polling ---------- */
let pollTimer = 0;
async function selectStation(st) {
  if (S.station && S.station.id === st.id) return;
  S.station = st; S.last = st.id; save(); S.plays = []; S.cur = null; S.played.clear(); renderRail();
  $('#video-msg').textContent = `Tuning to ${st.name}…`; $('#video-msg').hidden = false; $('#bigplay').hidden = true;
  showIdent(st); $('#tl-station').textContent = st.name; $('#q-station').textContent = st.name; if (window.Quiz) Quiz.stationChanged();
  try { await refresh(true); } catch { $('#video-msg').textContent = 'Could not reach FM.video. Try again in a moment.'; return; }
  const l = pickLive();
  if (!l) { $('#video-msg').textContent = S.family ? 'Nothing playable logged for this station yet (family filter is on).' : 'Nothing logged for this station yet.'; return; }
  startPlay(l.play, l.offset);
  clearInterval(pollTimer); pollTimer = setInterval(() => refresh().catch(() => {}), POLL_MS);
}
async function refresh(force) {
  if (!S.station) return;
  if (!force && Date.now() - S.fetchedAt < 15000) return;
  const plays = await fetchPlays(S.station.id); S.plays = plays; S.fetchedAt = Date.now();
  renderTimeline(); renderQueue(); renderBehind();
}
function showIdent(st) {
  const el = $('#ident'); $('#ident-logo').src = st.logo; $('#ident-name').textContent = st.name;
  $('#ident-meta').textContent = [st.freq, COUNTRIES[st.cc] && COUNTRIES[st.cc].name, st.genre].filter(Boolean).join(' · ');
  el.hidden = false; clearTimeout(showIdent.t); showIdent.t = setTimeout(() => el.hidden = true, 4500);
}

/* ---------- rendering ---------- */
function renderNow() {
  const p = S.cur; if (!p) return;
  $('#np-title').textContent = p.t; $('#np-artist').textContent = p.a;
  $('#np-sub').textContent = `played ${fmtTime(p.at)} · ${fmtViews(p.views)} views` + (p.x ? ' · explicit' : '');
  const art = $('#art'); if (p.art) { art.src = p.art; art.hidden = false; } else art.hidden = true;
  $('#saver-title').textContent = p.t; $('#saver-artist').textContent = p.a;
  $('#saver-station').textContent = S.station ? `${S.station.name} · ${S.station.freq}` : '';
  document.title = `${p.a} – ${p.t} · Offair`;
}
function renderBehind() {
  const el = $('#behind'); if (!S.cur || !S.ready) { el.textContent = ''; return; }
  let pos = 0; try { pos = player.getCurrentTime() || 0; } catch {}
  const behind = Math.max(0, (Date.now() - (S.cur.at + pos * 1000)) / 60000);
  const newest = S.plays.length ? S.plays[S.plays.length - 1] : null;
  const isLive = newest && S.cur.id === newest.id && behind < 6;
  el.textContent = isLive ? '● live' : `${Math.round(behind)} min behind live`; el.classList.toggle('live', !!isLive);
  $('#btn-live').classList.toggle('on', !!isLive);
}
function renderTimeline() {
  const tl = $('#timeline'); tl.innerHTML = ''; if (!S.plays.length) return;
  const end = Date.now(), start = end - WINDOW_MS, W = tl.clientWidth || 800, px = t => (t - start) / WINDOW_MS * W;
  const col = S.station ? S.station.col : '#c8ff3d';
  for (let h = Math.ceil(start / 3600e3) * 3600e3; h < end; h += 3600e3) { const d = document.createElement('div'); d.className = 'tl-hour'; d.style.left = px(h) + 'px'; d.dataset.t = fmtTime(h); tl.appendChild(d); }
  let breaks = 0, songs = 0;
  S.plays.forEach((p, i) => {
    const s = Math.max(start, p.at), e = Math.min(end, p.at + p.dur * 1000); if (e < start) return; songs++;
    const b = document.createElement('div'); b.className = 'tl-block' + (p.x ? ' x' : '') + (S.cur && S.cur.id === p.id ? ' cur' : '');
    b.style.left = px(s) + 'px'; b.style.width = Math.max(2, px(e) - px(s)) + 'px'; b.style.background = col; b.title = `${fmtTime(p.at)} · ${p.a} – ${p.t}`;
    b.onclick = () => startPlay(p, 0); tl.appendChild(b);
    if (i > 0 && p.at - (S.plays[i - 1].at + S.plays[i - 1].dur * 1000) > BREAK_MIN * 60000 && p.at > start) breaks++;
  });
  if (S.cur) { let pos = 0; try { pos = S.ready ? player.getCurrentTime() || 0 : 0; } catch {} const you = document.createElement('div'); you.className = 'tl-you'; you.style.left = Math.min(W - 3, px(S.cur.at + pos * 1000)) + 'px'; tl.appendChild(you); }
  const live = document.createElement('div'); live.className = 'tl-live'; tl.appendChild(live);
  $('#tl-stats').textContent = `${songs} songs · ${breaks} break${breaks === 1 ? '' : 's'} skipped`;
}
function renderQueue() {
  const ol = $('#queue'); ol.innerHTML = '';
  [...S.plays].reverse().slice(0, 24).forEach(p => {
    const li = document.createElement('li'); li.className = (S.cur && S.cur.id === p.id ? 'cur' : '') + (S.played.has(p.id) ? ' played' : '');
    li.innerHTML = `<span class="q-time"></span><img alt=""><div><div class="q-t"></div><div class="q-a"></div></div>`;
    li.querySelector('.q-time').textContent = fmtTime(p.at); li.querySelector('img').src = p.art || ''; li.querySelector('.q-t').textContent = p.t; li.querySelector('.q-a').textContent = p.a + (p.x ? ' ' : '');
    if (p.x) { const x = document.createElement('span'); x.className = 'x'; x.textContent = 'EXPLICIT'; li.querySelector('.q-t').appendChild(x); }
    li.onclick = () => { if (!playable(p)) { toast(S.family && p.x ? 'Family filter is on – turn it off (🛡️) to play this one' : 'That video will not play here'); return; } startPlay(p, 0); };
    ol.appendChild(li);
  });
}
setInterval(() => { if (S.mode === 'watch') { renderBehind(); const you = $('.tl-you'); if (you && S.cur && S.ready) { const tl = $('#timeline'); let pos = 0; try { pos = player.getCurrentTime() || 0; } catch {} you.style.left = Math.min(tl.clientWidth - 3, (S.cur.at + pos * 1000 - (Date.now() - WINDOW_MS)) / WINDOW_MS * tl.clientWidth) + 'px'; } } }, 1000);
window.addEventListener('resize', renderTimeline);

/* ---------- controls ---------- */
$('#bigplay').onclick = () => { S.armed = true; $('#bigplay').hidden = true; try { player.playVideo(); } catch {} };
$('#btn-play').onclick = () => { if (!S.ready || !S.cur) return; const st = player.getPlayerState(); if (st === YT.PlayerState.PLAYING) player.pauseVideo(); else player.playVideo(); };
$('#btn-next').onclick = next; $('#btn-prev').onclick = prev; $('#btn-live').onclick = goLive;
$('#vol').value = S.vol; $('#vol').oninput = e => { S.vol = +e.target.value; save(); if (S.ready) { player.setVolume(S.vol); if (S.vol > 0) player.unMute(); } };
$('#btn-filter').classList.toggle('on', S.family);
$('#btn-filter').onclick = () => { S.family = !S.family; save(); $('#btn-filter').classList.toggle('on', S.family); toast(S.family ? 'Family filter on: explicit songs are skipped' : 'Family filter off'); renderQueue(); };
document.addEventListener('keydown', e => {
  if (document.body.classList.contains('saver')) return;
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
  if (S.mode !== 'watch') return;
  if (e.key === ' ') { e.preventDefault(); $('#btn-play').click(); }
  else if (e.key === 'ArrowRight') next(); else if (e.key === 'ArrowLeft') prev(); else if (e.key === 'l' || e.key === 'L') goLive();
  else if (e.key === 'm' || e.key === 'M') { if (S.ready) { player.isMuted() ? player.unMute() : player.mute(); toast(player.isMuted() ? 'Muted' : 'Sound on'); } }
  else if (e.key === 'f' || e.key === 'F') { const v = $('#video'); document.fullscreenElement ? document.exitFullscreen() : v.requestFullscreen && v.requestFullscreen(); }
  else if (e.key === 's' || e.key === 'S') { if (window.Saver) Saver.start(); }
});

/* ---------- modes ---------- */
function setMode(m) {
  S.mode = m; $$('#modes button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  $('#view-watch').hidden = m !== 'watch'; $('#view-quiz').hidden = m !== 'quiz'; $('#view-saver').hidden = m !== 'saver';
  if (m !== 'watch' && S.ready && S.cur) { try { player.pauseVideo(); } catch {} }
  if (m === 'watch' && S.ready && S.cur && S.armed) { try { player.playVideo(); } catch {} }
  if (m === 'quiz' && window.Quiz) Quiz.enter();
}
$$('#modes button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
$('#brand').onclick = e => { e.preventDefault(); setMode('watch'); };

/* ---------- boot ---------- */
renderRail();
window.Offair = { S, byId, fetchPlays, startPlay, setMode, toast, fmtViews, fmtTime, stationLogo, get player() { return player; } };
{ const last = S.last && byId[S.last]; if (last) selectStation(last); }
