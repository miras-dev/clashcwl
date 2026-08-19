/* Legends Day — one player's ranked day, battle by battle.
 *
 * The CWL Helper already reads GET /players/{tag}/battlelog to score a roster's
 * ranked form; this page points the same endpoint at one account and answers a
 * different question: how did TODAY go. Attacks used out of the eight, what
 * they earned, what the defences gave back, and where the trophy count started.
 *
 * Two calls per player, both already proxied: /api/player for the live trophy
 * count and the league, /api/battlelog for the battles. The day maths lives in
 * js/legendday.js so it can be tested without a browser.
 *
 * State kept: the last tag looked up and a short list of recents, under
 * cc_legends. Nothing else — the report is cheap to rebuild and always stale.
 */
(function () {
"use strict";

const $l = (id) => document.getElementById(id);
const STORE = "cc_legends";
const RECENTS_KEPT = 6;

/* The proxy is a separate origin in production (API Gateway → Lambda) and the
   same one under `node server.js`. Mirrors js/cwl-group.js. */
const API_BASE = /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
  ? ""
  : "https://api.clashcwl.com";

let state = loadState();
let view = { player: null, days: [], selected: null, battlelog: null };
let proxyLive = false;

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || "null");
    if (s && typeof s === "object") {
      return { tag: s.tag || "", recents: Array.isArray(s.recents) ? s.recents : [] };
    }
  } catch {}
  return { tag: "", recents: [] };
}
function saveState() {
  try { localStorage.setItem(STORE, JSON.stringify(state)); }
  catch (e) { console.warn("Legends state save failed", e); }
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function normTag(t) {
  return "#" + String(t || "").trim().toUpperCase().replace(/^#/, "").replace(/[^0-9A-Z]/g, "");
}
function signed(n) {
  return (n > 0 ? "+" : "") + n;
}

/* ---------------- data source ---------------- */

async function checkProxy() {
  const el = $l("proxyStatus");
  try {
    const r = await fetch(`${API_BASE}/api/status`);
    const j = await r.json();
    proxyLive = !!j.hasKey;
  } catch { proxyLive = false; }
  if (!el) return;
  el.innerHTML = proxyLive
    ? `<span class="status-dot dot-on"></span>Live CoC API connected`
    : `<span class="status-dot dot-off"></span>Live data unavailable right now`;
  el.style.borderColor = proxyLive ? "var(--green)" : "var(--border)";
  el.style.color = proxyLive ? "var(--green)" : "var(--muted)";
}

async function apiGet(endpoint, tag) {
  const r = await fetch(`${API_BASE}/api/${endpoint}?tag=${encodeURIComponent(tag.replace(/^#/, ""))}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || j.reason || `HTTP ${r.status}`);
  return j;
}

/* ---------------- formatting ---------------- */

/* A ranked day is a 05:00–05:00 UTC window, so it is labelled by the UTC date
   it opened on. Using the local date would put half the world a day out. */
function dayLabel(start, { long = false } = {}) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC", weekday: long ? "long" : "short", day: "numeric",
    month: long ? "long" : "short",
  }).format(start);
}

/* Battle times, on the other hand, are shown in the reader's own timezone —
   "10:09 PM" is only useful if it is the clock they were playing against. */
function battleTime(date) {
  if (!date) return "—";
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function leagueBadge(tier) {
  const t = window.LeagueTiers ? window.LeagueTiers.resolve(tier) : null;
  if (!t) return "";
  return `<span class="league-badge" title="${esc(t.name)} — rank ${t.rank} of 36">
    <img src="${esc(t.iconUrls.small)}" alt="" width="18" height="18" loading="lazy"
         onerror="this.style.display='none'"><span>${esc(t.name)}</span></span>`;
}

/* ---------------- rendering ---------------- */

function battleRow(b, i, { good }) {
  const dir = b.trophyChange > 0 ? "up" : b.trophyChange < 0 ? "down" : "";
  return `<div class="ld-row">
    <span class="ld-i">${i + 1}</span>
    <span class="ld-when">${esc(battleTime(b.timestamp))}</span>
    <span class="ld-vs">
      <span class="ld-name">${esc(b.opponentName || "Unknown")}</span>
      <span class="ld-res${good(b) ? " good" : ""}">${b.stars}★ · ${Math.round(b.destruction)}%</span>
    </span>
    <span class="ld-delta ${dir}">${signed(b.trophyChange)}</span>
  </div>`;
}

function battleList(title, list, total, cls, empty, good) {
  const dir = total > 0 ? "up" : total < 0 ? "down" : "";
  return `<div class="ld-list ${cls}">
    <div class="ld-list-head">
      <h3>${title}</h3>
      <span class="ld-sum ${dir}">${list.length} · ${signed(total)}</span>
    </div>
    ${list.length
      ? list.map((b, i) => battleRow(b, i, { good })).join("")
      : `<p class="ld-empty">${empty}</p>`}
  </div>`;
}

function dayChips(days, selectedKey) {
  return `<div class="ld-days" role="group" aria-label="Ranked days in the log">
    ${days.map((d) => `<button type="button" class="ld-day${d.key === selectedKey ? " is-on" : ""}"
      data-day="${esc(d.key)}" aria-pressed="${d.key === selectedKey}">
      <i>${esc(dayLabel(d.start))}${d.inProgress ? " · today" : ""}</i>
      <b class="${d.net > 0 ? "up" : d.net < 0 ? "down" : ""}">${signed(d.net)}</b>
    </button>`).join("")}
  </div>`;
}

/* The four numbers the day is actually about.
 *
 * Day start is the only derived one: the API publishes no trophy history, so it
 * is the live count with everything since subtracted back off. It is exact
 * while the log still holds the whole day, which is what `complete` tracks. */
function tiles(day) {
  const atkAvg = day.avgAttack === null ? "—" : signed(Math.round(day.avgAttack * 10) / 10);
  const defAvg = day.avgDefense === null ? "—" : signed(Math.round(day.avgDefense * 10) / 10);
  const netDir = day.net > 0 ? "up" : day.net < 0 ? "down" : "";
  const allowance = (used, allowed) => allowed ? `${used} / ${allowed}` : String(used);

  return `<div class="ld-tiles">
    <div class="ld-tile">
      <i>Day start</i>
      <b>${day.startTrophies === null ? "—" : day.startTrophies}</b>
      <span>${day.endTrophies === null ? "trophies not available"
        : day.inProgress ? `Now ${day.endTrophies}` : `Ended ${day.endTrophies}`}</span>
    </div>
    <div class="ld-tile is-attack">
      <i>Attacks</i>
      <b>${allowance(day.attackCount, day.attacksAllowed)}</b>
      <span>${signed(day.attackTrophies)} · avg ${atkAvg}</span>
    </div>
    <div class="ld-tile is-defense">
      <i>Defenses</i>
      <b>${allowance(day.defenseCount, day.defensesAllowed)}</b>
      <span>${signed(day.defenseTrophies)} · avg ${defAvg}</span>
    </div>
    <div class="ld-tile is-net ${netDir}">
      <i>${day.inProgress ? "Net so far" : "Full day net"}</i>
      <b>${signed(day.net)}</b>
      <span>${day.attackCount + day.defenseCount} tracked battles</span>
    </div>
  </div>`;
}

/* The second rank of figures — true of the day, but not the headline. */
function statRail(day) {
  const bestHit = day.attacks.length ? Math.max(...day.attacks.map((b) => b.trophyChange)) : null;
  const worstDef = day.defenses.length ? Math.min(...day.defenses.map((b) => b.trophyChange)) : null;
  const stars = day.avgAttackStars === null ? "—" : (Math.round(day.avgAttackStars * 100) / 100).toFixed(2);

  const chip = (label, value) => `<div class="stat"><i>${label}</i><b>${value}</b></div>`;
  return `<div class="stat-rail">
    ${chip("Triples", `${day.triples} of ${day.attackCount || 0}`)}
    ${chip("Avg stars", stars)}
    ${chip("0★ holds", `${day.zeroStarHolds} of ${day.defenseCount || 0}`)}
    ${chip("Best hit", bestHit === null ? "—" : signed(bestHit))}
    ${chip("Worst defence", worstDef === null ? "—" : signed(worstDef))}
  </div>`;
}

/* Anything the numbers above cannot be trusted to say on their own. */
function caveats(day, battlelog) {
  const notes = [];
  if (!day.complete) {
    const from = window.LegendDay.logStartTime(battlelog);
    notes.push(`The game only keeps a rolling buffer of about 50 battles, and it runs out
      ${from ? `at ${esc(battleTime(from))} on ${esc(dayLabel(window.LegendDay.dayStartFor(from)))}` : "inside this day"} —
      earlier battles on this day are gone, so the totals here are a floor, not the full day.`);
  }
  if (day.startTrophies !== null) {
    notes.push(`Day start is worked back from the live trophy count: the API publishes no
      trophy history, only where the account stands right now.`);
  }
  if (!notes.length) return "";
  return `<p class="muted small" style="margin-top:14px">${notes.join(" ")}</p>`;
}

function renderReport() {
  const out = $l("report");
  const { player, days, selected, battlelog } = view;
  if (!player) { out.innerHTML = ""; return; }

  if (!days.length) {
    out.innerHTML = `<div class="ld-report">
      <div class="ld-eyebrow">Legend day report</div>
      <div class="ld-top"><div class="ld-who-head">
        <h2>${esc(player.name)}</h2>
        <div class="ld-sub">${esc(player.tag)} · ${leagueBadge(player.leagueTier) || "no ranked league"}</div>
      </div></div>
      <p class="muted" style="margin-top:14px">
        No ranked or Legend battles in this account's recent battle log. The log mixes every
        battle type together and only holds about 50, so a player who mostly farms can push
        their ranked days off the end of it — check back after a day of ranked attacks.
      </p>
    </div>`;
    return;
  }

  const day = window.LegendDay.findDay(days, selected) || days[0];

  out.innerHTML = `<div class="ld-report">
    <div class="ld-eyebrow">Legend day report</div>
    <div class="ld-top">
      <div class="ld-who-head">
        <h2>${esc(player.name)}</h2>
        <div class="ld-sub">${esc(player.tag)}
          · ${dayLabel(day.start, { long: true })}${day.inProgress ? " (today)" : ""}
          ${player.leagueTier ? " · " + leagueBadge(player.leagueTier) : ""}</div>
      </div>
      <div class="ld-trophy">
        <i>Current trophies</i>
        <b>${Number.isFinite(player.trophies) ? player.trophies : "—"}</b>
      </div>
    </div>

    ${dayChips(days, day.key)}
    ${tiles(day)}
    ${statRail(day)}

    <div class="ld-cols">
      ${battleList("Attacks", day.attacks, day.attackTrophies, "atk",
        "No attacks on this day.", (b) => b.stars === 3)}
      ${battleList("Defenses", day.defenses, day.defenseTrophies, "def",
        "No defences on record for this day.", (b) => b.stars === 0)}
    </div>

    ${caveats(day, battlelog)}
    <p class="muted small" style="margin-top:8px">
      Ranked days run 05:00 → 05:00 UTC, so a battle just before the reset belongs to the day
      before. Battle times are shown in your own timezone; newest first.
    </p>
  </div>`;
}

/* Clan mates, so checking the rest of the roster is a tap rather than a tag
   paste. Only offered once a player has loaded — it hangs off their clan. */
function renderMates(members, currentTag) {
  const box = $l("mates");
  if (!members || !members.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<label for="mateSelect">Someone else in the clan</label>
    <select id="mateSelect">
      ${members.map((m) => `<option value="${esc(m.tag)}"${m.tag === currentTag ? " selected" : ""}>
        ${esc(m.name)} — TH${esc(m.townHallLevel ?? "?")} · ${esc(m.trophies ?? "?")}🏆
      </option>`).join("")}
    </select>`;
  $l("mateSelect").addEventListener("change", (e) => load(e.target.value));
}

function renderRecents() {
  const box = $l("recents");
  if (!state.recents.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<span class="muted small">Recent:</span> `
    + state.recents.map((r) => `<button type="button" class="seg-btn" data-recent="${esc(r.tag)}">
        ${esc(r.name || r.tag)}</button>`).join(" ");
}

function remember(player) {
  const entry = { tag: player.tag, name: player.name };
  state.tag = player.tag;
  state.recents = [entry, ...state.recents.filter((r) => r.tag !== player.tag)].slice(0, RECENTS_KEPT);
  saveState();
  renderRecents();
}

/* ---------------- loading ---------------- */

function setMsg(text, cls) {
  const el = $l("loadMsg");
  el.className = cls || "muted small";
  el.textContent = text;
}

async function load(rawTag) {
  const tag = normTag(rawTag);
  if (tag.length < 4) { setMsg("That does not look like a player tag — they look like #8JLYC9VG.", "error"); return; }

  $l("tagInput").value = tag;
  setMsg("Loading ranked days…");
  $l("loadBtn").disabled = true;

  try {
    // One round trip each, in parallel: the trophy count the day is measured
    // against, and the battles it is built from.
    const [player, battlelog] = await Promise.all([
      apiGet("player", tag),
      apiGet("battlelog", tag),
    ]);

    view.player = player;
    view.battlelog = battlelog;
    view.days = window.LegendDay.legendDays(battlelog, { currentTrophies: player.trophies });
    view.selected = view.days.length ? view.days[0].key : null;

    remember(player);
    setMsg(view.days.length
      ? `${view.days.length} ranked day${view.days.length === 1 ? "" : "s"} in the battle log.`
      : "No ranked battles in this player's log.");
    renderReport();

    // Deep-linkable: a report someone shares should open on the same player.
    history.replaceState(null, "", `?tag=${encodeURIComponent(tag.replace(/^#/, ""))}`);

    if (player.clan && player.clan.tag) loadMates(player.clan.tag, player.tag);
    else $l("mates").innerHTML = "";
  } catch (e) {
    setMsg(proxyLive
      ? `Could not load that player: ${e.message}`
      : `Live data is unavailable right now, so this page has nothing to read (${e.message}).`, "error");
  } finally {
    $l("loadBtn").disabled = false;
  }
}

async function loadMates(clanTag, currentTag) {
  try {
    const j = await apiGet("clan-members", clanTag);
    const members = (j.items || []).slice().sort((a, b) => (b.trophies || 0) - (a.trophies || 0));
    renderMates(members, currentTag);
  } catch {
    // A clan that cannot be read costs the page a convenience, not a report.
    $l("mates").innerHTML = "";
  }
}

/* ---------------- wiring ---------------- */

function init() {
  checkProxy();
  renderRecents();

  $l("loadBtn").addEventListener("click", () => load($l("tagInput").value));
  $l("tagInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") load($l("tagInput").value);
  });

  $l("recents").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-recent]");
    if (btn) load(btn.dataset.recent);
  });

  $l("report").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-day]");
    if (!btn) return;
    view.selected = btn.dataset.day;
    renderReport();
  });

  // A tag in the URL wins over the last one used: it is what the person who
  // followed the link asked for.
  const urlTag = new URLSearchParams(location.search).get("tag");
  const start = urlTag || state.tag;
  if (start) {
    $l("tagInput").value = normTag(start);
    load(start);
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();

})();
