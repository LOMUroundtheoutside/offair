/* Blind Spot — the Offair quiz. Every question is built from what the current station actually played. */
(() => {
  const { S, byId, fetchPlays, setMode, toast, beep, fmtViews, fmtTime, fmtDur, stationLogo, save } = Offair;
  const $ = s => document.querySelector(s);
  const QUESTIONS = 10, LIVES = 3, BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'], T = 'offair/scores/';
  let yt2 = null, yt2Ready = false, round = null, tickTimer = 0, others = [];

  /* ---------- fuzzy answer checking ---------- */
  const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\b(feat|ft|featuring)\b.*$/, ' ').replace(/&/g, ' and ').replace(/\$/g, 's')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(the|a|an)\b/g, ' ').replace(/\s+/g, ' ').trim();
  function bigrams(s) { const b = new Map(); for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); b.set(k, (b.get(k) || 0) + 1); } return b; }
  function dice(a, b) { if (a.length < 2 || b.length < 2) return a === b ? 1 : 0; const A = bigrams(a), B = bigrams(b); let inter = 0; for (const [k, v] of A) inter += Math.min(v, B.get(k) || 0); return 2 * inter / (a.length - 1 + b.length - 1); }
  function lev(a, b) { const m = a.length, n = b.length; if (Math.abs(m - n) > 3) return Math.abs(m - n); let prev = Array.from({ length: n + 1 }, (_, j) => j); for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; } return prev[n]; }
  function matches(guess, target) {
    const g = norm(guess), t = norm(target); if (!g || !t) return false;
    if (g === t) return true;
    if (t.length >= 8 && g.length >= 5 && t.startsWith(g) && g.length / t.length >= .7) return true;
    if (t.length >= 6 && lev(g, t) <= Math.min(3, Math.max(1, Math.floor(t.length / 6)))) return true;
    if (t.length < 6 && g.length >= t.length && lev(g, t) <= 1) return true;
    return g.length / t.length >= .8 && t.length / g.length >= .8 && dice(g, t) >= .9;
  }
  const artistMatches = (guess, artist) => [artist, ...artist.split(/\s*(?:,|&|\/|\+|\bx\b|\bvs\.?\b|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b|\bwith\b|\band\b)\s*/i).filter(p => p.trim())].some(p => matches(guess, p));

  /* ---------- helpers ---------- */
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const uniq = list => { const seen = new Set(); return list.filter(p => !(S.family && p.x) && !seen.has(p.y) && seen.add(p.y)); };
  const uniqSongs = () => uniq(S.plays);
  const bestKey = () => 'offair-best-' + (S.station ? S.station.id : 'none');
  const best = () => { try { return +localStorage.getItem(bestKey()) || 0; } catch { return 0; } };
  const sfx = { good() { beep(880, .08); setTimeout(() => beep(1320, .12), 90); }, bad() { beep(160, .25, .07); }, tick() { beep(1200, .03, .02); } };
  function ensureYt2(container) {
    const clip = document.createElement('div'); clip.className = 'clip'; clip.innerHTML = '<div class="yt-crop"><div id="yt2"></div></div><div class="cover"></div>'; container.appendChild(clip);
    if (yt2) { try { yt2.destroy(); } catch {} yt2 = null; yt2Ready = false; }
    yt2 = new YT.Player('yt2', { width: '100%', height: '100%', playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, iv_load_policy: 3, modestbranding: 1, playsinline: 1, mute: 1, cc_load_policy: 0, ...(/^https?:/.test(location.protocol) ? { origin: location.origin } : {}) }, events: { onReady() { yt2Ready = true; yt2.mute(); if (ensureYt2.pending) { yt2.loadVideoById(ensureYt2.pending); ensureYt2.pending = null; } }, onError() { if (round && round.q && round.q.onVideoError) round.q.onVideoError(); } } });
    return clip;
  }
  function playClip(y, start = 20) { const spec = { videoId: y, startSeconds: start }; if (yt2 && yt2Ready) { yt2.mute(); yt2.loadVideoById(spec); } else ensureYt2.pending = spec; }
  function stopClip() { if (yt2) { try { yt2.destroy(); } catch {} yt2 = null; yt2Ready = false; } }
  const songLabel = p => ({ text: p.t, sub: p.a, art: p.art });

  /* ---------- question builders ----------
     each returns { kind, prompt, time, render(media), and either options+answer(+optionLabel) or typed+check } */
  const builders = {
    silent(pool) {
      const p = pool[0]; let gotA = false, gotT = false;
      return { kind: '🔇 Silent video', prompt: 'The sound is off. Name the title or the artist.', time: 30, typed: true, hint: () => `Title starts with “${p.t.slice(0, Math.ceil(p.t.length / 4))}…” and the artist has ${p.a.split(' ').length} word${p.a.split(' ').length > 1 ? 's' : ''}`,
        render(media) { ensureYt2(media); playClip(p.y, 20); },
        check(g) { const tries = g.includes(' - ') ? g.split(' - ') : [g]; for (const s of tries) { if (!gotT && matches(s, p.t)) gotT = true; if (!gotA && artistMatches(s, p.a)) gotA = true; } return { ok: gotA || gotT, text: `${p.a} – ${p.t}`, bonus: gotA && gotT ? .5 : 0 }; },
        answerText: `${p.a} – ${p.t}`, onVideoError() { toast('Video would not load – free skip'); round.skipFree = true; } };
    },
    blur(pool) {
      const p = pool.find(x => x.art); if (!p) return null; const distract = shuffle(pool.filter(x => x.a !== p.a).map(x => x.a).filter((v, i, a) => a.indexOf(v) === i)).slice(0, 3); if (distract.length < 3) return null;
      return { kind: '🖼️ Out of focus', prompt: 'Whose cover art is this? It sharpens over ten seconds.', time: 14, options: shuffle([p.a, ...distract]), answer: p.a, answerText: `${p.a} – ${p.t}`,
        render(media) { const w = document.createElement('div'); w.className = 'blur-wrap'; const img = document.createElement('img'); img.src = p.art; img.alt = ''; w.appendChild(img); media.appendChild(w); requestAnimationFrame(() => requestAnimationFrame(() => img.classList.add('sharp'))); } };
    },
    who(pool) {
      const cands = others.filter(o => o.pool.length); if (cands.length < 3) return null;
      const four = shuffle([{ st: S.station, now: pool[0] }, ...shuffle(cands).slice(0, 3).map(o => ({ st: o.st, now: o.pool[0] }))]); const pick = four[Math.floor(Math.random() * four.length)];
      return { kind: '📻 Who’s playing it?', prompt: 'One of these four stations played this most recently. Which?', time: 25, options: four.map(o => o.st.id), answer: pick.st.id, answerText: `${pick.st.name} – ${pick.now.a} – ${pick.now.t}`,
        optionLabel: id => { const st = byId[id]; return { text: st.name, sub: `${COUNTRIES[st.cc].flag} ${st.freq || st.genre}`, logo: st }; },
        render(media) { ensureYt2(media); playClip(pick.now.y, 20); }, onVideoError() { round.skipFree = true; } };
    },
    views(pool) {
      const [a, b] = pool.slice(0, 2); if (!a || !b || !a.views || !b.views || Math.abs(a.views - b.views) / Math.max(a.views, b.views) < .15) return null; const hi = a.views > b.views ? a : b;
      return { kind: '📈 Higher or lower', prompt: 'Which video has more views on YouTube?', time: 15, options: [a.y, b.y], answer: hi.y, answerText: `${hi.a} – ${hi.t} (${fmtViews(hi.views)} vs ${fmtViews(hi === a ? b.views : a.views)})`,
        optionLabel: y => songLabel(y === a.y ? a : b), render() {} };
    },
    recent(pool) {
      const four = shuffle(pool.slice(0, 12)).slice(0, 4); if (four.length < 4) return null; const latest = four.reduce((m, p) => p.at > m.at ? p : m);
      return { kind: '🕒 Just played', prompt: `Which of these did ${S.station.name} play most recently?`, time: 15, options: four.map(p => p.y), answer: latest.y, answerText: `${latest.a} – ${latest.t} at ${fmtTime(latest.at)}`,
        optionLabel: y => songLabel(four.find(x => x.y === y)), render() {} };
    },
    oddone(pool) {
      const mine = new Set(pool.map(p => p.y)); const foreign = shuffle(others.flatMap(o => o.pool).filter(p => !mine.has(p.y))); if (!foreign.length || pool.length < 3) return null;
      const odd = foreign[0], three = shuffle(pool).slice(0, 3), four = shuffle([...three, odd]);
      return { kind: '🎯 Odd one out', prompt: `Three of these were on ${S.station.name} today. Which one wasn’t?`, time: 18, options: four.map(p => p.y), answer: odd.y, answerText: `${odd.a} – ${odd.t} (that was on ${(others.find(o => o.pool.includes(odd)) || {}).st?.name || 'another station'})`,
        optionLabel: y => songLabel(four.find(x => x.y === y)), render() {} };
    },
    cover(pool) {
      const withArt = shuffle(pool.filter(p => p.art)).slice(0, 4); if (withArt.length < 4) return null; const p = withArt[0];
      return { kind: '🧩 Match the cover', prompt: `Which cover is “${p.t}” by ${p.a}?`, time: 14, options: shuffle(withArt.map(x => x.y)), answer: p.y, answerText: `${p.a} – ${p.t}`, coverOnly: true,
        optionLabel: y => ({ art: withArt.find(x => x.y === y).art, text: '' }), render() {} };
    },
    station() {
      const st = S.station; const same = STATIONS.filter(s => s.cc === st.cc && s.freq && s.id !== st.id); if (!st.freq || same.length < 3) return null;
      const four = shuffle([st, ...shuffle(same).slice(0, 3)]);
      return { kind: '📡 On the dial', prompt: `Which station broadcasts on ${st.freq} in ${COUNTRIES[st.cc].name}?`, time: 12, options: four.map(s => s.id), answer: st.id, answerText: `${st.name} · ${st.freq}`,
        optionLabel: id => ({ text: byId[id].name, sub: byId[id].genre, logo: byId[id] }), render() {} };
    },
    longer(pool) {
      const [a, b] = pool.slice(0, 2); if (!a || !b || Math.abs(a.dur - b.dur) < 20) return null; const hi = a.dur > b.dur ? a : b;
      return { kind: '⏱️ Longer song', prompt: 'Which of these two songs runs longer?', time: 12, options: [a.y, b.y], answer: hi.y, answerText: `${hi.a} – ${hi.t} (${fmtDur(hi.dur)} vs ${fmtDur(hi === a ? b.dur : a.dur)})`,
        optionLabel: y => songLabel(y === a.y ? a : b), render() {} };
    },
  };

  /* ---------- round flow ---------- */
  async function start() {
    if (!S.station) { toast('Pick a station first'); return; }
    const pool = uniqSongs(); if (pool.length < 6) { toast('This station needs a few more songs in its log – try another'); return; }
    if (S.ready && Offair.player) { try { Offair.player.pauseVideo(); } catch {} }
    $('#quiz-start').hidden = true; $('#quiz-end').hidden = true; $('#quiz-play').hidden = false;
    round = { n: 0, score: 0, lives: LIVES, streak: 0, recap: [], q: null, done: false, skipFree: false, kinds: [] }; hud();
    /* three other stations, same country first: used by "who's playing it" and "odd one out" */
    const cc = S.station.cc, pick = shuffle(STATIONS.filter(s => s.id !== S.station.id && s.cc === cc)).slice(0, 3);
    while (pick.length < 3) pick.push(shuffle(STATIONS.filter(s => s.id !== S.station.id && !pick.includes(s)))[0]);
    others = await Promise.all(pick.map(async st => { try { return { st, pool: uniq(await fetchPlays(st.id, 12)) }; } catch { return { st, pool: [] }; } }));
    nextQuestion();
  }
  function nextQuestion() {
    if (!round || round.done) return;
    if (round.n >= QUESTIONS || round.lives <= 0) { finish(); return; }
    const pool = shuffle(uniqSongs()); const all = Object.keys(builders);
    /* prefer kinds we haven't used lately, so a round feels varied */
    const recent = round.kinds.slice(-3), order = [...shuffle(all.filter(k => !recent.includes(k))), ...shuffle(recent)];
    let q = null, kind = ''; for (const k of order) { q = builders[k](pool); if (q) { kind = k; break; } }
    if (!q) { finish(); return; }
    round.n++; round.q = q; round.kinds.push(kind); round.skipFree = false; round.hinted = false; round.final = round.n === QUESTIONS;
    q.time = Math.max(8, Math.round(q.time * (1 - .03 * (round.n - 1))));
    $('#q-kind').textContent = `${q.kind} · ${round.n}/${QUESTIONS}${round.final ? ' · FINAL · double points' : ''}`; $('#q-kind').classList.toggle('final', round.final);
    $('#q-prompt').textContent = q.prompt; $('#q-feedback').textContent = ''; $('#q-feedback').className = 'q-feedback';
    const media = $('#q-media'), answers = $('#q-answers'); stopClip(); media.innerHTML = ''; answers.innerHTML = ''; answers.className = 'q-answers';
    q.render(media, answers);
    if (q.typed) {
      answers.className = 'q-answers typed'; const inp = document.createElement('input'); inp.placeholder = 'Artist or title…'; inp.autocomplete = 'off'; const btn = document.createElement('button'); btn.textContent = 'Guess';
      const go = () => { const v = inp.value.trim(); if (!v || !round.q) return; const r = q.check(v); if (r.ok) resolve(true, r); else { inp.classList.remove('shake'); void inp.offsetWidth; inp.classList.add('shake'); inp.select(); sfx.tick(); } };
      btn.onclick = go; inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(); } }; answers.append(inp, btn); setTimeout(() => inp.focus(), 50);
      $('#q-hint').hidden = false;
    } else {
      $('#q-hint').hidden = true;
      q.options.forEach(o => { const b = document.createElement('button'); b.className = 'ans' + (q.coverOnly ? ' cover' : ''); const lab = q.optionLabel ? q.optionLabel(o) : { text: o };
        if (lab.logo) b.appendChild(stationLogo(lab.logo, '')); else if (lab.art) { const im = document.createElement('img'); im.src = lab.art; im.alt = ''; b.appendChild(im); }
        if (lab.text) { const t = document.createElement('span'); t.textContent = lab.text; if (lab.sub) { const s = document.createElement('span'); s.className = 'sub'; s.textContent = lab.sub; t.appendChild(s); } b.appendChild(t); }
        b.dataset.v = o; b.onclick = () => { if (!round.q) return; const ok = o === q.answer; b.classList.add(ok ? 'right' : 'wrong'); [...answers.children].forEach(x => { if (x.dataset.v === q.answer) x.classList.add('right'); x.disabled = true; }); resolve(ok, { text: q.answerText }); };
        answers.appendChild(b); });
    }
    startTimer(q.time);
  }
  function startTimer(sec) {
    clearInterval(tickTimer); const bar = $('#q-timer'), wrap = bar.parentElement; bar.style.width = '100%'; wrap.classList.remove('low');
    round.deadline = Date.now() + sec * 1000; let lastSec = sec;
    tickTimer = setInterval(() => { const left = Math.max(0, round.deadline - Date.now()), f = left / (sec * 1000); bar.style.width = f * 100 + '%'; wrap.classList.toggle('low', f < .25); const s = Math.ceil(left / 1000); if (s !== lastSec && s <= 3 && s > 0) sfx.tick(); lastSec = s; if (left <= 0) { clearInterval(tickTimer); resolve(false, { text: round.q.answerText, timeout: true }); } }, 250);
  }
  function resolve(ok, r) {
    if (!round || !round.q) return; clearInterval(tickTimer); const q = round.q; round.q = null; stopClip();
    const fb = $('#q-feedback');
    if (ok) {
      const frac = Math.max(0, (round.deadline - Date.now()) / (q.time * 1000)), mult = 1 + Math.min(2, round.streak * .25), base = Math.round(100 * (.4 + .6 * frac));
      let pts = Math.round(base * mult * (1 + (r.bonus || 0))) - (round.hinted ? 15 : 0); if (round.final) pts *= 2; pts = Math.max(0, pts);
      round.score += pts; round.streak++; fb.className = 'q-feedback good'; fb.textContent = `✓ ${r.text}  +${pts}${round.streak >= 2 ? ` · streak ×${mult.toFixed(2)}` : ''}${r.bonus ? ' · both! +50%' : ''}${round.final ? ' · doubled' : ''}`;
      round.recap.push({ ok: true, text: `${q.kind.slice(3)}: ${r.text}` }); sfx.good();
    } else {
      round.lives--; round.streak = 0; fb.className = 'q-feedback bad'; fb.textContent = `${r.timeout ? '⏱ Out of time.' : '✗ Not that.'} It was ${r.text}`;
      round.recap.push({ ok: false, text: `${q.kind.slice(3)}: ${r.text}` }); sfx.bad();
    }
    hud(); setTimeout(nextQuestion, 2200);
  }
  function hud() { $('#q-lives').textContent = '♥'.repeat(round.lives) + '♡'.repeat(Math.max(0, LIVES - round.lives)); $('#q-streak').textContent = round.streak >= 2 ? `🔥 ${round.streak} streak · ×${(1 + Math.min(2, round.streak * .25)).toFixed(2)}` : ''; $('#q-score').textContent = round.score; }
  function finish() {
    round.done = true; clearInterval(tickTimer); stopClip(); $('#quiz-play').hidden = true; $('#quiz-end').hidden = false;
    const good = round.recap.filter(r => r.ok).length; $('#q-final').textContent = round.score;
    const b = best(); const isBest = round.score > b; if (isBest) { try { localStorage.setItem(bestKey(), round.score); } catch {} }
    $('#q-summary').textContent = `${good} of ${round.recap.length} right on ${S.station.name}.${isBest ? ' New best for this station!' : b ? ` Best here is ${b}.` : ''}`;
    const ol = $('#q-recap'); ol.innerHTML = ''; round.recap.forEach(r => { const li = document.createElement('li'); li.className = r.ok ? 'good' : 'bad'; li.textContent = r.text; ol.appendChild(li); });
    $('#q-best').textContent = best(); $('#q-rank').textContent = ''; $('#q-name').value = S.name || ''; $('#q-post').disabled = false; $('#q-post').textContent = 'Post score';
    if (S.name) postScore();
  }
  $('#quiz-go').onclick = start; $('#quiz-again').onclick = start; $('#quiz-back').onclick = () => setMode('watch');
  $('#q-skip').onclick = () => { if (round && round.q) { if (round.skipFree) { round.q = null; clearInterval(tickTimer); stopClip(); round.n--; nextQuestion(); } else resolve(false, { text: round.q.answerText }); } };
  $('#q-hint').onclick = () => { if (round && round.q && round.q.hint && !round.hinted) { round.hinted = true; toast(round.q.hint(), 5000); $('#q-hint').hidden = true; } };
  $('#q-share').onclick = async () => {
    const grid = round.recap.map(r => r.ok ? '🟩' : '🟥').join(''), txt = `Offair · Blind Spot on ${S.station.name}\n${round.score} pts · ${round.recap.filter(r => r.ok).length}/${round.recap.length}\n${grid}\n${location.href.split(/[?#]/)[0]}`;
    try { await navigator.clipboard.writeText(txt); toast('Result copied – paste it anywhere'); } catch { prompt('Copy your result:', txt); }
  };
  $('#q-post').onclick = () => { const n = $('#q-name').value.trim().slice(0, 16); if (!n) { toast('Type a name first'); $('#q-name').focus(); return; } S.name = n; save(); postScore(); };

  /* ---------- scoreboard over the relay: one retained doc per player per station ---------- */
  const scores = {}; let client = null, brokerIdx = 0, subscribed = '';
  const pid = (() => { try { let v = localStorage.getItem('offair-pid'); if (!v) { v = Math.random().toString(36).slice(2, 10); localStorage.setItem('offair-pid', v); } return v; } catch { return 'anon'; } })();
  function connect() {
    if (client || typeof mqtt === 'undefined') { if (!client) $('#q-board-status').textContent = 'scoreboard offline'; return; }
    const c = mqtt.connect(BROKERS[brokerIdx % BROKERS.length], { clientId: 'offair-' + pid + '-' + Date.now().toString(36), keepalive: 30, reconnectPeriod: 0, connectTimeout: 8000, clean: true }); client = c;
    c.on('connect', () => { subscribed = ''; subscribeStation(); });
    c.on('message', (topic, buf) => { const [, , st, who] = topic.split('/'); if (!st || !who) return; const txt = buf.toString(); if (!txt) { delete (scores[st] || {})[who]; } else { try { const d = JSON.parse(txt); if (d && d.name && Number.isFinite(d.score)) (scores[st] = scores[st] || {})[who] = { name: String(d.name).slice(0, 16), score: Math.min(99999, d.score | 0), t: d.t || 0 }; } catch {} } if (S.station && st === S.station.id) renderBoard(); });
    const lost = () => { if (client !== c) return; client = null; brokerIdx++; $('#q-board-status').textContent = 'scoreboard offline'; setTimeout(() => { if (S.mode === 'quiz') connect(); }, brokerIdx < BROKERS.length ? 300 : 8000); };
    c.on('close', lost); c.on('offline', lost); c.on('error', () => {});
  }
  function subscribeStation() {
    if (!client || !client.connected || !S.station) return;
    if (subscribed && subscribed !== S.station.id) client.unsubscribe(T + subscribed + '/+');
    if (subscribed !== S.station.id) { subscribed = S.station.id; client.subscribe(T + S.station.id + '/+', { qos: 0 }); }
    $('#q-board-status').textContent = 'live'; renderBoard();
  }
  function postScore() {
    if (!round || !S.station) return; const prev = (scores[S.station.id] || {})[pid];
    if (prev && prev.score >= round.score) { $('#q-rank').textContent = `Your best posted score here is ${prev.score}. Beat it to move up.`; renderBoard(); return; }
    if (!client || !client.connected) { $('#q-rank').textContent = 'Scoreboard is offline right now – your best is still saved on this device.'; return; }
    client.publish(T + S.station.id + '/' + pid, JSON.stringify({ name: S.name, score: round.score, t: Date.now() }), { qos: 0, retain: true });
    (scores[S.station.id] = scores[S.station.id] || {})[pid] = { name: S.name, score: round.score, t: Date.now() };
    $('#q-post').disabled = true; $('#q-post').textContent = 'Posted'; renderBoard(); toast('Score posted');
    const list = boardList(); const i = list.findIndex(x => x.id === pid); if (i >= 0) $('#q-rank').textContent = i === 0 ? '🏆 You are top of the board on this station!' : `You are #${i + 1} on ${S.station.name}.`;
  }
  function boardList() { const m = scores[S.station ? S.station.id : ''] || {}; return Object.entries(m).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.score - a.score || a.t - b.t).slice(0, 10); }
  function renderBoard() {
    const ol = $('#q-board'); ol.innerHTML = ''; $('#q-board-station').textContent = S.station ? S.station.name : '…';
    const list = boardList();
    if (!list.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'No scores posted here yet. Be the first.'; ol.appendChild(li); return; }
    list.forEach((x, i) => { const li = document.createElement('li'); if (x.id === pid) li.className = 'me'; li.innerHTML = `<span>${i + 1}</span><span></span><b></b>`; li.children[1].textContent = x.name + (x.id === pid ? ' (you)' : ''); li.children[2].textContent = x.score; ol.appendChild(li); });
  }

  window.Quiz = {
    enter() { $('#q-best').textContent = best(); if (!S.station) $('#q-station').textContent = 'a station'; renderBoard(); connect(); subscribeStation(); },
    stationChanged() { if (round && !round.done) { round.done = true; clearInterval(tickTimer); stopClip(); $('#quiz-play').hidden = true; $('#quiz-start').hidden = false; } $('#q-best').textContent = best(); renderBoard(); if (S.mode === 'quiz') subscribeStation(); },
  };
})();
