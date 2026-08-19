/* Legends Day — one player's ranked period, battle by battle.
 *
 * The CWL Helper already reads GET /players/{tag}/battlelog to score a roster's
 * ranked form; this page points the same endpoint at one account and answers a
 * different question: how is the current run going.
 *
 * WHICH RUN depends on the league, and the game keeps two clocks (see
 * js/legendday.js): Legend I plays legend DAYS — eight attacks, eight defences,
 * wiped at 05:00 UTC — while every tier below it is in the weekly Ranked pool,
 * Monday 05:00 UTC to Monday 05:00 UTC, on the league's own attack allowance.
 * The page reads the account's tier and follows whichever clock it is on.
 *
 * Three calls per player, all already proxied: /api/player for the live trophy
 * count and the league, /api/battlelog for the battles, and /api/leaguehistory
 * for the weekly allowance the game itself reports (`maxBattles`) plus the pool
 * placement of finished weeks. The history call is best-effort: without it the
 * page loses a denominator, not the report.
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
let view = { player: null, periods: [], selected: null, battlelog: null, history: null, cadence: "daily" };
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
function isWeekly(period) {
  return (period ? period.cadence : view.cadence) === window.LegendDay.WEEKLY;
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

/* Both clocks turn on 05:00 UTC, so a period is labelled by the UTC date it
   opened on. Using the local date would put half the world a day out. */
function dateLabel(start, { long = false } = {}) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC", weekday: long ? "long" : "short", day: "numeric",
    month: long ? "long" : "short",
  }).format(start);
}

/* "Friday, 14 August" for a day; "week of Monday, 10 August" for a week — the
   two are never the same span, so they must never read the same. */
function periodLabel(period, opts) {
  const label = dateLabel(period.start, opts);
  return isWeekly(period) ? `week of ${label}` : label;
}

/* Battle times are shown in the reader's own timezone — "10:09 PM" is only
   useful if it is the clock they were playing against. Inside a week the day
   matters as much as the hour, so weekly rows ask for the weekday too. */
function battleTime(date, withWeekday) {
  if (!date) return "—";
  const opts = { hour: "numeric", minute: "2-digit" };
  if (withWeekday) opts.weekday = "short";
  return new Intl.DateTimeFormat(undefined, opts).format(date);
}

/* A single instant, spelled out in the reader's own timezone — used where a
   date and a clock time appear together, so the two cannot disagree the way a
   UTC date beside a local time would. */
function momentLabel(date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
  }).format(date);
}

function leagueBadge(tier) {
  const t = window.LeagueTiers ? window.LeagueTiers.resolve(tier) : null;
  if (!t) return "";
  return `<span class="league-badge" title="${esc(t.name)} — rank ${t.rank} of 36">
    <img src="${esc(t.iconUrls.small)}" alt="" width="18" height="18" loading="lazy"
         onerror="this.style.display='none'"><span>${esc(t.name)}</span></span>`;
}

/* One line saying which clock this account is on and what it grants, so the
   numbers below are never read against the wrong rules. */
function cadenceNote(period) {
  if (!period) return "";
  if (!isWeekly(period)) {
    return `Legend I plays legend <strong>days</strong>: 8 attacks and 8 defenses, wiped at 05:00 UTC.`;
  }
  const allowed = period.attacksAllowed;
  return `Below Legend I the ladder is a weekly pool, Monday to Monday at 05:00 UTC`
    + (allowed
      ? `, and this league grants <strong>${allowed} attacks</strong> for the week.`
      : `, on an attack allowance set by the league.`);
}

/* ---------------- rendering ---------------- */

function battleRow(b, i, period, good) {
  const dir = b.trophyChange > 0 ? "up" : b.trophyChange < 0 ? "down" : "";
  return `<div class="ld-row">
    <span class="ld-i">${i + 1}</span>
    <span class="ld-when">${esc(battleTime(b.timestamp, isWeekly(period)))}</span>
    <span class="ld-vs">
      <span class="ld-name">${esc(b.opponentName || "Unknown")}</span>
      <span class="ld-res${good(b) ? " good" : ""}">${b.stars}★ · ${Math.round(b.destruction)}%</span>
    </span>
    <span class="ld-delta ${dir}">${signed(b.trophyChange)}</span>
  </div>`;
}

function battleList(title, list, total, cls, empty, period, good) {
  const dir = total > 0 ? "up" : total < 0 ? "down" : "";
  return `<div class="ld-list ${cls}">
    <div class="ld-list-head">
      <h3>${title}</h3>
      <span class="ld-sum ${dir}">${list.length} · ${signed(total)}</span>
    </div>
    ${list.length
      ? list.map((b, i) => battleRow(b, i, period, good)).join("")
      : `<p class="ld-empty">${empty}</p>`}
  </div>`;
}

function periodChips(periods, selectedKey) {
  const weekly = isWeekly(periods[0]);
  const now = weekly ? " · this week" : " · today";
  return `<div class="ld-days" role="group" aria-label="${weekly ? "Ranked weeks" : "Legend days"} in the log">
    ${periods.map((p) => `<button type="button" class="ld-day${p.key === selectedKey ? " is-on" : ""}"
      data-period="${esc(p.key)}" aria-pressed="${p.key === selectedKey}">
      <i>${weekly ? "wk " : ""}${esc(dateLabel(p.start))}${p.inProgress ? now : ""}</i>
      <b class="${p.net > 0 ? "up" : p.net < 0 ? "down" : ""}">${signed(p.net)}</b>
    </button>`).join("")}
  </div>`;
}

/* The four numbers the period is actually about.
 *
 * The start trophies are the only derived one: the API publishes no trophy
 * history, so it is the live count with everything since subtracted back off.
 * It is exact while the log still holds the whole period, which is what
 * `complete` tracks.
 *
 * A missing allowance prints the count alone. Defaulting to eight would be a
 * Legend I number applied to a league that never granted it. */
function tiles(period) {
  const weekly = isWeekly(period);
  const atkAvg = period.avgAttack === null ? "—" : signed(Math.round(period.avgAttack * 10) / 10);
  const defAvg = period.avgDefense === null ? "—" : signed(Math.round(period.avgDefense * 10) / 10);
  const netDir = period.net > 0 ? "up" : period.net < 0 ? "down" : "";
  const allowance = (used, allowed) => allowed ? `${used} / ${allowed}` : String(used);

  return `<div class="ld-tiles">
    <div class="ld-tile">
      <i>${weekly ? "Week start" : "Day start"}</i>
      <b>${period.startTrophies === null ? "—" : period.startTrophies}</b>
      <span>${period.endTrophies === null ? "trophies not available"
        : period.inProgress ? `Now ${period.endTrophies}` : `Ended ${period.endTrophies}`}</span>
    </div>
    <div class="ld-tile is-attack">
      <i>Attacks</i>
      <b>${allowance(period.attackCount, period.attacksAllowed)}</b>
      <span>${signed(period.attackTrophies)} · avg ${atkAvg}</span>
    </div>
    <div class="ld-tile is-defense">
      <i>Defenses</i>
      <b>${allowance(period.defenseCount, period.defensesAllowed)}</b>
      <span>${signed(period.defenseTrophies)} · avg ${defAvg}</span>
    </div>
    <div class="ld-tile is-net ${netDir}">
      <i>${period.inProgress ? "Net so far" : weekly ? "Full week net" : "Full day net"}</i>
      <b>${signed(period.net)}</b>
      <span>${period.attackCount + period.defenseCount} tracked battles</span>
    </div>
  </div>`;
}

/* The second rank of figures — true of the period, but not the headline. */
function statRail(period, season) {
  const bestHit = period.attacks.length ? Math.max(...period.attacks.map((b) => b.trophyChange)) : null;
  const worstDef = period.defenses.length ? Math.min(...period.defenses.map((b) => b.trophyChange)) : null;
  const stars = period.avgAttackStars === null ? "—" : (Math.round(period.avgAttackStars * 100) / 100).toFixed(2);

  const chip = (label, value) => `<div class="stat"><i>${label}</i><b>${value}</b></div>`;
  return `<div class="stat-rail">
    ${chip("Triples", `${period.triples} of ${period.attackCount || 0}`)}
    ${chip("Avg stars", stars)}
    ${chip("0★ holds", `${period.zeroStarHolds} of ${period.defenseCount || 0}`)}
    ${chip("Best hit", bestHit === null ? "—" : signed(bestHit))}
    ${chip("Worst defence", worstDef === null ? "—" : signed(worstDef))}
    ${season && season.placement
      // Only a FINISHED week has a placement: the weekly pool is 100 players in
      // the league, and where you land in it is what promotes or demotes you.
      ? chip("Pool finish", `${season.placement} of 100`)
      : ""}
  </div>`;
}

/* Anything the numbers above cannot be trusted to say on their own. */
function caveats(period, battlelog) {
  const weekly = isWeekly(period);
  const unit = weekly ? "week" : "day";
  const notes = [];

  if (!period.complete) {
    const from = window.LegendDay.logStartTime(battlelog);
    notes.push(`The game only keeps a rolling buffer of about 50 battles of every type, and it
      runs out ${from ? `at ${esc(momentLabel(from))}` : `inside this ${unit}`} —
      earlier battles in this ${unit} are gone, so the totals here are a floor, not the
      full ${unit}.`);
  }
  if (weekly && !period.attacksAllowed) {
    notes.push(`The attack allowance is set by the league and read from this account's own
      finished weeks; none of them were played in this league, so the counts above are
      shown without a total.`);
  }
  if (period.startTrophies !== null) {
    notes.push(`${weekly ? "Week" : "Day"} start is worked back from the live trophy count: the
      API publishes no trophy history, only where the account stands right now.`);
  }
  if (!notes.length) return "";
  return `<p class="muted small" style="margin-top:14px">${notes.join(" ")}</p>`;
}

function renderReport() {
  const out = $l("report");
  const { player, periods, selected, battlelog, history } = view;
  if (!player) { out.innerHTML = ""; return; }

  const weeklyAccount = view.cadence === window.LegendDay.WEEKLY;

  if (!periods.length) {
    out.innerHTML = `<div class="ld-report">
      <div class="ld-eyebrow">Ranked report</div>
      <div class="ld-top"><div class="ld-who-head">
        <h2>${esc(player.name)}</h2>
        <div class="ld-sub">${esc(player.tag)} · ${leagueBadge(player.leagueTier) || "no ranked league"}</div>
      </div></div>
      <p class="muted" style="margin-top:14px">
        No ranked or Legend battles in this account's recent battle log. The log mixes every
        battle type together and only holds about 50, so a player who mostly farms can push
        their ranked ${weeklyAccount ? "weeks" : "days"} off the end of it — check back after a
        run of ranked attacks.
      </p>
    </div>`;
    return;
  }

  const period = window.LegendDay.findPeriod(periods, selected) || periods[0];
  const season = window.LegendDay.seasonForPeriod(history, period);
  const weekly = isWeekly(period);

  out.innerHTML = `<div class="ld-report">
    <div class="ld-eyebrow">${weekly ? "Ranked week report" : "Legend day report"}</div>
    <div class="ld-top">
      <div class="ld-who-head">
        <h2>${esc(player.name)}</h2>
        <div class="ld-sub">${esc(player.tag)}
          · ${periodLabel(period, { long: true })}${period.inProgress ? (weekly ? " (this week)" : " (today)") : ""}
          ${player.leagueTier ? " · " + leagueBadge(player.leagueTier) : ""}</div>
      </div>
      <div class="ld-trophy">
        <i>Current trophies</i>
        <b>${Number.isFinite(player.trophies) ? player.trophies : "—"}</b>
      </div>
    </div>

    <p class="muted small" style="margin-top:10px">${cadenceNote(period)}</p>

    ${periodChips(periods, period.key)}
    ${tiles(period)}
    ${statRail(period, season)}

    <div class="ld-cols">
      ${battleList("Attacks", period.attacks, period.attackTrophies, "atk",
        `No attacks in this ${weekly ? "week" : "day"}.`, period, (b) => b.stars === 3)}
      ${battleList("Defenses", period.defenses, period.defenseTrophies, "def",
        `No defences on record for this ${weekly ? "week" : "day"}.`, period, (b) => b.stars === 0)}
    </div>

    ${caveats(period, battlelog)}
    <p class="muted small" style="margin-top:8px">
      ${weekly
        ? "Ranked weeks run Monday 05:00 UTC → Monday 05:00 UTC, so a battle on Monday morning still belongs to the week that is closing."
        : "Legend days run 05:00 → 05:00 UTC, so a battle just before the reset belongs to the day before."}
      Battle times are shown in your own timezone; newest first.
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
  setMsg("Loading ranked battles…");
  $l("loadBtn").disabled = true;

  try {
    // One round trip each, in parallel: the trophy count and league the period
    // is measured against, the battles it is built from, and the finished weeks
    // that carry this league's attack allowance. Only the history may fail
    // without sinking the report, so it is caught rather than awaited alongside.
    const [player, battlelog, history] = await Promise.all([
      apiGet("player", tag),
      apiGet("battlelog", tag),
      apiGet("leaguehistory", tag).catch(() => null),
    ]);

    // The league decides the clock; the battle types are the fallback for an
    // account the API returns no tier for.
    const cadence = window.LegendDay.cadenceForTier(player.leagueTier)
      || window.LegendDay.cadenceForBattles(battlelog)
      || window.LegendDay.WEEKLY;

    view.player = player;
    view.battlelog = battlelog;
    view.history = history;
    view.cadence = cadence;
    view.periods = window.LegendDay.rankedPeriods(battlelog, {
      cadence,
      currentTrophies: player.trophies,
      attacksAllowed: window.LegendDay.weeklyAllowance(history, player.leagueTier),
    });
    view.selected = view.periods.length ? view.periods[0].key : null;

    remember(player);
    const unit = cadence === window.LegendDay.WEEKLY ? "week" : "day";
    setMsg(view.periods.length
      ? `${view.periods.length} ranked ${unit}${view.periods.length === 1 ? "" : "s"} in the battle log.`
      : "No ranked battles in this player's log.");
    renderReport();

    // Deep-linkable: a report someone shares should open on the same player.
    setUrlTag(tag);

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

/* Lifted out of load() because the league history is called `history` there,
   which shadows window.history. */
function setUrlTag(tag) {
  window.history.replaceState(null, "", `?tag=${encodeURIComponent(tag.replace(/^#/, ""))}`);
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
    const btn = e.target.closest("[data-period]");
    if (!btn) return;
    view.selected = btn.dataset.period;
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
