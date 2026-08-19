/* Ranked periods — one Legend day, or one Ranked week, split into the battles
 * behind it.
 *
 * THE GAME KEEPS TWO CLOCKS, and which one an account is on depends on its
 * league:
 *
 *   Legend I  — the classic legend day. Eight attacks and eight defences, and
 *               the slate is wiped every day at 05:00 UTC. These accounts come
 *               back from the battle log as battleType "legend".
 *   Everyone   — the weekly Ranked pool: 100 players in a league, ranked on what
 *   below      they earn over the WEEK, top promoted and bottom demoted. The
 *              week runs Monday 05:00 UTC → Monday 05:00 UTC, and the attack
 *              allowance is the league's, not a fixed eight: 6 a week in the
 *              Skeleton leagues, rising with the ladder (Legend III 24,
 *              Legend II 30). These come back as battleType "ranked".
 *
 * Both boundaries were read off the game rather than assumed. The 05:00 UTC
 * hour is the ranked reset; the Monday anchor and the seven-day length come from
 * `leagueSeasonId` on GET /players/{tag}/leaguehistory, whose values are exactly
 * 604,800 seconds apart and land on Monday 05:00 UTC. The allowance comes from
 * `maxBattles` on the same endpoint — the game's own number for that league —
 * so it stays right when Supercell retunes it, rather than from a table here.
 *
 * The battles come from js/battlelog.js (GET /players/{tag}/battlelog), which
 * already derives each battle's trophy change — the API returns null for it.
 * This file only groups them and reconstructs where the trophy count stood.
 *
 * TROPHY RECONSTRUCTION. The API publishes no trophy history: it gives the count
 * right now and nothing else. So a period's start is walked backwards from the
 * live total — subtract everything that has happened since. That is exact for
 * the current period and for any earlier one still wholly inside the log's
 * window, and it drifts once the window cuts a period in half, which is why
 * every period carries a `complete` flag rather than pretending otherwise.
 *
 * The window is the log's own: roughly the last 50 battles of ALL types. For a
 * Legend I account that is three or four days; for a weekly account it is often
 * less than the week it is being asked about, so `complete` matters more there.
 */
(function (root) {
"use strict";

const BattleLog = root.BattleLog || (typeof require !== "undefined" ? require("./battlelog.js") : null);
const LeagueTiers = root.LeagueTiers || (typeof require !== "undefined" ? require("./leaguetiers.js") : null);

/* Ranked resets at 05:00 UTC — the same hour for the daily and the weekly
   clock, worldwide. */
const RESET_HOUR_UTC = 5;

/* The ranked week opens on Monday. `getUTCDay()` numbering: 0 = Sunday. */
const WEEK_RESET_WEEKDAY = 1;

/* Legend I only: eight attacks and eight defences a day. Every other league is
   on the weekly allowance, which is the league's own and read from the API. */
const LEGEND_ATTACKS_PER_DAY = 8;
const LEGEND_DEFENSES_PER_DAY = 8;

/* Top of the 37-rung ladder — see js/leaguetiers.js. Legend I is the only tier
   still played as legend days. */
const LEGEND_ONE_RANK = 36;

const DAY_MS = 86400000;
const WEEK_MS = 7 * DAY_MS;

const DAILY = "daily";
const WEEKLY = "weekly";

/* The 05:00 UTC boundary at or before `date`. */
function dayStartFor(date) {
  const t = new Date(date);
  const start = new Date(Date.UTC(
    t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), RESET_HOUR_UTC, 0, 0, 0));
  if (t.getTime() < start.getTime()) start.setTime(start.getTime() - DAY_MS);
  return start;
}

/* The Monday 05:00 UTC boundary at or before `date`. Built off the daily
   boundary so a Monday 04:00 battle lands in the week that is still running,
   not the one about to open. */
function weekStartFor(date) {
  const start = dayStartFor(date);
  const back = (start.getUTCDay() - WEEK_RESET_WEEKDAY + 7) % 7;
  start.setTime(start.getTime() - back * DAY_MS);
  return start;
}

function periodStartFor(date, cadence) {
  return cadence === WEEKLY ? weekStartFor(date) : dayStartFor(date);
}

/* A period's stable id: the UTC date it STARTED on. A legend day that opened at
   05:00 on the 14th is "2026-08-14" even though it ends on the 15th, and a week
   is keyed by its Monday. */
function periodKey(date, cadence) {
  return periodStartFor(date, cadence).toISOString().slice(0, 10);
}

function keyToStart(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], RESET_HOUR_UTC, 0, 0, 0));
}

/* Which clock an account is on, from its league. Legend I plays legend days;
   every other tier is in the weekly pool. Null when the tier is unreadable —
   the caller can fall back to the battle types, which say the same thing. */
function cadenceForTier(tier) {
  const t = LeagueTiers ? LeagueTiers.resolve(tier) : null;
  if (!t) return null;
  return t.rank >= LEGEND_ONE_RANK ? DAILY : WEEKLY;
}

/* The same question answered from the log instead: Legend I battles come back
   as "legend", everything below as "ranked". Used when the player's tier is
   missing, and as the answer for an account with no tier at all. */
function cadenceForBattles(battlelog) {
  const items = (battlelog && battlelog.items) || [];
  if (items.some((b) => b.battleType === "legend")) return DAILY;
  if (items.some((b) => b.battleType === "ranked")) return WEEKLY;
  return null;
}

/* The account's weekly attack allowance, as the game itself reported it.
 *
 * GET /players/{tag}/leaguehistory carries `maxBattles` per completed week
 * alongside the tier it was played in. Only a week played in the SAME tier
 * answers for the current one — the allowance is the league's, so a Legend III
 * week says nothing about a Legend II week — and the most recent such week
 * wins. Null when the history has never seen this tier: a missing denominator
 * is honest, an invented one is not.
 *
 * Defences share the number. The lower leagues are described as "6 attacks and
 * defenses per week", and no account observed has taken more defences in a week
 * than `maxBattles`. */
function weeklyAllowance(history, tier) {
  const wanted = LeagueTiers ? LeagueTiers.resolve(tier) : null;
  const items = (history && history.items) || [];
  for (let i = items.length - 1; i >= 0; i--) {
    const s = items[i];
    const max = Number(s && s.maxBattles) || 0;
    if (!max) continue;
    if (wanted) {
      const seasonTier = LeagueTiers.resolve(s.leagueTierId);
      if (!seasonTier || seasonTier.rank !== wanted.rank) continue;
    }
    return max;
  }
  return null;
}

/* How far back the log itself reaches, counting battles of every type — a
   home-village raid is not a ranked battle but it does prove the log was still
   recording at that moment, which is what tells us a period is complete. */
function logStartTime(battlelog) {
  const times = ((battlelog && battlelog.items) || [])
    .map((b) => BattleLog.parseBattleTime(b.battleTimestamp))
    .filter(Boolean);
  return times.length ? new Date(Math.min(...times)) : null;
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/* Every ranked period in the log, newest first.
 *
 * Options:
 *   cadence          "daily" (Legend I) or "weekly" (everyone else). Defaults to
 *                    whatever the battle types say, so a caller that knows the
 *                    player's league should pass it.
 *   attacksAllowed   the weekly allowance from weeklyAllowance(). Ignored on the
 *                    daily clock, which is always eight.
 *   currentTrophies  the live total from GET /players/{tag}. Without it the
 *                    periods still carry their battles and net movement; they
 *                    just cannot say what the count read at either end, so those
 *                    fields stay null rather than being guessed at.
 */
function rankedPeriods(battlelog, opts) {
  const options = opts || {};
  const cadence = options.cadence === WEEKLY || options.cadence === DAILY
    ? options.cadence
    : (cadenceForBattles(battlelog) || DAILY);
  const battles = BattleLog.extractRankedBattles(battlelog);
  const logStart = logStartTime(battlelog);
  const now = options.now ? new Date(options.now) : new Date();
  const span = cadence === WEEKLY ? WEEK_MS : DAY_MS;

  const attacksAllowed = cadence === WEEKLY
    ? (Number.isFinite(options.attacksAllowed) ? Number(options.attacksAllowed) : null)
    : LEGEND_ATTACKS_PER_DAY;
  const defensesAllowed = cadence === WEEKLY
    ? attacksAllowed
    : LEGEND_DEFENSES_PER_DAY;

  const groups = new Map();
  for (const b of battles) {
    if (!b.timestamp) continue;
    const start = periodStartFor(b.timestamp, cadence);
    const key = start.toISOString().slice(0, 10);
    if (!groups.has(key)) groups.set(key, { key, start, battles: [] });
    groups.get(key).battles.push(b);
  }

  const periods = [...groups.values()].sort((a, b) => b.start - a.start);

  // The walk starts at the live total and moves backwards a period at a time.
  // No ranked battle can sit after the newest period by construction, so that
  // period ends exactly where the player stands now.
  let running = Number.isFinite(options.currentTrophies) ? Number(options.currentTrophies) : null;

  return periods.map((p) => {
    const attacks = p.battles.filter((b) => b.isAttack);
    const defenses = p.battles.filter((b) => !b.isAttack);
    const attackTrophies = attacks.reduce((a, b) => a + b.trophyChange, 0);
    const defenseTrophies = defenses.reduce((a, b) => a + b.trophyChange, 0);
    const net = attackTrophies + defenseTrophies;
    const end = new Date(p.start.getTime() + span);

    const endTrophies = running;
    const startTrophies = running === null ? null : running - net;
    running = startTrophies;

    return {
      key: p.key,
      cadence,
      start: p.start,
      end,
      battles: p.battles,
      attacks,
      defenses,
      attackCount: attacks.length,
      defenseCount: defenses.length,
      attackTrophies,
      defenseTrophies,
      net,
      avgAttack: mean(attacks.map((b) => b.trophyChange)),
      avgDefense: mean(defenses.map((b) => b.trophyChange)),
      avgAttackStars: mean(attacks.map((b) => b.stars)),
      triples: attacks.filter((b) => b.stars === 3).length,
      // A defence held at zero stars costs nothing in Legend and pays the full
      // pool below it — either way it is the base doing its job, and it is the
      // one defensive result worth counting on its own.
      zeroStarHolds: defenses.filter((b) => b.stars === 0).length,
      attacksAllowed,
      defensesAllowed,
      startTrophies,
      endTrophies,
      // The log reached back past this period's opening, so nothing inside it
      // fell off the buffer. An incomplete period is missing battles, not idle.
      complete: !!(logStart && logStart.getTime() <= p.start.getTime()),
      inProgress: now.getTime() < end.getTime() && now.getTime() >= p.start.getTime(),
    };
  });
}

/* The period a given key describes, or null when the log has nothing for it. */
function findPeriod(periods, key) {
  return (periods || []).find((p) => p.key === key) || null;
}

/* The completed-week row from GET /players/{tag}/leaguehistory that belongs to
   a weekly period, matched on the season's own start. `leagueSeasonId` is a
   unix timestamp at Monday 05:00 UTC — the same instant the week opens here. */
function seasonForPeriod(history, period) {
  if (!period || period.cadence !== WEEKLY) return null;
  const items = (history && history.items) || [];
  return items.find((s) => typeof s.leagueSeasonId === "number"
    && s.leagueSeasonId * 1000 === period.start.getTime()) || null;
}

const api = {
  RESET_HOUR_UTC, WEEK_RESET_WEEKDAY, DAILY, WEEKLY,
  LEGEND_ATTACKS_PER_DAY, LEGEND_DEFENSES_PER_DAY, LEGEND_ONE_RANK,
  dayStartFor, weekStartFor, periodStartFor, periodKey, keyToStart,
  cadenceForTier, cadenceForBattles, weeklyAllowance,
  logStartTime, rankedPeriods, findPeriod, seasonForPeriod,
};

root.LegendDay = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;

})(typeof globalThis !== "undefined" ? globalThis : this);
