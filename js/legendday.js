/* Legend days — one ranked day, split into the attacks and defences behind it.
 *
 * Ranked resets at 05:00 UTC, not at midnight, so a "day" here runs 05:00 →
 * 05:00 and a battle at 04:30 belongs to the day before. Every player in the
 * world resets at the same instant regardless of timezone, which is why the
 * boundary is fixed in UTC and never read from the local clock.
 *
 * The battles come from js/battlelog.js (GET /players/{tag}/battlelog), which
 * already derives each battle's trophy change — the API returns null for it.
 * This file only groups them and reconstructs where the trophy count stood.
 *
 * TROPHY RECONSTRUCTION. The API publishes no trophy history: it gives the
 * count right now and nothing else. So the day's start is walked backwards from
 * the live total — subtract everything that has happened since. That is exact
 * for the current day and for any complete day still inside the log's window,
 * and it drifts once the window cuts a day in half, which is why every day
 * carries a `complete` flag rather than pretending otherwise.
 *
 * The window is the log's own: roughly the last 50 battles of ALL types, so
 * three or four days for an active Legend account and a fortnight for a casual
 * one. A ranked season reset inside that window would also break the walk —
 * trophies are reset to a season floor, which is not a battle — so the oldest
 * days after a reset day are read with the same caution as an incomplete one.
 */
(function (root) {
"use strict";

const BattleLog = root.BattleLog || (typeof require !== "undefined" ? require("./battlelog.js") : null);

/* Ranked day boundary. 05:00 UTC every day, worldwide. */
const RESET_HOUR_UTC = 5;

/* What Legend League grants per day: eight attacks, and eight defences before
   the base stops being served to attackers. Below Legend the ranked ladder does
   not cap either, so the allowance only applies to legend days. */
const LEGEND_ATTACKS_PER_DAY = 8;
const LEGEND_DEFENSES_PER_DAY = 8;

const DAY_MS = 86400000;

/* The 05:00 UTC boundary at or before `date` — i.e. the start of the ranked day
   that instant falls in. */
function dayStartFor(date) {
  const t = new Date(date);
  const start = new Date(Date.UTC(
    t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), RESET_HOUR_UTC, 0, 0, 0));
  if (t.getTime() < start.getTime()) start.setTime(start.getTime() - DAY_MS);
  return start;
}

/* A day's stable id: the date it STARTED on in UTC. The day that opened at
   05:00 on the 14th is "2026-08-14" even though it ends on the 15th. */
function dayKey(date) {
  return dayStartFor(date).toISOString().slice(0, 10);
}

function keyToStart(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], RESET_HOUR_UTC, 0, 0, 0));
}

/* How far back the log itself reaches, counting battles of every type — a
   home-village raid is not a ranked battle but it does prove the log was still
   recording at that moment, which is what tells us a day is complete. */
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

/* Every ranked day in the log, newest first.
 *
 * `currentTrophies` is the live total from GET /players/{tag}. Without it the
 * days still carry their battles and net movement; they just cannot say what
 * the count actually read at either end, so those fields stay null rather than
 * being guessed at.
 */
function legendDays(battlelog, opts) {
  const options = opts || {};
  const battles = BattleLog.extractRankedBattles(battlelog);
  const logStart = logStartTime(battlelog);
  const now = options.now ? new Date(options.now) : new Date();

  const groups = new Map();
  for (const b of battles) {
    if (!b.timestamp) continue;
    const start = dayStartFor(b.timestamp);
    const key = start.toISOString().slice(0, 10);
    if (!groups.has(key)) groups.set(key, { key, start, battles: [] });
    groups.get(key).battles.push(b);
  }

  const days = [...groups.values()].sort((a, b) => b.start - a.start);

  // The walk starts at the live total and moves backwards a day at a time. No
  // ranked battle can sit after the newest day by construction, so the newest
  // day ends exactly where the player stands now.
  let running = Number.isFinite(options.currentTrophies) ? Number(options.currentTrophies) : null;

  return days.map((d) => {
    const attacks = d.battles.filter((b) => b.isAttack);
    const defenses = d.battles.filter((b) => !b.isAttack);
    const attackTrophies = attacks.reduce((a, b) => a + b.trophyChange, 0);
    const defenseTrophies = defenses.reduce((a, b) => a + b.trophyChange, 0);
    const net = attackTrophies + defenseTrophies;
    const end = new Date(d.start.getTime() + DAY_MS);
    // Legend I comes back as battleType "legend" and everything below it as
    // "ranked" — see js/battlelog.js. One legend battle in the day is enough:
    // the allowance is the account's, not the individual battle's.
    const isLegend = d.battles.some((b) => b.isLegendLeague);

    const endTrophies = running;
    const startTrophies = running === null ? null : running - net;
    running = startTrophies;

    return {
      key: d.key,
      start: d.start,
      end,
      battles: d.battles,
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
      isLegend,
      attacksAllowed: isLegend ? LEGEND_ATTACKS_PER_DAY : null,
      defensesAllowed: isLegend ? LEGEND_DEFENSES_PER_DAY : null,
      startTrophies,
      endTrophies,
      // The log reached back past this day's opening, so nothing inside it fell
      // off the buffer. An incomplete day is missing battles, not idle.
      complete: !!(logStart && logStart.getTime() <= d.start.getTime()),
      inProgress: now.getTime() < end.getTime() && now.getTime() >= d.start.getTime(),
    };
  });
}

/* The day a given key describes, or null when the log has nothing for it. */
function findDay(days, key) {
  return (days || []).find((d) => d.key === key) || null;
}

const api = {
  RESET_HOUR_UTC, LEGEND_ATTACKS_PER_DAY, LEGEND_DEFENSES_PER_DAY,
  dayStartFor, dayKey, keyToStart, logStartTime, legendDays, findDay,
};

root.LegendDay = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;

})(typeof globalThis !== "undefined" ? globalThis : this);
