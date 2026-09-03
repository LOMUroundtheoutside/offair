/* Blind Spot — the Offair quiz. Every question is built from what the current station actually played. */
(() => {
  const { S, byId, fetchPlays, setMode, toast, fmtViews, fmtTime, stationLogo } = Offair;
  const $ = s => document.querySelector(s);
  const QUESTIONS = 10, LIVES = 3;
  let yt2 = null, yt2Ready = false, round = null, timer = 0, tickTimer = 0, others = [];

  /* ---------- fuzzy answer checking (shared idea with typed answers everywhere) ---------- */
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
  const uniqSongs = () => { const seen = new Set(); return S.plays.filter(p => !(S.family && p.x) && !seen.has(p.y) && seen.add(p.y)); };
  const bestKey = () => 'offair-best-' + (S.station ? S.station.id : 'none');
  const best = () => { try { return +localStorage.getItem(bestKey()) || 0; } catch { return 0; } };
  function ensureYt2(container) {
    const clip = document.createElement('div'); clip.className = 'clip'; clip.innerHTML = '<div class="yt-crop"><div id="yt2"></div></div><div class="cover"></div>'; container.appendChild(clip);
    if (yt2) { try { yt2.destroy(); } catch {} yt2 = null; yt2Ready = false; }
    yt2 = new YT.Player('yt2', { width: '100%', height: '100%', playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, iv_load_policy: 3, modestbranding: 1, playsinline: 1, mute: 1, ...(/^https?:/.test(location.protocol) ? { origin: location.origin } : {}) }, events: { onReady() { yt2Ready = true; yt2.mute(); if (ensureYt2.pending) { yt2.loadVideoById(ensureYt2.pending); ensureYt2.pending = null; } }, onError() { if (round && round.q && round.q.onVideoError) round.q.onVideoError(); } } });
    return clip;
  }
  function playClip(y, start = 20) { const spec = { videoId: y, startSeconds: start }; if (yt2 && yt2Ready) { yt2.mute(); yt2.loadVideoById(spec); } else ensureYt2.pending = spec; }
  function stopClip() { if (yt2) { try { yt2.destroy(); } catch {} yt2 = null; yt2Ready = false; } }

  /* ---------- question builders: each returns { kind, prompt, render(media, answers), check(answer) → {ok, text}, time } ---------- */
  const builders = {
    silent(pool) {
      const p = pool[0]; let gotA = false, gotT = false;
      return { kind: '🔇 Silent video', prompt: 'The sound is off. Name the title or the artist.', time: 30, typed: true, hint: () => `Title starts with “${p.t.slice(0, Math.ceil(p.t.length / 4))}…”`,
        render(media) { ensureYt2(media); playClip(p.y, 20); },
        check(g) { const tries = g.includes(' - ') ? g.split(' - ') : [g]; for (const s of tries) { if (!gotT && matches(s, p.t)) gotT = true; if (!gotA && artistMatches(s, p.a)) gotA = true; } if (gotA || gotT) return { ok: true, text: `${p.a} – ${p.t}`, bonus: gotA && gotT ? .5 : 0 }; return { ok: false, text: `${p.a} – ${p.t}` }; },
        answerText: `${p.a} – ${p.t}`, onVideoError() { toast('Video would not load – free skip'); round.skipFree = true; } };
    },
    blur(pool) {
      const p = pool.find(x => x.art) || pool[0]; const distract = shuffle(pool.filter(x => x.a !== p.a).map(x => x.a).filter((v, i, a) => a.indexOf(v) === i)).slice(0, 3);
      const opts = shuffle([p.a, ...distract]);
      return { kind: '🖼️ Out of focus', prompt: 'Whose cover art is this? It sharpens over ten seconds.', time: 14, options: opts, answer: p.a, answerText: `${p.a} – ${p.t}`,
        render(media) { const w = document.createElement('div'); w.className = 'blur-wrap'; const img = document.createElement('img'); img.src = p.art; img.alt = ''; w.appendChild(img); media.appendChild(w); requestAnimationFrame(() => requestAnimationFrame(() => img.classList.add('sharp'))); } };
    },
    who(pool) {
      const cands = others.filter(o => o.now); if (cands.length < 3) return null;
      const mine = { st: S.station, now: pool[0] }; const four = shuffle([mine, ...shuffle(cands).slice(0, 3)]); const pick = four[Math.floor(Math.random() * four.length)];
      return { kind: '📻 Who’s playing it?', prompt: `One of these four stations played this most recently. Which?`, time: 25, options: four.map(o => o.st.id), answer: pick.st.id, answerText: `${pick.st.name} – ${pick.now.a} – ${pick.now.t}`,
        optionLabel: id => { const st = byId[id]; return { text: st.name, sub: `${COUNTRIES[st.cc].flag} ${st.freq || st.genre}`, logo: st }; },
        render(media) { ensureYt2(media); playClip(pick.now.y, 20); }, onVideoError() { round.skipFree = true; } };
    },
    views(pool) {
      const [a, b] = pool.slice(0, 2); if (!a || !b || a.views === b.views) return null; const hi = a.views > b.views ? a : b;
      return { kind: '📈 Higher or lower', prompt: 'Which video has more views on YouTube?', time: 15, options: [a.y, b.y], answer: hi.y, answerText: `${hi.a} – ${hi.t} (${fmtViews(hi.views)} vs ${fmtViews(hi === a ? b.views : a.views)})`,
        optionLabel: y => { const p = y === a.y ? a : b; return { text: p.t, sub: p.a, art: p.art }; },
        render(media) { const vs = document.createElement('div'); vs.className = 'vs'; vs.innerHTML = '<div></div><div class="or">VS</div><div></div>'; media.appendChild(vs); } };
    },
    recent(pool) {
      const four = shuffle(pool.slice(0, 12)).slice(0, 4); if (four.length < 4) return null; const latest = four.reduce((m, p) => p.at > m.at ? p : m);
      return { kind: '🕒 Just played', prompt: `Which of these did ${S.station.name} play most recently?`, time: 15, options: four.map(p => p.y), answer: latest.y, answerText: `${latest.a} – ${latest.t} at ${fmtTime(latest.at)}`,
        optionLabel: y => { const p = four.find(x => x.y === y); return { text: p.t, sub: p.a, art: p.art }; }, render() {} };
    },
  };

  /* ---------- round flow ---------- */
  async function start() {
    if (!S.station) { toast('Pick a station first'); return; }
    const pool = uniqSongs(); if (pool.length < 6) { toast('This station needs a few more songs in its log – try another'); return; }
    if (S.ready && Offair.player) { try { Offair.player.pauseVideo(); } catch {} }
    $('#quiz-start').hidden = true; $('#quiz-end').hidden = true; $('#quiz-play').hidden = false;
    round = { n: 0, score: 0, lives: LIVES, streak: 0, recap: [], q: null, done: false, skipFree: false }; hud();
    /* three other stations for "who's playing it", same country first */
    const cc = S.station.cc, pick = shuffle(STATIONS.filter(s => s.id !== S.station.id && s.cc === cc)).slice(0, 3);
    while (pick.length < 3) pick.push(shuffle(STATIONS.filter(s => s.id !== S.station.id && !pick.includes(s)))[0]);
    others = await Promise.all(pick.map(async st => { try { const l = await fetchPlays(st.id, 1); return { st, now: l.filter(p => !(S.family && p.x))[0] }; } catch { return { st, now: null }; } }));
    nextQuestion();
  }
  function nextQuestion() {
    if (!round || round.done) return;
    if (round.n >= QUESTIONS || round.lives <= 0) { finish(); return; }
    const pool = shuffle(uniqSongs()); const kinds = ['silent', 'blur', 'who', 'views', 'recent'];
    let q = null; for (const k of shuffle(kinds)) { q = builders[k](pool); if (q) break; }
    if (!q) { finish(); return; }
    round.n++; round.q = q; round.skipFree = false; round.t0 = Date.now(); round.hinted = false;
    $('#q-kind').textContent = `${q.kind} · ${round.n}/${QUESTIONS}`; $('#q-prompt').textContent = q.prompt; $('#q-feedback').textContent = ''; $('#q-feedback').className = 'q-feedback';
    const media = $('#q-media'), answers = $('#q-answers'); stopClip(); media.innerHTML = ''; answers.innerHTML = ''; answers.className = 'q-answers';
    q.render(media, answers);
    if (q.typed) {
      answers.className = 'q-answers typed'; const inp = document.createElement('input'); inp.placeholder = 'Artist or title…'; inp.autocomplete = 'off'; const btn = document.createElement('button'); btn.textContent = 'Guess';
      const go = () => { const v = inp.value.trim(); if (!v) return; const r = q.check(v); if (r.ok) resolve(true, r); else { inp.classList.remove('shake'); void inp.offsetWidth; inp.classList.add('shake'); inp.select(); } };
      btn.onclick = go; inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(); } }; answers.append(inp, btn); setTimeout(() => inp.focus(), 50);
      $('#q-hint').hidden = false;
    } else {
      $('#q-hint').hidden = true;
      q.options.forEach(o => { const b = document.createElement('button'); b.className = 'ans'; const lab = q.optionLabel ? q.optionLabel(o) : { text: o };
        if (lab.logo) b.appendChild(stationLogo(lab.logo, '')); else if (lab.art) { const im = document.createElement('img'); im.src = lab.art; im.alt = ''; b.appendChild(im); }
        const t = document.createElement('span'); t.textContent = lab.text; if (lab.sub) { const s = document.createElement('span'); s.className = 'sub'; s.textContent = lab.sub; t.appendChild(s); } b.appendChild(t);
        b.dataset.v = o; b.onclick = () => { if (!round.q) return; const ok = o === q.answer; b.classList.add(ok ? 'right' : 'wrong'); [...answers.children].forEach(x => { if (x.dataset.v === q.answer) x.classList.add('right'); x.disabled = true; }); resolve(ok, { text: q.answerText }); };
        answers.appendChild(b); });
    }
    startTimer(q.time);
  }
  function startTimer(sec) {
    clearInterval(tickTimer); const bar = $('#q-timer'), wrap = bar.parentElement; bar.style.width = '100%'; wrap.classList.remove('low');
    round.deadline = Date.now() + sec * 1000;
    tickTimer = setInterval(() => { const left = Math.max(0, round.deadline - Date.now()), f = left / (sec * 1000); bar.style.width = f * 100 + '%'; wrap.classList.toggle('low', f < .25); if (left <= 0) { clearInterval(tickTimer); resolve(false, { text: round.q.answerText, timeout: true }); } }, 250);
  }
  function resolve(ok, r) {
    if (!round || !round.q) return; clearInterval(tickTimer); const q = round.q; round.q = null; stopClip();
    const fb = $('#q-feedback');
    if (ok) {
      const frac = Math.max(0, (round.deadline - Date.now()) / (q.time * 1000)), mult = 1 + Math.min(2, round.streak * .25), base = Math.round(100 * (.4 + .6 * frac)), pts = Math.round(base * mult * (1 + (r.bonus || 0))) - (round.hinted ? 15 : 0);
      round.score += Math.max(0, pts); round.streak++; fb.className = 'q-feedback good'; fb.textContent = `✓ ${r.text}  +${Math.max(0, pts)}${round.streak >= 2 ? ` · streak ×${mult.toFixed(2)}` : ''}${r.bonus ? ' · both! +50%' : ''}`;
      round.recap.push({ ok: true, text: `${q.kind.slice(3)}: ${r.text}` });
    } else {
      round.lives--; round.streak = 0; fb.className = 'q-feedback bad'; fb.textContent = `${r.timeout ? '⏱ Out of time.' : '✗ Not that.'} It was ${r.text}`;
      round.recap.push({ ok: false, text: `${q.kind.slice(3)}: ${r.text}` });
    }
    hud(); setTimeout(nextQuestion, 2200);
  }
  function hud() { $('#q-lives').textContent = '♥'.repeat(round.lives) + '♡'.repeat(Math.max(0, LIVES - round.lives)); $('#q-streak').textContent = round.streak >= 2 ? `🔥 ${round.streak} streak` : ''; $('#q-score').textContent = round.score; }
  function finish() {
    round.done = true; clearInterval(tickTimer); stopClip(); $('#quiz-play').hidden = true; $('#quiz-end').hidden = false;
    const good = round.recap.filter(r => r.ok).length; $('#q-final').textContent = round.score;
    const b = best(); const isBest = round.score > b; if (isBest) { try { localStorage.setItem(bestKey(), round.score); } catch {} }
    $('#q-summary').textContent = `${good} of ${round.recap.length} right on ${S.station.name}.${isBest ? ' New best for this station!' : b ? ` Best here is ${b}.` : ''}`;
    const ol = $('#q-recap'); ol.innerHTML = ''; round.recap.forEach(r => { const li = document.createElement('li'); li.className = r.ok ? 'good' : 'bad'; li.textContent = r.text; ol.appendChild(li); });
    $('#q-best').textContent = best();
  }
  $('#quiz-go').onclick = start; $('#quiz-again').onclick = start; $('#quiz-back').onclick = () => setMode('watch');
  $('#q-skip').onclick = () => { if (round && round.q) { if (round.skipFree) { const q = round.q; round.q = null; clearInterval(tickTimer); stopClip(); round.n--; nextQuestion(); } else resolve(false, { text: round.q.answerText }); } };
  $('#q-hint').onclick = () => { if (round && round.q && round.q.hint && !round.hinted) { round.hinted = true; toast(round.q.hint(), 4000); $('#q-hint').hidden = true; } };

  window.Quiz = {
    enter() { $('#q-best').textContent = best(); if (!S.station) $('#q-station').textContent = 'a station'; },
    stationChanged() { if (round && !round.done) { round.done = true; clearInterval(tickTimer); stopClip(); $('#quiz-play').hidden = true; $('#quiz-start').hidden = false; } $('#q-best').textContent = best(); },
  };
})();
