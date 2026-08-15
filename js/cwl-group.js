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

/* A player's Ranked tier as icon + name.
 *
 * The badge carries the rank at a glance where the bare string did not — the
 * ladder is 37 rungs deep and "Electro League 33" versus "Legend III" means
 * nothing to anyone who has not memorised the order.
 *
 * An unknown tier renders as an em dash rather than a broken image: clan-deep
 * returns null for players the API has no league for, and that is a real state,
 * not an error. Icons are remote, so they get lazy loading and a transparent
 * failure — a missing badge should cost the name next to it nothing. */
function leagueBadge(tier, { compact = false } = {}) {
  const t = window.LeagueTiers ? window.LeagueTiers.resolve(tier) : null;
  if (!t) return `<span class="muted">—</span>`;
  const size = compact ? 16 : 20;
  return `<span class="league-badge" title="${escG(t.name)} — rank ${t.rank} of 36">
    <img src="${escG(t.iconUrls.small)}" alt="" width="${size}" height="${size}"
         loading="lazy" onerror="this.style.display='none'">
    <span>${escG(t.name)}</span></span>`;
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
// Every button that fires an API call. A button missing from this list would be
// disabled by its own setBusy(true) and never re-enabled, stranding it after the
// first click.
const BUSY_BUTTONS = "#addClanBtn,#loadMyClanBtn,#autoGroupBtn,#loadEligibilityBtn";

function setBusy(btn, on, label) {
  if (!btn) return;
  if (on) {
    btn.dataset.orig = btn.dataset.orig || btn.innerHTML;
    btn.innerHTML = `<span class="spinner"></span>${label || "Working…"}`;
    document.querySelectorAll(BUSY_BUTTONS).forEach(b => { b.disabled = true; });
  } else {
    if (btn.dataset.orig) btn.innerHTML = btn.dataset.orig;
    // Clear the busy button too — it is inside the selector, but only if the
    // caller passed one that the list knows about.
    btn.disabled = false;
    document.querySelectorAll(BUSY_BUTTONS).forEach(b => { b.disabled = false; });
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
        <td class="small">${leagueBadge(p.leagueTier)}</td>
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

/* ---------------- ranking our own players ----------------
 *
 * Our side is ranked on ranked form (js/eligibility.js), never on playerScore.
 * Town Hall, hero levels and war stars measure what someone has accumulated,
 * not whether they are attacking now, so ranking the roster that way put maxed
 * accounts that have stopped playing above people actually turning up — the
 * exact failure eligibility.js exists to correct.
 *
 * playerScore survives only for OPPONENT clans (rosterPower, the clan-detail
 * table) where we have clan-deep data and no battle logs at all, and as
 * ourMapOrder's last-resort tie-break when the game itself has never ranked a
 * player.
 *
 * The cost is that assignments need the step-4 analysis to have been run. That
 * is deliberate: a line-up built from Town Hall numbers looks just as
 * authoritative as one built from form, and quietly showing the worse ranking
 * is how the old roster section misled in the first place.
 */

/* Form score by player key, or null before the analysis has been run. */
function formRanks() {
  if (!eligibility) return null;
  const byKey = new Map();
  eligibility.members.forEach((m) => {
    // Rank on the same figure the step-4 table shows, so the two orderings can
    // never disagree. Unrated players and non-attackers keep a null and sort
    // last rather than being scored on capability we cannot see.
    const usable = m.rated && m.summary.attackCount > 0;
    byKey.set(m.tag, usable ? m.score : null);
    byKey.set(m.name, usable ? m.score : null);
  });
  return byKey;
}

/* Comparator over state.roster entries, best form first.
 *
 * Players with no readable record sort last as a block but stay selectable:
 * when the API fails for several accounts you still have to field fifteen
 * people, and an unmeasured player is a gap in our data rather than a verdict
 * on them. */
function byFormDesc(ranks) {
  const of = (p) => {
    const v = ranks.get(p.tag) ?? ranks.get(p.name);
    return v == null ? -1 : v;
  };
  return (a, b) => of(b) - of(a);
}

/* Everyone available to be fielded, best form first. */
function activeRoster(ranks) {
  return state.roster.slice().sort(byFormDesc(ranks));
}

/* ---------------- CWL eligibility ----------------
   Ranks the roster on recent Ranked form (js/battlelog.js + js/eligibility.js)
   rather than on Town Hall alone. Held in memory, not state: the battle log is
   a rolling ~50-battle window, so a cached ranking goes stale within days and a
   stale "who should play" list is worse than no list.                        */
let eligibility = null;

/* The call on each player, colour-coded. Green field them, amber playable but
   unresolved, red hard to justify. Set by explain() in js/eligibility.js. */
const VERDICT = {
  yes:   { label: "Pick",   color: "var(--green)" },
  maybe: { label: "Maybe",  color: "var(--gold)" },
  no:    { label: "Avoid",  color: "var(--red)" },
};

/* Confidence is driven by attacks observed, not by how long the window is — a
   busy player fills the game's fixed battle buffer faster and so shows a
   SHORTER window, which is the opposite of weak evidence. */
function confidenceLabel(c) {
  if (c >= 0.8) return { text: "solid", cls: "" };
  if (c >= 0.5) return { text: "partial", cls: "muted" };
  return { text: "few attacks", cls: "muted" };
}

/* How long ago, in the game's own phrasing. Recent battles get real units
   because "17 hours ago" tells you whether someone is playing today; older ones
   collapse to days, which is all the precision that still matters. */
function agoLabel(date) {
  if (!date) return "—";
  const ms = Date.now() - new Date(date).getTime();
  const h = ms / 3600000;
  if (h < 1) return "just now";
  if (h < 24) return `${Math.round(h)} hour${Math.round(h) === 1 ? "" : "s"} ago`;
  const d = h / 24;
  if (d < 2) return "a day ago";
  return `${Math.round(d)}d`;
}

/* Every ranked battle behind a player's score, attacks beside defences.
   The score says how they are doing; this says what actually happened, which is
   the difference between trusting the number and checking it.

   Trophy change carries the sign the game shows: an attack that took the whole
   pool reads +40, and a defence held at 0 stars reads +0 rather than blank —
   those are the ones that prove the base is holding. */
function battleLogPanel(summary) {
  const battles = summary.battles || [];
  const attacks = battles.filter((b) => b.isAttack);
  const defences = battles.filter((b) => !b.isAttack);

  const stars = (n) => `${"★".repeat(n)}${"☆".repeat(3 - n)}`;
  const row = (b) => `<div class="bl-row">
    <span class="bl-troph${b.trophyChange > 0 ? " up" : ""}">${b.trophyChange >= 0 ? "+" : ""}${b.trophyChange}</span>
    <span class="bl-stars${b.stars === 3 ? " full" : ""}">${stars(b.stars)}</span>
    <span class="bl-dest">${Math.round(b.destruction)}%</span>
    <span class="bl-when muted">${escG(agoLabel(b.timestamp))}</span>
  </div>`;

  const col = (label, list, empty) => `<div class="bl-col">
    <div class="bl-head">${label} <span class="muted small">${list.length}</span></div>
    ${list.length ? list.map(row).join("") : `<div class="muted small" style="padding:6px 2px">${empty}</div>`}
  </div>`;

  return `<div class="bl-panel">
    ${col("Attacks", attacks, "No attacks in this window.")}
    ${col("Defenses", defences, "No defences on record.")}
  </div>`;
}

/* Season-by-season attack usage — the evidence behind the confidence column.
 *
 * The battle log above shows current form on a ~50-battle buffer. This shows
 * whether that form is backed by months of showing up, which is the question CWL
 * actually turns on: a missed hit costs up to three stars and cannot be made up.
 *
 * Only usage is charted. Trophies and placement are shown per row but explicitly
 * NOT compared across seasons where the tier differs, and stars are absent
 * entirely because the API returns 0 for them — see js/leaguehistory.js. Saying
 * so in the panel is deliberate: a blank column invites the reader to assume we
 * measured something and found nothing. */
function seasonPanel(seasons) {
  if (!seasons || !seasons.hasData) {
    return `<div class="season-panel">
      <div class="bl-head">Season reliability</div>
      <p class="muted small" style="margin:0">No completed ranked seasons on record —
        either a new account, or the API has no league history for them. Confidence
        rests on the battle log alone.</p>
    </div>`;
  }

  const pct = Math.round(seasons.usage * 100);
  // The verdict colour has to match what the number means for selection, not
  // just how big it is: 85% is the line where missed hits start to matter.
  const tone = seasons.reliable == null ? "var(--muted)"
    : seasons.reliable ? "var(--green)" : "var(--red)";

  const rows = seasons.seasons.slice().reverse().map((s) => {
    const u = s.usage == null ? 0 : Math.round(s.usage * 100);
    const when = s.date
      ? s.date.toLocaleDateString(undefined, { month: "short", year: "numeric" })
      : "—";
    const full = s.usage === 1;
    return `<div class="season-row">
      <span class="season-when muted">${escG(when)}</span>
      <span class="season-bar" title="${s.attacksUsed} of ${s.attacksAvailable} attacks used">
        <span class="season-fill${full ? " full" : ""}" style="width:${u}%"></span>
      </span>
      <span class="season-count${full ? " full" : ""}">${s.attacksUsed}/${s.attacksAvailable}</span>
      <span class="season-tier muted small">${s.tier ? escG(s.tier.name) : "—"}</span>
      <span class="season-troph muted small">${s.trophies ? s.trophies.toLocaleString() : "—"}${
        s.placement ? ` · #${s.placement}` : ""}</span>
    </div>`;
  }).join("");

  // What the headline number rests on, in one line, so the percentage is never
  // read as a bare score.
  const verdict = seasons.reliable == null
    ? `Only ${seasons.seasonCount} season${seasons.seasonCount === 1 ? "" : "s"} on record — too few to call either way.`
    : seasons.reliable
      ? `Used ${seasons.attacksUsed} of ${seasons.attacksAvailable} available attacks across ${seasons.seasonCount} seasons${
          seasons.perfectSeasons ? `, ${seasons.perfectSeasons} of them perfect` : ""}. Unlikely to miss CWL hits.`
      : `Used only ${seasons.attacksUsed} of ${seasons.attacksAvailable} available attacks across ${seasons.seasonCount} seasons. Has a record of leaving attacks unused.`;

  return `<div class="season-panel">
    <div class="bl-head">Season reliability
      <span class="muted small" style="font-weight:600">— attacks used, not how well</span>
    </div>
    <div class="season-headline">
      <strong style="color:${tone}">${pct}%</strong>
      <span class="muted small">${escG(verdict)}</span>
    </div>
    <div class="season-rows">${rows}</div>
    <p class="muted small season-note">
      Ranked seasons only, most recent first. Trophies and placement are shown for
      context but compare only within the same tier — the API publishes no trophy
      cutoffs, so a total from one league says nothing against another. Star counts
      are omitted because the endpoint returns zero for them on every account, so
      there is no historical triple rate to show.</p>
  </div>`;
}

function renderEligibility() {
  const show = state.roster.length > 0;
  $g("eligibilitySection").style.display = show ? "block" : "none";
  if (!show || !eligibility) return;

  const suggested = new Set(eligibility.suggested);
  const rows = eligibility.members.map((m) => {
    const s = m.summary;
    const conf = confidenceLabel(m.confidence);
    const inRoster = suggested.has(m.tag);

    // Form is the headline number, so an absent one has to read as "unknown"
    // rather than as a low score.
    const formCell = m.formScore == null
      ? `<span class="muted">—</span>`
      : `<strong style="color:${strengthColor(m.formScore)}">${m.formScore}</strong>`;

    // Show the average against its league's par, or "+38 avg" alone invites the
    // exact misreading this whole model exists to prevent — that a big number in
    // an easy league beats a smaller one under Legend I's modifiers.
    const attacks = s.hasData
      ? `${s.attackCount} atk${s.avgAttackGain
          ? ` · +${s.avgAttackGain.toFixed(0)} vs par ${m.expectedGain}` : ""}`
      : "no log";

    // An unrated player has no score to show. A bare 0 would read as a
    // judgement rather than a gap in the data.
    const scoreCell = m.rated
      ? `<strong style="color:${strengthColor(m.score)}">${m.score}</strong>`
      : `<span class="muted small">unrated</span>`;

    // The verdict drives the colour, not the score: a 55 can be a strong Legend I
    // attacker with few attacks on record, or someone coasting below par, and
    // those want opposite decisions.
    const v = VERDICT[m.verdict] || VERDICT.no;

    return `<tr class="elig-row${s.hasData ? " elig-clickable" : ""}" ${s.hasData ? `data-battles="${escG(m.tag)}"` : ""} style="${inRoster ? "" : "opacity:.55"}">
      <td class="muted">${m.rank}</td>
      <td><strong>${escG(m.name)}</strong>
        ${inRoster ? `<span class="pill" style="color:var(--green); border-color:var(--green)">P${m.band}</span>` : ""}
        ${s.hasData ? `<span class="elig-caret" aria-hidden="true">▸</span>` : ""}
        <div class="muted small">${escG(m.tag)}${m.leagueTier
          ? ` · ${leagueBadge(m.leagueTier, { compact: true })}` : ""}</div></td>
      <td><span class="player-chip"><span class="th">TH${m.thLevel || "?"}</span></span></td>
      <td>${scoreCell}</td>
      <td>${formCell}</td>
      <td class="muted small">${escG(attacks)}</td>
      <td class="small ${conf.cls}">${conf.text}</td>
      <td class="muted small">${s.windowDays ? s.windowDays.toFixed(1) + "d" : "—"}</td>
    </tr>
    <tr style="${inRoster ? "" : "opacity:.55"}">
      <td></td>
      <td colspan="7" class="small" style="padding-top:0; border-top:none">
        <div style="border-left:3px solid ${v.color}; padding-left:10px">
          <strong style="color:${v.color}">${v.label}</strong>
          <span class="muted"> — ${escG(m.rationale)}</span>
        </div>
      </td>
    </tr>
    ${s.hasData ? `<tr class="elig-battles" data-for="${escG(m.tag)}" hidden>
      <td></td>
      <td colspan="7" style="padding-top:0; border-top:none">${battleLogPanel(s)}
        <div class="season-mount" data-for="${escG(m.tag)}"></div></td>
    </tr>` : ""}`;
  }).join("");

  // Which data the ranking is standing on. Without this the window column looks
  // arbitrary — "1.9d" and "12.4d" side by side with no explanation of why.
  const sourceNote = eligibility.usedStored
    ? `<p class="muted small" style="margin-top:10px">
         Using collected history for ${eligibility.usedStored} player${eligibility.usedStored === 1 ? "" : "s"}
         — a daily job accumulates ranked battles beyond the ~50-battle window the game
         keeps, so form gets more reliable the longer it runs${eligibility.storedUpdatedAt
           ? ` (last collected ${escG(new Date(eligibility.storedUpdatedAt).toLocaleDateString())})` : ""}.</p>`
    : `<p class="muted small" style="margin-top:10px">
         No collected history for this clan yet, so this is the live ~50-battle window only
         — a few days for active players. Run
         <code>node scripts/collect-battles.mjs '${escG(normTag(state.myTag))}'</code> daily
         to build a longer, steadier picture.</p>`;

  // Production runs on Lambda behind API Gateway, which hangs up at 29s, so a
  // big clan can come back part-fetched. Saying so matters: those players are
  // unmeasured, not inactive, and the difference decides whether you bench them.
  const truncWarn = eligibility.truncated
    ? `<p class="small" style="margin-top:10px; color:var(--gold)">
         Ran out of time fetching the whole clan, so some players were never
         checked. Run it again to fill them in — the ones already fetched are
         cached, so the second pass gets further.</p>`
    : "";

  const warn = eligibility.unrated
    ? `<p class="muted small" style="margin-top:10px">
         ${eligibility.unrated} player${eligibility.unrated === 1 ? " has" : "s have"} no
         readable battle log and ${eligibility.unrated === 1 ? "is" : "are"} listed as
         <strong>unrated</strong> rather than scored — the API returns an error for some
         accounts, and that is not evidence they are inactive. They are left out of the
         suggested ${state.warSize}; include them by judgement if you know they play.</p>`
    : "";

  $g("eligibilityList").innerHTML = `
    <p class="muted small">Grouped by league, hardest first — every Legend I player, then
      Legend II, and so on — and by score within each league. The
      ${eligibility.suggested.length} highlighted rows are the strongest by score regardless
      of league, for war size ${state.warSize}.</p>
    ${glossaryHtml()}
    <table style="margin-top:10px"><thead><tr>
      <th>#</th><th>Player</th><th>TH</th><th>Score</th><th>Form</th>
      <th>Ranked attacks vs league par</th><th>Evidence</th><th>Window</th>
    </tr></thead><tbody>${rows}</tbody></table>${sourceNote}${truncWarn}${warn}`;

  // Clicking a player opens the battles behind their score. Rows without a
  // readable log carry no handle, so there is nothing to open on a player we
  // could not measure.
  $g("eligibilityList").querySelectorAll("[data-battles]").forEach((tr) => {
    tr.addEventListener("click", () => {
      const tag = tr.dataset.battles;
      const panel = $g("eligibilityList").querySelector(`.elig-battles[data-for="${CSS.escape(tag)}"]`);
      if (!panel) return;
      panel.hidden = !panel.hidden;
      tr.classList.toggle("elig-open", !panel.hidden);
      // Season history is one API call per player, so it is fetched the first
      // time someone actually looks rather than for all 50 members on load.
      if (!panel.hidden) loadSeasons(tag);
    });
  });
}

/* Season history for one player, fetched on first expand.
 *
 * Loading this for a whole clan would be a third fan-out — one call per member
 * on top of clan-deep and clan-battlelogs — to answer a question most players
 * are never asked. Expanding a row is the moment it becomes worth knowing, so
 * that is when it is fetched, and the result is cached for the session. */
const seasonCache = new Map();

async function loadSeasons(tag) {
  const mount = $g("eligibilityList")
    .querySelector(`.season-mount[data-for="${CSS.escape(tag)}"]`);
  if (!mount || mount.dataset.loaded) return;
  mount.dataset.loaded = "1";

  const render = (summary) => { mount.innerHTML = seasonPanel(summary); };

  if (seasonCache.has(tag)) { render(seasonCache.get(tag)); return; }

  mount.innerHTML = `<div class="season-panel"><div class="bl-head">Season reliability</div>
    <p class="muted small" style="margin:0">Loading season history…</p></div>`;

  try {
    const raw = await apiGet("leaguehistory", tag.replace(/^#/, ""));
    const summary = LeagueHistory.summariseSeasons(raw);
    seasonCache.set(tag, summary);
    render(summary);
  } catch (e) {
    // A failure here costs the reliability panel, nothing else — the score and
    // battle log above it stand on their own, so it says so rather than
    // implying the player has no history.
    mount.innerHTML = `<div class="season-panel"><div class="bl-head">Season reliability</div>
      <p class="muted small" style="margin:0">Could not load season history — ${escG(e.message)}.
      The form above is unaffected.</p></div>`;
    delete mount.dataset.loaded;   // let a retry happen on the next expand
  }
}

/* Definitions for every column, with the actual arithmetic.
 *
 * Collapsed by default — it is reference material, not something you re-read on
 * every visit — but present on the page rather than buried in the README,
 * because a ranking nobody can audit is a ranking nobody should trust. The
 * numbers here are read from the live model rather than retyped, so the
 * documentation cannot drift from the code. */
function glossaryHtml() {
  const par = [
    ["Legend I", 36], ["Legend II", 35], ["Legend III", 34],
    ["Electro 31-33", 33], ["Dragon 30 and below", 30],
  ].map(([label, rank]) =>
    `<tr><td>${escG(label)}</td>
       <td style="text-align:right">+${Eligibility.expectedAttackGain(rank)}</td>
       <td style="text-align:right">${Math.round(Eligibility.tierBonus(rank) * 100)}%</td></tr>`).join("");

  return `<details class="card" style="margin-top:12px">
    <summary><strong>How these numbers are calculated</strong>
      <span class="muted small"> — what each column means</span></summary>
    <div style="margin-top:14px" class="small">

      <p class="muted">Players are judged on <strong>ranked form only</strong>: attacks
      actually used and how they went. Town Hall, hero levels and war stars are deliberately
      not counted — they reward accumulation rather than current form, and would let a maxed
      account parked at a lower Town Hall outrank someone who is genuinely attacking now.</p>

      <h4 style="margin:14px 0 4px">How the roster is filled <span class="muted small">— the P1/P2/P3 tags</span></h4>
      <p class="muted">CWL is won by attacking well <em>and</em> by not being three-starred, so
      the suggested roster fills in priority order rather than by score alone:</p>
      <table style="margin:8px 0"><thead><tr><th>Priority</th><th>Who</th><th>Why</th></tr></thead><tbody>
        <tr><td><strong>P1</strong></td><td>Legend I</td>
            <td class="muted">Getting there takes sustained form under the harshest modifiers
            in the game — a stronger claim than one good week</td></tr>
        <tr><td><strong>P2</strong></td><td>Maxed TH18 in Legend II/III</td>
            <td class="muted">The defensive core: bases the opposition cannot casually
            three-star</td></tr>
        <tr><td><strong>P3</strong></td><td>Legend II/III attackers</td>
            <td class="muted">Not maxed, but consistently taking stars off hard bases</td></tr>
      </tbody></table>
      <p class="muted">Priority only applies to players who are actually playing: below a
      score of ${60} a maxed base drops out of P2 and queues on form with everyone else,
      because a strong base helps nobody if its owner has stopped attacking. Within P2, the
      player who is <strong>harder to three-star</strong> is preferred — the API exposes no
      defence levels, but how often someone is actually tripled is measurable, and it beats
      hero levels: two players with a full hero roster measured 6% and 75%, because layout
      decides it.</p>

      <h4 style="margin:14px 0 4px">Pick / Maybe / Avoid <span class="muted small">— the call under each row</span></h4>
      <p class="muted">The score alone does not settle whether to field someone. A 55 might be
      a strong Legend I attacker with only five hits on record, or a Dragon League player
      coasting well below par — opposite decisions from the same number. So each row carries
      a verdict and the case for it:</p>
      <table style="margin:8px 0"><thead><tr><th>Verdict</th><th>Means</th></tr></thead><tbody>
        <tr><td><strong style="color:var(--green)">Pick</strong></td>
            <td class="muted">Enough attacks on record, performing at or above their league's par</td></tr>
        <tr><td><strong style="color:var(--gold)">Maybe</strong></td>
            <td class="muted">Playable, but something is unresolved — too few attacks to be sure,
            or real activity at middling quality</td></tr>
        <tr><td><strong style="color:var(--red)">Avoid</strong></td>
            <td class="muted">Not attacking, barely attacking, or no readable record at all</td></tr>
      </tbody></table>
      <p class="muted">Strong form on thin evidence never drops below <strong>Maybe</strong>:
      the score has already been discounted for low volume, so judging it against the same
      thresholds again would penalise the shortage twice.</p>

      <h4 style="margin:14px 0 4px">Score <span class="muted small">— the ranking number, 0-100</span></h4>
      <p class="muted">Form, discounted by how much evidence stands behind it:</p>
      <p><code>Score = Form × (0.5 + 0.5 × confidence)</code></p>
      <p class="muted">At full confidence Score equals Form. The discount never goes below
      half, so a genuine attacker with a short record is not buried by a measurement limit.
      A player with no readable battle log is <strong>unrated</strong> and has no score —
      that is a gap in the data, not a judgement about them.</p>

      <h4 style="margin:14px 0 4px">Form <span class="muted small">— performance, before any discount</span></h4>
      <p class="muted">Four parts, each capped at 1 before weighting:</p>
      <table style="margin:8px 0"><thead><tr><th>Part</th><th>Measures</th><th style="text-align:right">Weight</th></tr></thead><tbody>
        <tr><td>Activity</td><td class="muted">attacks per day ÷ 4</td><td style="text-align:right">45%</td></tr>
        <tr><td>Gain</td><td class="muted">average trophies ÷ league par</td><td style="text-align:right">30%</td></tr>
        <tr><td>Triples</td><td class="muted">triple rate ÷ league triple par</td><td style="text-align:right">15%</td></tr>
        <tr><td>League</td><td class="muted">bonus for competing in a harder tier</td><td style="text-align:right">10%</td></tr>
      </tbody></table>
      <p class="muted">Activity carries the most weight on purpose: CWL is won by people who
      use their attacks, not by whoever posts the single best hit. A player with defences but
      zero attacks scores on activity alone — a defence proves someone was online, not that
      they attacked.</p>

      <h4 style="margin:14px 0 4px">Ranked attacks vs league par</h4>
      <p class="muted">Raw counts, plus the par for that player's league. Ranked
      <strong>Battle Modifiers</strong> buff defences and defending heroes while penalising
      the attacker's, and they get harsher the higher you climb — so the same attack scores
      lower in Legend I than several tiers below it. Par is what a competent attacker earns
      in that tier, measured from this clan:</p>
      <table style="margin:8px 0"><thead><tr>
        <th>League</th><th style="text-align:right">Par per attack</th><th style="text-align:right">League bonus</th>
      </tr></thead><tbody>${par}</tbody></table>
      <p class="muted"><code>+30 vs par 28</code> beats expectations; <code>+38 vs par 39</code>
      falls short despite the bigger number. Without this a Legend I player would rank last
      for competing where it is hardest.</p>

      <h4 style="margin:14px 0 4px">Evidence <span class="muted small">— how far to trust Form</span></h4>
      <p class="muted">Driven by attacks observed. Ten attacks reaches
      <strong>solid</strong> on its own; defences alone can only carry it part of the way.</p>
      <p><code>confidence = max(attacks ÷ 10, (attacks + defences) ÷ 20 × 0.7)</code></p>
      <p class="muted">solid ≥ 0.8 · partial ≥ 0.5 · few attacks below that.</p>

      <h4 style="margin:14px 0 4px">Window <span class="muted small">— informational only</span></h4>
      <p class="muted">Days between the oldest and newest battle on record. It does
      <strong>not</strong> affect the score, and a short window is not a bad sign: the game
      keeps a rolling buffer of about 50 battles, so the harder someone plays the faster they
      fill it and the shorter their window looks. Scoring on window length once ranked two of
      this clan's most active Legend I players 18th and 19th on the third- and fourth-best
      form in the roster.</p>

    </div>
  </details>`;
}

/* Accumulated battle history for a clan, or null.
 *
 * Written daily by scripts/collect-battles.mjs and committed, so it ships as a
 * static file alongside the pages. Absent for any clan nobody collects — that is
 * the normal case, not an error, so a 404 returns null silently and the page
 * falls back to the live buffer. */
async function fetchStoredHistory(tag) {
  try {
    const r = await fetch(`data/battles-${encodeURIComponent(tag.toUpperCase())}.json`, { cache: "no-cache" });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j.battles) ? j : null;
  } catch { return null; }
}

async function loadEligibility() {
  const btn = $g("loadEligibilityBtn");
  const out = $g("eligibilityMsg");
  if (!state.myTag) { out.textContent = "Load your clan first."; return; }

  setBusy(btn, true, "Reading battle logs…");
  // One call per member, so this is the slowest thing the page does. Say so,
  // or it reads as a hang.
  out.textContent = `Fetching ranked battles for every member — this takes about 20 seconds…`;

  try {
    const tag = normTag(state.myTag).replace(/^#/, "");
    // Sequential, not Promise.all: both endpoints fan out to one request per
    // member, and firing them together spends the per-IP budget twice over in
    // the same window — which fails as a rate limit, not as a real error.
    const deep = await apiGet("clan-deep", tag);
    const logs = await apiGet("clan-battlelogs", tag);

    // Accumulated history, if a daily collection run has been committed for this
    // clan. The live call above only ever sees a rolling ~50-battle buffer —
    // under four days for the most active players, which is precisely who we
    // most need to judge. Stored history is preferred wherever it is longer.
    const stored = await fetchStoredHistory(tag);
    const storedByTag = stored ? BattleLog.groupStoredByPlayer(stored) : null;
    let usedStored = 0;

    const merged = (logs.members || []).map((m) => {
      const hist = storedByTag && storedByTag.get(m.tag);
      if (!hist) return m;
      // Prefer whichever covers more ground. Stored is normally a superset, but
      // on the day of the first run they are the same data, and a member who
      // joined since the last run has only the live buffer.
      const liveCount = ((m.battlelog && m.battlelog.items) || []).length;
      if (hist.items.length <= liveCount) return m;
      usedStored++;
      return { ...m, battlelog: hist };
    });

    // Season history is deliberately NOT fetched here. It is one call per member
    // on top of the two fan-outs above, and most players are never expanded — so
    // it is loaded per-player on click instead. See loadSeasons().
    eligibility = Eligibility.rankClan(deep.players || [], merged, {
      warSize: Number(state.warSize) || 15,
    });
    // Set by the Lambda when it hit its wall-clock budget mid-clan.
    eligibility.truncated = !!logs.truncated;
    eligibility.storedUpdatedAt = stored ? stored.updatedAt : null;
    eligibility.usedStored = usedStored;

    const withForm = eligibility.members.filter((m) => m.formScore != null).length;
    out.textContent = `Ranked ${eligibility.members.length} players · ${withForm} with ranked form`
      + (usedStored ? ` · ${usedStored} using collected history` : "");
    out.style.color = "var(--green)";
    renderEligibility();
    // Assignments rank on form, so they were gated until now.
    renderAssignments();
  } catch (e) {
    // Loading the clan already spends much of the per-IP budget, so running this
    // straight afterwards is the most likely way to hit the limit. Say what to do.
    out.textContent = /too many requests/i.test(e.message)
      ? "Rate limit reached — the clan load used this minute's requests. Wait a minute and try again."
      : `Could not read battle logs — ${e.message}`;
    out.style.color = "var(--red)";
  } finally {
    setBusy(btn, false);
  }
}

/* ---------------- assignments ----------------
   Opponents sorted hardest → easiest. Each war day fields `warSize` players:
   the hardest opponents get the best-form available attackers.              */
function autoAssign() {
  const ranks = formRanks();
  if (!ranks) return;   // step 4 not run — renderAssignments explains why
  const opponents = state.clans
    .filter(c => normTag(c.tag) !== normTag(state.myTag))
    .sort((a, b) => clanStrength(b, Number(state.warSize) || 15) - clanStrength(a, Number(state.warSize) || 15));
  const active = activeRoster(ranks);
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

/* How the game itself ranked our players, learned from the rounds we already
   played.

   The map position CoC assigns is a whole-base strength ranking — defenses,
   walls, pets, troop levels, the lot. Nothing we compute sees that: form
   measures attacking, and the API exposes no defensive building levels at all.
   Their side never had this problem, because it reads a real mapPosition
   straight from the war.

   So do the same for ours. Average each player's mapPosition over the rounds
   they were actually fielded in (recent rounds weighted heavier, since a base
   that upgraded mid-season should drift), and sort by that. Players with no
   history — a new member, or someone who has not warred yet — have no in-game
   ranking to read, so they fall back to form and sort below everyone who does.

   This is a map ORDER, not a selection: it decides where the players already
   assigned to a day line up against the enemy map, so it stays on mapPosition
   rather than form. Who gets fielded at all is decided in step 4.

   Returns a comparator, falling back to form when we have no history at all. */
function ourMapOrder() {
  const ranks = formRanks();
  const byForm = ranks ? byFormDesc(ranks) : () => 0;
  const mine = state.rounds?.clans?.find(c => normTag(c.tag) === normTag(state.myTag));
  const rounds = mine?.rounds;
  if (!rounds?.length) return byForm;

  // Newest round counts most: a base upgraded mid-season should move.
  const played = rounds.filter(r => r.lineup?.length).sort((a, b) => a.round - b.round);
  if (!played.length) return byForm;

  const acc = new Map(); // key -> { sum, weight }
  played.forEach((r, i) => {
    const w = i + 1; // linear recency weight
    r.lineup.forEach(p => {
      if (p.pos == null) return;
      const key = p.tag || p.name;
      const cur = acc.get(key) || { sum: 0, weight: 0 };
      cur.sum += p.pos * w;
      cur.weight += w;
      acc.set(key, cur);
    });
  });

  const rank = (p) => {
    const e = acc.get(p.tag || p.name) ?? acc.get(p.name);
    return e && e.weight ? e.sum / e.weight : null;
  };

  return (a, b) => {
    const ra = rank(a), rb = rank(b);
    // Lower map position is stronger. Anyone the game has never ranked sorts
    // after everyone it has, rather than being guessed into the middle.
    if (ra != null && rb != null) return ra - rb;
    if (ra != null) return -1;
    if (rb != null) return 1;
    return byForm(a, b);
  };
}

/* The in-game war map, replicated: your line-up down the left, theirs down the
   right, paired by map position. Their side is the roster they actually
   fielded most recently — on preparation day that is visible before a single
   attack, which is when knowing it is worth most.

   Clicking one of your slots opens a picker, so the line-up can be reordered
   against what you can see of theirs. */
function renderWarMap(opp, assignedKeys, isToday = true) {
  const rounds = state.rounds?.clans?.find(c => normTag(c.tag) === normTag(opp.tag));
  const last = rounds?.rounds?.[rounds.rounds.length - 1];
  if (!last?.lineup?.length) return "";

  // The game orders a war map by base strength, and the position it assigned is
  // exactly that ranking — so map position is the sort, not a tiebreak.
  // A past round may have been a bigger war than the one being planned, so the
  // map is capped at the size actually being fielded — never more rows than
  // there are attackers.
  const size = Math.min(Number(state.warSize) || 15, last.lineup.length);
  const theirs = last.lineup.slice().sort((a, b) => a.pos - b.pos).slice(0, size);
  const ours = assignedKeys
    .map(k => state.roster.find(x => (x.tag || x.name) === k))
    .filter(Boolean)
    .sort(ourMapOrder());

  const TH = "assets/town-hall/town-hall.png";
  const slot = (p, side) => {
    if (!p) return `<div class="wm-slot wm-empty"><span class="muted small">empty</span></div>`;
    const th = side === "them" ? p.th : (p.thLevel || 0);
    const name = p.name;
    return `<div class="wm-slot">
      <div class="wm-th">
        <img src="${TH}" alt="" loading="lazy" />
        <span class="wm-thlvl">${th || "?"}</span>
      </div>
      <div class="wm-name">${escG(name)}</div>
    </div>`;
  };

  const rows = theirs.map((t, i) => {
    const o = ours[i];
    const gap = o ? (o.thLevel || 0) - t.th : null;
    const tone = gap == null ? "var(--muted)"
      : gap >= 1 ? "var(--green)" : gap === 0 ? "var(--gold)" : "var(--red)";
    const verdict = gap == null ? "—" : gap > 0 ? `+${gap}` : gap === 0 ? "=" : `${gap}`;

    return `<div class="wm-row">
      <button class="wm-side wm-you wm-col-you" data-pick="${escG(opp.tag)}" data-idx="${i}"
        title="Change who attacks base ${t.pos}">${slot(o, "you")}</button>
      <div class="wm-mid">
        <div class="wm-pos">${t.pos}</div>
        <div class="wm-gap" style="color:${tone}">${verdict}</div>
      </div>
      <div class="wm-side wm-them">${slot(t, "them")}</div>
    </div>`;
  }).join("");

  const outmatched = theirs.filter((t, i) => ours[i] && (ours[i].thLevel || 0) < t.th).length;

  // On a phone the opponent's line-up is the thing worth seeing — it is what you
  // plan against, and it is visible on preparation day before anyone attacks.
  // Our own side is knowable from the roster, so it starts hidden there and the
  // board shows a single column. Desktop has the width for both, so it shows
  // both. The toggle flips it either way.
  return `<details class="card wm-card" style="margin-top:10px"${isToday ? " open" : ""}>
    <summary><strong>War map</strong>${
      isToday ? ` <span class="pill" style="color:var(--gold);border-color:var(--gold)">TODAY</span>` : ""}
      <span class="muted small"> — their round ${last.round} line-up${
        outmatched ? ` · <span style="color:var(--red)">${outmatched} of yours outmatched</span>` : " · no mismatches"}</span></summary>
    <div class="row" style="justify-content:flex-end;margin-top:10px">
      <button type="button" class="wm-toggle" data-wm-toggle aria-pressed="false">
        <span class="wm-toggle-show">Show my line-up</span>
        <span class="wm-toggle-hide">Hide my line-up</span>
      </button>
    </div>
    <div class="wm-board">
      <div class="wm-head">
        <div class="wm-col-you">Your line-up</div>
        <div class="wm-vs">VS</div>
        <div>${escG(opp.name)}</div>
      </div>
      ${rows}
    </div>
    <p class="muted small" style="margin-top:10px">
      Tap one of your slots to swap the attacker. Numbers are map positions;
      the middle column is your Town Hall minus theirs.
    </p>
  </details>`;
}

/* Swap one of your attackers for another active player, keeping the rest of the
   day's line-up intact. */
function warMapPick(oppTag, idx) {
  const assigned = state.assignments[oppTag] || [];
  const ours = assigned
    .map(k => state.roster.find(x => (x.tag || x.name) === k))
    .filter(Boolean)
    .sort(ourMapOrder());
  const current = ours[idx];
  const ranks = formRanks();
  if (!ranks) return;
  const pool = activeRoster(ranks);
  if (!pool.length) return;

  const names = pool.map((p, i) =>
    `${i + 1}. ${p.name} (TH${p.thLevel || "?"})${(p.tag || p.name) === (current?.tag || current?.name) ? " ← current" : ""}`);
  const answer = prompt(`Who attacks base ${idx + 1}?\n\n${names.join("\n")}\n\nEnter a number:`);
  const n = Number(answer);
  if (!n || n < 1 || n > pool.length) return;

  const picked = pool[n - 1];
  const key = picked.tag || picked.name;
  const next = ours.map(p => p.tag || p.name);
  // If the picked player is already in this line-up, swap the two slots rather
  // than fielding the same person twice.
  const existing = next.indexOf(key);
  if (existing >= 0) next[existing] = next[idx];
  next[idx] = key;

  state.assignments[oppTag] = next;
  saveState(); renderAssignments();
}

function renderAssignments() {
  // With round history loaded we know the real schedule, so show the days in
  // the order they will actually be played. Without it, fall back to hardest
  // first — which is an ordering of difficulty, not a schedule.
  const mineRounds = state.rounds?.clans?.find(c => normTag(c.tag) === normTag(state.myTag))?.rounds;
  const roundOf = (tag) =>
    mineRounds?.find(r => normTag(r.opponentTag || "") === normTag(tag))?.round ?? null;

  const opponents = state.clans
    .filter(c => normTag(c.tag) !== normTag(state.myTag))
    .sort((a, b) => {
      const ra = roundOf(a.tag), rb = roundOf(b.tag);
      if (ra != null && rb != null) return ra - rb;
      if (ra != null) return -1;
      if (rb != null) return 1;
      return clanStrength(b, Number(state.warSize) || 15) - clanStrength(a, Number(state.warSize) || 15);
    });
  const show = opponents.length > 0 && state.roster.length > 0;
  $g("assignSection").style.display = show ? "block" : "none";
  if (!show) return;

  // Assignments rank our side on ranked form, which only exists once step 4 has
  // run. Rather than fall back to a Town Hall ordering — which looks just as
  // authoritative on screen while being much worse advice — say what is missing
  // and stop.
  const ranks = formRanks();
  $g("assignControls").style.display = ranks ? "" : "none";
  if (!ranks) {
    $g("dayList").innerHTML = `
      <div class="card">
        <p class="muted" style="margin:0">
          Run <strong>Analyse ranked form</strong> in step 4 first. Day rosters are picked on
          recent attacking form, so there is nothing to order these by until that has been read.
        </p>
      </div>`;
    return;
  }

  const active = activeRoster(ranks);
  const myStrength = clanStrength(state.clans.find(c => normTag(c.tag) === normTag(state.myTag)) || {}, Number(state.warSize) || 15);

  // Which war needs you right now. A war you can still attack in ("inWar")
  // outranks one that has not started ("preparation") — the live one has a
  // clock on it. Only that opponent's map opens; rendering all 7 open cost ~8
  // screens of maps for wars nobody is fighting.
  const todayTag = (() => {
    if (!mineRounds?.length) return null;
    const byRound = mineRounds.slice().sort((a, b) => b.round - a.round);
    const cur = byRound.find(r => r.state === "inWar")
      || byRound.find(r => r.state === "preparation")
      || byRound[0];
    return cur?.opponentTag ? normTag(cur.opponentTag) : null;
  })();

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
            ${(() => {
              // If round history is loaded we know the real schedule, so name
              // the actual round rather than implying one from a strength sort.
              const mine = state.rounds?.clans?.find(c => normTag(c.tag) === normTag(state.myTag));
              const r = mine?.rounds?.find(x => normTag(x.opponentTag || "") === normTag(opp.tag));
              return r
                ? `<strong>Round ${r.round}</strong> vs <strong>${escG(opp.name)}</strong>`
                : `<strong>#${i + 1} toughest</strong> vs <strong>${escG(opp.name)}</strong>`;
            })()}
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
        ${renderWarMap(opp, assigned, todayTag == null || normTag(opp.tag) === todayTag)}
      </div>`;
  }).join("");

  $g("dayList").querySelectorAll("[data-pick]").forEach(btn => {
    btn.addEventListener("click", () => {
      warMapPick(btn.dataset.pick, Number(btn.dataset.idx));
    });
  });

  // Per-board toggle for our own column. The class lives on the board so the
  // breakpoint decides the default and this only ever overrides it.
  $g("dayList").querySelectorAll("[data-wm-toggle]").forEach(btn => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".wm-card");
      const on = card.classList.toggle("wm-show-you");
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  });

  $g("dayList").querySelectorAll("[data-day]").forEach(sel => {
    sel.addEventListener("change", () => {
      const mode = sel.value;
      if (!mode) return;
      const pool = active.slice();
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
    roster.push({ name: p.name, tag: p.tag, thLevel: p.townHallLevel || 0, heroSum });
  }
  state.roster = roster;
  saveState();
  // A new roster invalidates any ranking built from the old one.
  eligibility = null;
  $g("eligibilityList").innerHTML = "";
  $g("eligibilityMsg").textContent = "";
  renderEligibility();
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


$g("loadEligibilityBtn").addEventListener("click", loadEligibility);
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

    // Per-round line-ups in map order — the war roster as it was actually set.
    // Newest first. Only our own newest round opens: on a phone, expanding the
    // newest for all 8 clans cost ~29 screens of scrolling before you reached
    // anything you came for. Every other block stays a 46px summary you can tap.
    const roundBlocks = c.rounds.slice().reverse().map((r, idx) => {
      const prep = r.state === "preparation";
      const lineRows = r.lineup.map(p => `<tr>
        <td class="muted">${p.pos}</td>
        <td><strong>${escG(p.name)}</strong><div class="muted small">${escG(p.tag)}</div></td>
        <td><span class="player-chip"><span class="th">TH${p.th}</span></span></td>
        <td>${p.attacks
          ? `<strong style="color:var(--gold)">⭐ ${p.stars}</strong><div class="muted small">${p.destruction}%</div>`
          : `<span class="muted small">${prep ? "not started" : "no attack"}</span>`}</td>
      </tr>`).join("");

      return `<details class="card" style="padding:12px 14px;margin-bottom:8px;background:var(--bg2)"${isUs && idx === 0 ? " open" : ""}>
        <summary><strong>Round ${r.round}</strong>
          <span class="muted small"> — ${r.teamSize} v ${r.teamSize}${
            prep ? " · preparation day" : ` · ⭐ ${r.stars} · ${Math.round(r.destruction)}%`}</span></summary>
        <table style="margin-top:10px"><thead><tr>
          <th>#</th><th>Player</th><th>TH</th><th>Result</th>
        </tr></thead><tbody>${lineRows}</tbody></table>
      </details>`;
    }).join("");

    return `<details class="card" style="padding:14px 16px;margin-bottom:10px"${isUs ? " open" : ""}>
      <summary><strong>${escG(c.name)}</strong>${isUs ? ` <span class="pill" style="color:var(--primary-text);border-color:var(--primary)">YOU</span>` : ""}
        <span class="muted small"> — ${c.roundsPlayed} round${c.roundsPlayed === 1 ? "" : "s"} played</span></summary>
      <div style="margin-top:12px">
        <div class="muted small" style="margin-bottom:6px">Currently fielding</div>
        <div style="margin-bottom:12px">${mix || '<span class="muted small">—</span>'}</div>

        <div class="muted small" style="margin-bottom:6px">Line-up each round</div>
        <div style="margin-bottom:14px">${roundBlocks}</div>
        <p class="muted small" style="margin-bottom:10px">
          ${core.length} player${core.length === 1 ? "" : "s"} in every round${rot.length ? `, ${rot.length} rotated in and out` : " — no rotation so far"}.
          ${c.totalAttacks ? `<strong style="color:var(--gold)">⭐ ${c.totalStars}</strong> from ${c.totalAttacks} attacks
            <span class="muted">(${(c.totalStars / c.totalAttacks).toFixed(2)} per attack)</span>.` : ""}
        </p>
        <!-- Season totals are research, not war-day data: a full roster table
             every time costs ~4 screens on a phone. The headline above already
             carries the summary, so the per-player rows stay one tap away. -->
        <details class="card" style="padding:12px 14px;background:var(--bg2)">
          <summary><strong>Across all rounds</strong>
            <span class="muted small"> — per-player stars &amp; appearances</span></summary>
          <table style="margin-top:10px"><thead><tr><th>Player</th><th>TH</th><th>Stars</th><th>Rounds</th></tr></thead><tbody>${rows}</tbody></table>
        </details>
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

function renderAll() { renderClans(); renderAnalysis(); renderEligibility(); renderAssignments(); renderRounds(); }

$g("myClanTag").value = state.myTag || "";
$g("leagueSelect").value = state.league || "Master League I";
$g("warSizeSelect").value = String(state.warSize || 15);
renderAll();
checkProxy();
