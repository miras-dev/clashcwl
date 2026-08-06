/* CWL Helper — group analysis, promotion odds, and war-day roster assignment.
   State lives in localStorage under cc_cwl_group so a season survives reloads. */

const $g = (id) => document.getElementById(id);

const STORE = "cc_cwl_group";
let state = loadState();
let proxyLive = false;

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || "null");
    if (s && Array.isArray(s.clans)) return s;
  } catch {}
  return { league: "Master League I", warSize: 15, myTag: "", clans: [], roster: [], assignments: {} };
}
function saveState() {
  try { localStorage.setItem(STORE, JSON.stringify(state)); }
  catch (e) { console.warn("CWL state save failed", e); }
}
function escG(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function normTag(t) {
  return "#" + String(t || "").trim().toUpperCase().replace(/^#/, "").replace(/[^0-9A-Z]/g, "");
}

/* ---------------- data source ---------------- */
// The proxy is a separate origin in production (API Gateway → Lambda), so these
// calls are absolute. On localhost `node server.js` serves both the pages and
// /api, so same-origin relative paths are used there instead.
const API_BASE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
  ? ""
  : "https://api.clashcwl.com";

async function checkProxy() {
  const el = $g("proxyStatus");
  try {
    const r = await fetch(`${API_BASE}/api/status`);
    const j = await r.json();
    proxyLive = !!j.hasKey;
  } catch { proxyLive = false; }
  el.innerHTML = proxyLive
    ? `<span class="status-dot dot-on"></span>Live CoC API connected`
    : `<span class="status-dot dot-off"></span>Manual mode — live data unavailable right now`;
  el.style.borderColor = proxyLive ? "var(--green)" : "var(--border)";
  el.style.color = proxyLive ? "var(--green)" : "var(--muted)";
}

async function apiGet(endpoint, tag) {
  const r = await fetch(`${API_BASE}/api/${endpoint}?tag=${encodeURIComponent(tag.replace(/^#/, ""))}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || j.reason || `HTTP ${r.status}`);
  return j;
}

/* ---------------- strength model ----------------
   Win streak is a weak signal on its own: a strong clan can break its streak on
   one bad war, and a weak clan can farm one off easy matchups. So streak is
   capped at 4 of 100 points. What actually predicts CWL performance is roster
   quality — Town Hall levels, hero levels, and accumulated war stars — plus the
   clan's War League, which is the game's own ranking of how a clan performs in CWL.
   Deep-loaded clans (with player data) score on far better evidence than
   shallow ones, so we use it whenever it's available.                          */

// Player rating: TH is the backbone, hero levels separate players within a TH,
// and war stars reward proven war performance.
function playerScore(p) {
  const th = (p.thLevel || 0) * 10;
  const heroes = (p.heroSum || 0) / 20;
  const stars = Math.min(p.warStars || 0, 1500) / 150;
  return Math.round(th + heroes + stars);
}

// CoC War League ladder → 0-1 rating. This is the single best "how good is this
// clan at CWL" signal the API gives us, because it's earned over many seasons.
// Names and order match GET /warleagues exactly — a string that misses this
// table scores as unknown, which used to hand Titan and Legend clans the
// neutral fallback and rate them below Master I.
const WAR_LEAGUE_RANK = {
  "legend league": 1.00,
  "titan league i": 0.96, "titan league ii": 0.92, "titan league iii": 0.88,
  "champion league i": 0.84, "champion league ii": 0.80, "champion league iii": 0.76,
  "master league i": 0.72, "master league ii": 0.68, "master league iii": 0.64,
  "crystal league i": 0.60, "crystal league ii": 0.56, "crystal league iii": 0.52,
  "gold league i": 0.44, "gold league ii": 0.38, "gold league iii": 0.32,
  "silver league i": 0.26, "silver league ii": 0.20, "silver league iii": 0.14,
  "bronze league i": 0.10, "bronze league ii": 0.06, "bronze league iii": 0.02,
  "unranked": 0.30,
};
function warLeagueScore(name) {
  if (!name) return null;
  const v = WAR_LEAGUE_RANK[String(name).toLowerCase().trim()];
  return v == null ? null : v;
}

/* Roster power from deep player data: the top N players who are actually
   available for war (warPreference "in"), weighted by TH, heroes and war stars. */
function rosterPower(c, warSize = 15) {
  if (!Array.isArray(c.players) || !c.players.length) return null;
  const pool = c.players.slice().sort((a, b) => playerScore(b) - playerScore(a)).slice(0, warSize);
  const avgTH = pool.reduce((a, p) => a + (p.thLevel || 0), 0) / pool.length;
  const avgHero = pool.reduce((a, p) => a + (p.heroSum || 0), 0) / pool.length;
  const avgStars = pool.reduce((a, p) => a + (p.warStars || 0), 0) / pool.length;

  const thPart = Math.max(0, avgTH - 9) / 9;                 // 0-1 (TH9 → TH18)
  const heroPart = Math.min(avgHero, 380) / 380;             // 0-1
  const starPart = Math.min(avgStars, 1200) / 1200;          // 0-1 war experience
  return thPart * 0.55 + heroPart * 0.25 + starPart * 0.20;  // 0-1
}

function clanStrength(c, warSize = 15) {
  const lvl = Number(c.level) || 0;
  const wins = Number(c.warWins) || 0;
  const losses = Number(c.warLosses) || 0;
  const streak = Number(c.winStreak) || 0;

  const power = rosterPower(c, warSize);                     // 0-1 or null
  const wl = warLeagueScore(c.warLeague);                    // 0-1 or null

  // Roster quality — deep data if we have it, otherwise fall back to avg TH.
  let rosterPart;
  if (power != null) rosterPart = power * 50;                // up to 50
  else {
    const th = Number(c.avgTH) || 0;
    rosterPart = Math.max(0, th - 9) / 9 * 50;
  }

  // War League — the game's own CWL ranking. Heavy weight when known.
  const leaguePart = wl != null ? wl * 26 : 13;              // up to 26 (neutral if unknown)

  const lvlPart = Math.min(lvl, 25) / 25 * 8;                // up to 8
  const total = wins + losses;
  const wr = total >= 10 ? wins / total : 0.5;
  const wrPart = wr * 8;                                     // up to 8
  const expPart = Math.min(wins, 400) / 400 * 4;             // up to 4
  const streakPart = Math.min(streak, 8) / 8 * 4;            // up to 4 — deliberately small

  return Math.round(Math.min(100, rosterPart + leaguePart + lvlPart + wrPart + expPart + streakPart));
}

/* Explains where a clan's score came from, so the ranking is never a black box. */
function strengthBreakdown(c, warSize = 15) {
  const power = rosterPower(c, warSize);
  const wl = warLeagueScore(c.warLeague);
  const total = (Number(c.warWins) || 0) + (Number(c.warLosses) || 0);
  return [
    { label: "Roster quality", pts: power != null ? power * 50 : Math.max(0, (Number(c.avgTH) || 0) - 9) / 9 * 50, max: 50,
      detail: power != null ? `top ${warSize} by TH, heroes & war stars` : `avg TH ${c.avgTH ?? "?"} (add deep data for accuracy)` },
    { label: "War League", pts: wl != null ? wl * 26 : 13, max: 26,
      detail: c.warLeague || "unknown — scored neutral" },
    { label: "Clan level", pts: Math.min(Number(c.level) || 0, 25) / 25 * 8, max: 8, detail: `level ${c.level ?? "?"}` },
    { label: "Win rate", pts: (total >= 10 ? (c.warWins / total) : 0.5) * 8, max: 8,
      detail: total >= 10 ? `${c.warWins}W / ${c.warLosses}L` : "too few wars — scored neutral" },
    { label: "War experience", pts: Math.min(Number(c.warWins) || 0, 400) / 400 * 4, max: 4, detail: `${c.warWins ?? 0} total wins` },
    { label: "Current streak", pts: Math.min(Number(c.winStreak) || 0, 8) / 8 * 4, max: 4,
      detail: c.winStreak ? `${c.winStreak} in a row — minor factor by design` : "no active streak" },
  ];
}

function strengthColor(s) {
  if (s >= 70) return "var(--red)";
  if (s >= 50) return "var(--gold)";
  return "var(--green)";
}


/* ---------------- busy / loading feedback ----------------
   Deep clan fetches take ~20s (every member's profile). Without a visible
   busy state users assume the page froze and click again, firing duplicates. */
function setBusy(btn, on, label) {
  if (!btn) return;
  if (on) {
    btn.dataset.orig = btn.dataset.orig || btn.innerHTML;
    btn.innerHTML = `<span class="spinner"></span>${label || "Working…"}`;
    btn.disabled = true;
    document.querySelectorAll("#addClanBtn,#loadMyClanBtn,#autoGroupBtn,#refreshRosterBtn")
      .forEach(b => { if (b !== btn) b.disabled = true; });
  } else {
    if (btn.dataset.orig) btn.innerHTML = btn.dataset.orig;
    document.querySelectorAll("#addClanBtn,#loadMyClanBtn,#autoGroupBtn,#refreshRosterBtn")
      .forEach(b => { b.disabled = false; });
  }
}
function msg(text, kind) {
  const el = $g("groupMsg");
  el.innerHTML = kind === "busy" ? `<span class="spinner dark"></span>${text}` : text;
  el.style.color = kind === "error" ? "var(--red)" : kind === "ok" ? "var(--green)" : "var(--muted)";
}

/* ---------------- clan fetching ---------------- */
async function fetchClan(tag) {
  // clan-deep returns the clan plus every member's war stars, league and war
  // preference in one batched call — the data the ranking actually depends on.
  const d = await apiGet("clan-deep", tag);
  if (!d || !d.tag) throw new Error("Clan not found");
  const ths = (d.players || []).map(p => p.thLevel).filter(Boolean);
  return {
    ...d,
    avgTH: ths.length ? +(ths.reduce((a, b) => a + b, 0) / ths.length).toFixed(1) : null,
    live: true,
  };
}

/* ---------------- clan list rendering ---------------- */
function renderClans() {
  const list = $g("clanList");
  const ws = Number(state.warSize) || 15;
  const clans = state.clans.slice().sort((a, b) => clanStrength(b, ws) - clanStrength(a, ws));
  $g("emptyGroup").style.display = clans.length ? "none" : "block";

  list.innerHTML = clans.map((c, i) => {
    const s = clanStrength(c, ws);
    const isUs = normTag(c.tag) === normTag(state.myTag);
    const cls = i < 2 ? "promote" : (i >= 6 ? "demote" : "");
    const deep = Array.isArray(c.players) && c.players.length;
    const open = state.expanded === c.tag;
    return `
      <div class="clan-row ${isUs ? "us" : ""} ${cls}" data-expand="${escG(c.tag)}" style="cursor:pointer">
        <div class="seed">${i + 1}</div>
        <div>
          <span class="caret" style="display:inline-block;width:12px;color:var(--muted);transform:rotate(${open ? 90 : 0}deg);transition:.15s">▸</span>
          ${c.badge ? `<img src="${escG(c.badge)}" alt="" style="width:22px;height:22px;vertical-align:middle;margin-right:4px" />` : ""}
          <strong>${escG(c.name)}</strong>
          ${isUs ? `<span class="pill" style="color:var(--primary);border-color:var(--primary);margin-left:6px">YOU</span>` : ""}
          ${!c.live ? `<span class="pill" style="margin-left:6px">manual</span>` : ""}
          ${c.warLeague ? `<span class="pill" style="margin-left:6px;color:var(--gold);border-color:var(--gold)">${escG(c.warLeague)}</span>` : ""}
          ${deep ? "" : c.live ? `<span class="pill" style="margin-left:6px">shallow</span>` : ""}
          <div class="muted small" style="margin-left:16px">${escG(c.tag)}${c.avgTH ? ` · avg TH ${c.avgTH}` : ""}${c.memberCount ? ` · ${c.memberCount} members` : ""}</div>
        </div>
        <div class="num"><span class="lbl">Lvl</span>${c.level ?? "—"}</div>
        <div class="num"><span class="lbl">Wins</span>${c.warWins ?? "—"}</div>
        <div class="num"><span class="lbl">Streak</span>${c.winStreak ? "🔥" + c.winStreak : "—"}</div>
        <div>
          <div class="num" style="color:${strengthColor(s)}">${s}</div>
          <div class="strength-bar"><div style="width:${s}%; background:${strengthColor(s)}"></div></div>
        </div>
        <div><button class="danger" style="padding:5px 9px; font-size:.75rem" data-remove="${escG(c.tag)}">✕</button></div>
      </div>
      ${open ? renderClanDetail(c, ws) : ""}`;
  }).join("");

  list.querySelectorAll("[data-remove]").forEach(b => b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    state.clans = state.clans.filter(c => c.tag !== b.dataset.remove);
    if (state.expanded === b.dataset.remove) state.expanded = null;
    saveState(); renderAll();
  }));
  list.querySelectorAll("[data-expand]").forEach(row => row.addEventListener("click", () => {
    const tag = row.dataset.expand;
    state.expanded = state.expanded === tag ? null : tag;
    saveState(); renderClans();
  }));
  list.querySelectorAll("[data-deepload]").forEach(b => b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    deepLoadClan(b.dataset.deepload);
  }));

  $g("groupMsg").textContent = `${state.clans.length} / 8 clans`;
}

/* Expanded panel: score breakdown + full player list with war stars / league. */
function renderClanDetail(c, ws) {
  const deep = Array.isArray(c.players) && c.players.length;
  const bd = strengthBreakdown(c, ws);

  const bars = bd.map(b => {
    const pct = b.max ? Math.round((b.pts / b.max) * 100) : 0;
    return `<div style="margin-bottom:8px">
      <div class="row" style="justify-content:space-between;gap:8px">
        <span class="small"><strong>${b.label}</strong> <span class="muted">${escG(b.detail)}</span></span>
        <span class="small muted">${b.pts.toFixed(1)} / ${b.max}</span>
      </div>
      <div class="progress" style="margin-top:3px"><div style="width:${pct}%"></div></div>
    </div>`;
  }).join("");

  let playersHtml;
  if (!deep) {
    playersHtml = `<div style="padding:14px;background:var(--bg2);border-radius:8px;text-align:center">
      <p class="muted small" style="margin-bottom:10px">
        Player-level data not loaded — strength is estimated from clan stats only.
      </p>
      ${c.live ? `<button data-deepload="${escG(c.tag)}">Load players &amp; war stars</button>` : `<span class="muted small">Manually-added clan — no player data available.</span>`}
    </div>`;
  } else {
    const sorted = c.players.slice().sort((a, b) => playerScore(b) - playerScore(a));
    const inWar = sorted.filter(p => p.warPreference === "in").length;
    const totalStars = sorted.reduce((a, p) => a + (p.warStars || 0), 0);
    const topStars = sorted.slice().sort((a, b) => (b.warStars || 0) - (a.warStars || 0))[0];
    const thCounts = {};
    sorted.forEach(p => { thCounts[p.thLevel] = (thCounts[p.thLevel] || 0) + 1; });
    const thSummary = Object.keys(thCounts).sort((a, b) => b - a)
      .map(th => `<span class="player-chip"><span class="th">TH${th}</span>×${thCounts[th]}</span>`).join("");

    playersHtml = `
      <div class="grid3" style="margin-bottom:12px">
        <div class="stat-box"><div class="muted small">War stars (clan total)</div><div style="font-size:1.3rem;font-weight:800;color:var(--gold)">⭐ ${totalStars.toLocaleString()}</div></div>
        <div class="stat-box"><div class="muted small">Opted in to war</div><div style="font-size:1.3rem;font-weight:800;color:${inWar >= ws ? "var(--green)" : "var(--red)"}">${inWar} / ${sorted.length}</div></div>
        <div class="stat-box"><div class="muted small">Top war player</div><div style="font-size:1rem;font-weight:800">${escG(topStars.name)} <span class="muted small">⭐${topStars.warStars}</span></div></div>
      </div>
      <div style="margin-bottom:12px">${thSummary}</div>
      <div style="max-height:340px;overflow-y:auto;border:1px solid var(--border);border-radius:8px">
      <table><thead><tr>
        <th>#</th><th>Player</th><th>TH</th><th>War ⭐</th><th>Heroes</th><th>League</th><th>War</th>
      </tr></thead><tbody>` +
      sorted.map((p, i) => `<tr>
        <td class="muted small">${i + 1}</td>
        <td><strong>${escG(p.name)}</strong>${p.role === "leader" || p.role === "coLeader" ? ` <span class="pill small">${p.role === "leader" ? "Leader" : "Co"}</span>` : ""}<div class="muted small">${escG(p.tag)}</div></td>
        <td><span class="player-chip"><span class="th">TH${p.thLevel}</span></span></td>
        <td><strong style="color:var(--gold)">${(p.warStars || 0).toLocaleString()}</strong></td>
        <td class="muted small">${p.heroSum ? "Σ " + p.heroSum : "—"}</td>
        <td class="muted small">${escG(p.leagueTier || "—")}</td>
        <td>${p.warPreference === "in"
            ? `<span class="pill" style="color:var(--green);border-color:var(--green)">IN</span>`
            : p.warPreference === "out"
              ? `<span class="pill" style="color:var(--red);border-color:var(--red)">OUT</span>`
              : `<span class="muted small">?</span>`}</td>
      </tr>`).join("") + `</tbody></table></div>`;
  }

  return `<div class="clan-detail">
    <div class="grid2" style="gap:20px">
      <div>
        <h4 style="margin-bottom:10px">Why this score — ${clanStrength(c, ws)} / 100</h4>
        ${bars}
        <p class="muted small" style="margin-top:10px">
          Win streak is deliberately capped at 4 points: a strong clan can break its streak on a
          single bad war, and a weak clan can build one against easy matchups.
        </p>
      </div>
      <div>
        <h4 style="margin-bottom:10px">Roster${deep ? ` — ${c.players.length} players` : ""}</h4>
        ${playersHtml}
      </div>
    </div>
  </div>`;
}

/* Pull full player data for one clan (war stars, leagues, war preference). */
async function deepLoadClan(tag) {
  const c = state.clans.find(x => x.tag === tag);
  if (!c) return;
  msg(`Loading players for ${c.name} — this takes ~20s…`, "busy");
  document.querySelectorAll("[data-deepload]").forEach(b => b.disabled = true);
  try {
    const d = await apiGet("clan-deep", tag);
    Object.assign(c, d, { live: true });
    const ths = (d.players || []).map(p => p.thLevel).filter(Boolean);
    if (ths.length) c.avgTH = +(ths.reduce((a, b) => a + b, 0) / ths.length).toFixed(1);
    saveState(); renderAll();
    msg(`✔ ${c.name}: ${d.players.length} players loaded.`, "ok");
  } catch (e) {
    msg("⚠️ " + e.message, "error");
    document.querySelectorAll("[data-deepload]").forEach(b => b.disabled = false);
  }
}

/* ---------------- promotion probability ----------------
   Monte-Carlo: each war day, every clan's "performance" = its strength plus
   random noise (attack execution, missed hits, base quality). Sum across 7
   rounds; count how often we land in the top 2. This handles the real shape of
   CWL — one strong clan can still slip on a bad day — better than a formula. */
function simulate(clans, myTag, runs = 6000, warSize = 15) {
  const me = clans.findIndex(c => normTag(c.tag) === normTag(myTag));
  if (me < 0 || clans.length < 2) return null;

  // Compress raw strength into a per-round scoring rate. A 40-point strength gap
  // is large but not decisive over 7 rounds, so we scale it against the group's
  // own spread rather than using absolute points.
  const raw = clans.map(c => clanStrength(c, warSize));
  const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
  const spread = Math.max(6, Math.sqrt(raw.reduce((a, s) => a + (s - mean) ** 2, 0) / raw.length));
  const strengths = raw.map(s => (s - mean) / spread); // ~ -2 … +2

  // Per-round noise in the same units. CWL days swing hard — missed attacks,
  // mis-scouted bases, players who forget to hit — so a paper favourite loses
  // individual days often. 1.8σ keeps upsets realistic: a clan one full spread
  // stronger takes a given day ~66% of the time, and no seed is ever a lock.
  const NOISE = 1.8;
  let top1 = 0, top2 = 0, bottom = 0;
  const seedTally = new Array(clans.length).fill(0);

  for (let r = 0; r < runs; r++) {
    const totals = strengths.map((s) => {
      let t = 0;
      for (let d = 0; d < 7; d++) {
        // Box-Muller normal noise
        const u = Math.random() || 1e-9, v = Math.random() || 1e-9;
        t += s + Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * NOISE;
      }
      return t;
    });
    const order = totals.map((t, i) => ({ t, i })).sort((a, b) => b.t - a.t);
    const rank = order.findIndex(o => o.i === me);
    seedTally[rank]++;
    if (rank === 0) top1++;
    if (rank < 2) top2++;
    if (rank >= clans.length - 2) bottom++;
  }
  return {
    promote: top2 / runs,
    first: top1 / runs,
    demote: bottom / runs,
    expectedSeed: seedTally.reduce((acc, n, i) => acc + n * (i + 1), 0) / runs,
  };
}

function renderAnalysis() {
  const enough = state.clans.length >= 2 && state.myTag && state.clans.some(c => normTag(c.tag) === normTag(state.myTag));
  $g("analysisSection").style.display = enough ? "block" : "none";
  if (!enough) return;

  const ws = Number(state.warSize) || 15;
  const sorted = state.clans.slice().sort((a, b) => clanStrength(b, ws) - clanStrength(a, ws));
  const sim = simulate(sorted, state.myTag, 6000, ws);
  if (!sim) return;

  const pct = Math.round(sim.promote * 100);
  $g("promoPct").textContent = pct + "%";
  $g("promoPct").style.color = pct >= 50 ? "var(--green)" : pct >= 25 ? "var(--gold)" : "var(--red)";
  $g("promoBar").style.width = pct + "%";
  $g("promoBar").style.background = pct >= 50 ? "var(--green)" : pct >= 25 ? "var(--gold)" : "var(--red)";

  const missing = 8 - state.clans.length;
  $g("promoNote").innerHTML =
    `Win the group outright: <strong>${Math.round(sim.first * 100)}%</strong> · ` +
    `Risk of bottom-2 demotion: <strong>${Math.round(sim.demote * 100)}%</strong>` +
    (missing > 0 ? `<br /><em>Based on ${state.clans.length} clans — add the remaining ${missing} for a full picture.</em>` : "") +
    `<br />6,000 simulated seasons using clan strength + realistic per-day variance.`;

  const mine = clanStrength(state.clans.find(c => normTag(c.tag) === normTag(state.myTag)), ws);
  const others = sorted.filter(c => normTag(c.tag) !== normTag(state.myTag)).map(c => clanStrength(c, ws));
  const avgOther = others.reduce((a, b) => a + b, 0) / (others.length || 1);
  const gap = mine - avgOther;
  const stronger = others.filter(s => s > mine).length;

  let label, note;
  if (stronger === 0) { label = "Easy"; note = "You're the strongest clan on paper — promotion is yours to lose."; }
  else if (stronger === 1) { label = "Favourable"; note = "Only one clan outranks you. Consistent 2-star hits should secure top 2."; }
  else if (stronger === 2) { label = "Competitive"; note = "You're on the promotion bubble — every missed attack matters."; }
  else if (stronger <= 4) { label = "Tough"; note = "Several stronger clans. You'll need near-perfect attack days and their slip-ups."; }
  else { label = "Very Tough"; note = "Most of the group outranks you. Play for safety from demotion, not promotion."; }

  $g("difficultyLabel").textContent = label;
  $g("difficultyLabel").style.color = stronger <= 1 ? "var(--green)" : stronger <= 2 ? "var(--gold)" : "var(--red)";
  $g("difficultyNote").textContent = note;
  $g("projectedSeed").textContent = `#${sim.expectedSeed.toFixed(1)} of ${state.clans.length}`;

  const rows = sorted.filter(c => normTag(c.tag) !== normTag(state.myTag)).map(c => {
    const s = clanStrength(c, ws);
    const d = s - mine;
    const verdict = d > 8 ? ["Stronger than us", "var(--red)"]
      : d < -8 ? ["Weaker than us", "var(--green)"]
      : ["Evenly matched", "var(--gold)"];
    return `<tr>
      <td>${escG(c.name)}</td>
      <td class="muted">${c.avgTH ? "avg TH " + c.avgTH : "—"}</td>
      <td><strong>${s}</strong></td>
      <td style="color:${verdict[1]}">${d > 0 ? "+" : ""}${d} · ${verdict[0]}</td>
    </tr>`;
  }).join("");

  $g("riskBreakdown").innerHTML = `
    <h3>Head-to-head vs your clan (strength ${mine}), gap ${gap > 0 ? "+" : ""}${gap.toFixed(1)}</h3>
    <table style="margin-top:10px"><thead><tr>
      <th>Opponent</th><th>Roster</th><th>Strength</th><th>Verdict</th>
    </tr></thead><tbody>${rows}</tbody></table>`;
}

/* ---------------- roster ---------------- */
function playerTier(p, all) {
  const scores = all.map(playerScore).sort((a, b) => b - a);
  const s = playerScore(p);
  const idx = scores.indexOf(s);
  if (idx < scores.length / 3) return "strong";
  if (idx < (scores.length * 2) / 3) return "mid";
  return "weak";
}

function renderRoster() {
  const show = state.roster.length > 0;
  $g("rosterSection").style.display = show ? "block" : "none";
  if (!show) return;

  const sorted = state.roster.slice().sort((a, b) => playerScore(b) - playerScore(a));
  const active = sorted.filter(p => p.active !== false);
  $g("rosterList").innerHTML = `
    <p class="muted small">${active.length} active of ${sorted.length} · war size ${state.warSize}</p>
    <table style="margin-top:10px"><thead><tr>
      <th>#</th><th>Player</th><th>TH</th><th>Heroes</th><th>Tier</th><th>In CWL</th>
    </tr></thead><tbody>` +
    sorted.map((p, i) => {
      const tier = playerTier(p, active.length ? active : sorted);
      return `<tr style="${p.active === false ? "opacity:.45" : ""}">
        <td class="muted">${i + 1}</td>
        <td><strong>${escG(p.name)}</strong><div class="muted small">${escG(p.tag || "")}</div></td>
        <td><span class="player-chip"><span class="th">TH${p.thLevel || "?"}</span></span></td>
        <td class="muted small">${p.heroSum ? "Σ " + p.heroSum : "—"}</td>
        <td><span class="tier-label t-${tier}">${tier.toUpperCase()}</span></td>
        <td><input type="checkbox" data-toggle="${escG(p.tag || p.name)}" ${p.active === false ? "" : "checked"} style="width:16px;height:16px;cursor:pointer" /></td>
      </tr>`;
    }).join("") + `</tbody></table>`;

  $g("rosterList").querySelectorAll("[data-toggle]").forEach(cb => {
    cb.addEventListener("change", () => {
      const key = cb.dataset.toggle;
      const p = state.roster.find(x => (x.tag || x.name) === key);
      if (p) { p.active = cb.checked; saveState(); renderRoster(); renderAssignments(); }
    });
  });
}

/* ---------------- assignments ----------------
   Opponents sorted hardest → easiest. Each war day fields `warSize` players:
   the hardest opponents get the highest-scoring available attackers.        */
function autoAssign() {
  const opponents = state.clans
    .filter(c => normTag(c.tag) !== normTag(state.myTag))
    .sort((a, b) => clanStrength(b, Number(state.warSize) || 15) - clanStrength(a, Number(state.warSize) || 15));
  const active = state.roster.filter(p => p.active !== false).sort((a, b) => playerScore(b) - playerScore(a));
  if (!opponents.length || !active.length) return;

  const size = Math.min(Number(state.warSize) || 15, active.length);
  state.assignments = {};
  opponents.forEach((opp, day) => {
    // Hardest day → take from the top of the ranked list. Easiest → from the bottom,
    // so your best players are conserved for the fights that decide promotion.
    const hardness = day / Math.max(1, opponents.length - 1); // 0 = hardest
    const pool = active.slice();
    let picked;
    if (hardness <= 0.34) picked = pool.slice(0, size);
    else if (hardness >= 0.67) picked = pool.slice(Math.max(0, pool.length - size));
    else {
      const start = Math.floor((pool.length - size) / 2);
      picked = pool.slice(start, start + size);
    }
    state.assignments[opp.tag] = picked.map(p => p.tag || p.name);
  });
  saveState();
  renderAssignments();
}

function renderAssignments() {
  const opponents = state.clans
    .filter(c => normTag(c.tag) !== normTag(state.myTag))
    .sort((a, b) => clanStrength(b, Number(state.warSize) || 15) - clanStrength(a, Number(state.warSize) || 15));
  const show = opponents.length > 0 && state.roster.length > 0;
  $g("assignSection").style.display = show ? "block" : "none";
  if (!show) return;

  const active = state.roster.filter(p => p.active !== false);
  const myStrength = clanStrength(state.clans.find(c => normTag(c.tag) === normTag(state.myTag)) || {}, Number(state.warSize) || 15);

  $g("dayList").innerHTML = opponents.map((opp, i) => {
    const s = clanStrength(opp, Number(state.warSize) || 15);
    const diff = s - myStrength;
    const tag = diff > 8 ? ["MUST-WIN · hardest", "var(--red)"]
      : diff < -8 ? ["Comfortable", "var(--green)"]
      : ["Close call", "var(--gold)"];
    const assigned = state.assignments[opp.tag] || [];
    const chips = assigned.map(key => {
      const p = state.roster.find(x => (x.tag || x.name) === key);
      return p ? `<span class="player-chip"><span class="th">TH${p.thLevel || "?"}</span>${escG(p.name)}</span>` : "";
    }).join("");

    return `
      <div class="day-card">
        <div class="row" style="justify-content:space-between">
          <div>
            <strong>War Day ${i + 1}</strong> vs <strong>${escG(opp.name)}</strong>
            <span class="pill" style="color:${tag[1]}; border-color:${tag[1]}; margin-left:8px">${tag[0]}</span>
            <div class="muted small">Their strength ${s} (${diff > 0 ? "+" : ""}${diff} vs you)${opp.avgTH ? ` · avg TH ${opp.avgTH}` : ""}</div>
          </div>
          <select data-day="${escG(opp.tag)}" style="max-width:190px">
            <option value="">— change lineup —</option>
            <option value="strongest">Field strongest ${state.warSize}</option>
            <option value="weakest">Field weakest ${state.warSize}</option>
            <option value="middle">Field middle ${state.warSize}</option>
          </select>
        </div>
        <div style="margin-top:10px">${chips || `<span class="muted small">No lineup yet — hit “Auto-assign all 7 days”.</span>`}</div>
      </div>`;
  }).join("");

  $g("dayList").querySelectorAll("[data-day]").forEach(sel => {
    sel.addEventListener("change", () => {
      const mode = sel.value;
      if (!mode) return;
      const pool = active.slice().sort((a, b) => playerScore(b) - playerScore(a));
      const size = Math.min(Number(state.warSize) || 15, pool.length);
      let picked;
      if (mode === "strongest") picked = pool.slice(0, size);
      else if (mode === "weakest") picked = pool.slice(Math.max(0, pool.length - size));
      else { const st = Math.floor((pool.length - size) / 2); picked = pool.slice(st, st + size); }
      state.assignments[sel.dataset.day] = picked.map(p => p.tag || p.name);
      saveState();
      renderAssignments();
    });
  });
}

/* ---------------- roster loading ---------------- */
async function loadRosterFor(tag) {
  if (!proxyLive) return;
  const m = await apiGet("clan-members", tag);
  const members = m.items || [];
  const roster = [];
  // fetch hero levels per player (sequential-ish to stay friendly to rate limits)
  for (const p of members) {
    let heroSum = 0;
    try {
      const full = await apiGet("player", p.tag);
      heroSum = (full.heroes || [])
        .filter(h => !h.village || h.village === "home")
        .reduce((a, h) => a + (h.level || 0), 0);
    } catch {}
    roster.push({ name: p.name, tag: p.tag, thLevel: p.townHallLevel || 0, heroSum, active: true });
  }
  state.roster = roster;
  saveState();
  renderRoster();
  renderAssignments();
}

/* ---------------- events ---------------- */
$g("leagueSelect").addEventListener("change", e => { state.league = e.target.value; saveState(); });
$g("warSizeSelect").addEventListener("change", e => { state.warSize = Number(e.target.value); saveState(); renderAssignments(); });

$g("loadMyClanBtn").addEventListener("click", async () => {
  const tag = normTag($g("myClanTag").value);
  if (tag.length < 4) return ($g("groupMsg").textContent = "Enter a valid clan tag.");
  state.myTag = tag; saveState();
  const btn = $g("loadMyClanBtn");
  setBusy(btn, true, "Loading…");
  msg("Fetching your clan and every member's war stats — this takes ~20s…", "busy");
  try {
    if (!proxyLive) throw new Error("Live data unavailable — use “Add manually”.");
    const clan = await fetchClan(tag);
    state.clans = state.clans.filter(c => normTag(c.tag) !== normTag(tag));
    state.clans.push(clan);
    saveState(); renderAll();
    msg("Building your roster…", "busy");
    await loadRosterFor(tag);
    msg(`✔ ${clan.name} loaded — ${state.roster.length} players.`, "ok");
  } catch (e) { msg("⚠️ " + e.message, "error"); }
  finally { setBusy(btn, false); }
});

$g("addClanBtn").addEventListener("click", async () => {
  const tag = normTag($g("opponentTag").value);
  if (tag.length < 4) return ($g("groupMsg").textContent = "Enter a valid clan tag.");
  if (state.clans.some(c => normTag(c.tag) === tag)) return ($g("groupMsg").textContent = "That clan is already in the group.");
  if (state.clans.length >= 8) return ($g("groupMsg").textContent = "A CWL group holds 8 clans.");
  const btn = $g("addClanBtn");
  setBusy(btn, true, "Fetching…");
  msg(`Loading ${tag} and its roster — this takes ~20s…`, "busy");
  try {
    if (!proxyLive) throw new Error("Live data unavailable — use “Add manually”.");
    const c = await fetchClan(tag);
    state.clans.push(c);
    $g("opponentTag").value = "";
    saveState(); renderAll();
    msg(`✔ ${c.name} added — ${state.clans.length} / 8 clans.`, "ok");
  } catch (e) { msg("⚠️ " + e.message, "error"); }
  finally { setBusy(btn, false); }
});

$g("autoGroupBtn").addEventListener("click", async () => {
  const tag = normTag($g("myClanTag").value || state.myTag);
  if (tag.length < 4) return ($g("groupMsg").textContent = "Enter your clan tag first.");
  const btn = $g("autoGroupBtn");
  setBusy(btn, true, "Detecting…");
  msg("Detecting your CWL group…", "busy");
  try {
    if (!proxyLive) throw new Error("Live data unavailable — add the 8 clans manually.");
    const g = await apiGet("cwl-group", tag);
    if (!g.clans) throw new Error(g.reason === "notFound" ? "No active CWL group — wait for matchmaking." : "Group unavailable.");
    state.myTag = tag;
    state.clans = [];
    let n = 0;
    for (const c of g.clans) {
      n++;
      msg(`Loading clan ${n} of ${g.clans.length} — ${c.name}…`, "busy");
      try { state.clans.push(await fetchClan(c.tag)); }
      catch { state.clans.push({ tag: c.tag, name: c.name, level: c.clanLevel, avgTH: null, live: false }); }
      saveState(); renderClans();
    }
    renderAll();
    msg("Building your roster…", "busy");
    await loadRosterFor(tag);
    msg(`✔ Group loaded — ${state.clans.length} clans, ${state.roster.length} players.`, "ok");
  } catch (e) { msg("⚠️ " + e.message, "error"); }
  finally { setBusy(btn, false); }
});

$g("manualClanBtn").addEventListener("click", () => { $g("manualForm").style.display = "block"; });
$g("cancelManualBtn").addEventListener("click", () => { $g("manualForm").style.display = "none"; });
$g("saveManualBtn").addEventListener("click", () => {
  const name = $g("mName").value.trim();
  const tag = normTag($g("mTag").value) || "#MANUAL" + Date.now().toString(36).toUpperCase();
  if (!name) return ($g("groupMsg").textContent = "Clan name is required.");
  if (state.clans.length >= 8) return ($g("groupMsg").textContent = "A CWL group holds 8 clans.");
  state.clans.push({
    name, tag,
    level: Number($g("mLevel").value) || null,
    warWins: Number($g("mWins").value) || 0,
    warLosses: 0,
    winStreak: Number($g("mStreak").value) || 0,
    avgTH: Number($g("mAvgTH").value) || null,
    // No API data for a manual clan, so seed it with the group's league from
    // Season setup. Everyone in a CWL group shares a league, which is a far
    // better estimate than the neutral "unknown" score.
    warLeague: state.league || null,
    members: [], live: false,
  });
  ["mName", "mTag", "mLevel", "mWins", "mStreak", "mAvgTH"].forEach(id => ($g(id).value = ""));
  $g("manualForm").style.display = "none";
  saveState(); renderAll();
});

$g("clearGroupBtn").addEventListener("click", () => {
  if (!confirm("Clear the whole group and start a new season?")) return;
  state = { league: state.league, warSize: state.warSize, myTag: "", clans: [], roster: [], assignments: {} };
  saveState(); renderAll();
});

$g("refreshRosterBtn").addEventListener("click", async () => {
  if (!state.myTag) return;
  const btn = $g("refreshRosterBtn");
  setBusy(btn, true, "Reloading…");
  msg("Reloading your roster…", "busy");
  try { await loadRosterFor(state.myTag); msg(`✔ Roster reloaded — ${state.roster.length} players.`, "ok"); }
  catch (e) { msg("⚠️ " + e.message, "error"); }
  finally { setBusy(btn, false); }
});

$g("autoAssignBtn").addEventListener("click", autoAssign);
$g("clearAssignBtn").addEventListener("click", () => { state.assignments = {}; saveState(); renderAssignments(); });

/* ---------------- init ---------------- */
/* ---------------- round history ----------------
   Who each clan has actually fielded so far this CWL. The member list on a clan
   is everyone in it; this is the 15 (or 30) they chose to put in a war. */
function renderRounds() {
  const d = state.rounds;
  $g("roundsSection").style.display = state.myTag ? "block" : "none";
  if (!d) return;

  const mine = normTag(state.myTag);
  const clans = d.clans.slice().sort((a, b) =>
    (normTag(b.tag) === mine) - (normTag(a.tag) === mine) || a.name.localeCompare(b.name));

  $g("roundsResult").innerHTML = clans.map(c => {
    const isUs = normTag(c.tag) === mine;
    const mix = Object.entries(c.currentThMix).sort((a, b) => b[0] - a[0])
      .map(([th, n]) => `<span class="player-chip"><span class="th">TH${th}</span>×${n}</span>`).join("");

    // Split the pool: everyone who played every round is the core, the rest rotate.
    const core = c.players.filter(p => p.appearances === c.roundsPlayed);
    const rot  = c.players.filter(p => p.appearances < c.roundsPlayed);

    const rows = c.players.map(p => `<tr>
      <td><strong>${escG(p.name)}</strong><div class="muted small">${escG(p.tag)}</div></td>
      <td><span class="player-chip"><span class="th">TH${p.th}</span></span></td>
      <td><strong style="color:var(--gold)">⭐ ${p.stars ?? 0}</strong>${
        p.avgStars != null ? `<div class="muted small">${p.avgStars} avg · ${p.avgDestruction}%</div>` : ""}</td>
      <td><strong style="color:${p.appearances === c.roundsPlayed ? "var(--green)" : "var(--muted)"}">${p.appearances} / ${c.roundsPlayed}</strong>${
        p.attacks ? `<div class="muted small">${p.attacks} attack${p.attacks === 1 ? "" : "s"}</div>` : ""}</td>
    </tr>`).join("");

    return `<details class="card" style="padding:14px 16px;margin-bottom:10px"${isUs ? " open" : ""}>
      <summary><strong>${escG(c.name)}</strong>${isUs ? ` <span class="pill" style="color:var(--primary-text);border-color:var(--primary)">YOU</span>` : ""}
        <span class="muted small"> — ${c.roundsPlayed} round${c.roundsPlayed === 1 ? "" : "s"} played</span></summary>
      <div style="margin-top:12px">
        <div class="muted small" style="margin-bottom:6px">Currently fielding</div>
        <div style="margin-bottom:12px">${mix || '<span class="muted small">—</span>'}</div>
        <p class="muted small" style="margin-bottom:10px">
          ${core.length} player${core.length === 1 ? "" : "s"} in every round${rot.length ? `, ${rot.length} rotated in and out` : " — no rotation so far"}.
          ${c.totalAttacks ? `<strong style="color:var(--gold)">⭐ ${c.totalStars}</strong> from ${c.totalAttacks} attacks
            <span class="muted">(${(c.totalStars / c.totalAttacks).toFixed(2)} per attack)</span>.` : ""}
        </p>
        <table><thead><tr><th>Player</th><th>TH</th><th>Stars</th><th>Rounds</th></tr></thead><tbody>${rows}</tbody></table>
      </div>
    </details>`;
  }).join("");
}

async function loadRounds() {
  if (!state.myTag) return roundsMsg("Set your clan tag first.", "error");
  roundsMsg("Pulling every round in your group — this takes ~20s…", "busy");
  $g("loadRoundsBtn").disabled = true;
  try {
    state.rounds = await apiGet("cwl-rounds", state.myTag);
    saveState(); renderRounds();
    roundsMsg(`✔ ${state.rounds.roundsAvailable} of ${state.rounds.totalRounds} rounds loaded.`, "ok");
  } catch (e) {
    roundsMsg("⚠️ " + e.message, "error");
  } finally {
    $g("loadRoundsBtn").disabled = false;
  }
}

function roundsMsg(text, kind) {
  const el = $g("roundsMsg");
  el.innerHTML = kind === "busy" ? `<span class="spinner dark"></span>${text}` : text;
  el.style.color = kind === "error" ? "var(--red)" : kind === "ok" ? "var(--green)" : "var(--muted)";
}

$g("loadRoundsBtn").addEventListener("click", loadRounds);

function renderAll() { renderClans(); renderAnalysis(); renderRoster(); renderAssignments(); renderRounds(); }

$g("myClanTag").value = state.myTag || "";
$g("leagueSelect").value = state.league || "Master League I";
$g("warSizeSelect").value = String(state.warSize || 15);
renderAll();
checkProxy();
