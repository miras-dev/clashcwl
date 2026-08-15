/* Ranked / Legend battle-log analysis.
 *
 * Source: GET /players/{tag}/battlelog on the official CoC API. The endpoint is
 * live and returns 200 with a normal key, but it is NOT in the published Swagger
 * docs — so it is unversioned and could change without notice. Everything that
 * knows its shape lives in this file, so a break is a one-file fix.
 *
 * The log is a rolling buffer of roughly the last 50 battles of ALL types mixed
 * together (homeVillage, ranked, legend, …). It is not a time window: a very
 * active player's ranked history can fall off the end in under four days, while
 * a casual player's may reach back well over a week. Always read `windowStart`
 * / `windowEnd` on the result rather than assuming a period.
 *
 * The API returns `trophyChange: null` on every row, so the trophy delta is
 * derived from stars + destruction using the game's own formula. That formula is
 * ported from ClashPerk (MIT licensed), src/helper/legends.helper.ts —
 * https://github.com/clashperk/clashperk
 */

/* The pages load plain <script> tags, not ES modules, so this file defines a
   global and exports for Node (tests) at the bottom rather than using `export`. */
(function (root) {
"use strict";

/* Legend I players come back as battleType "legend"; Legend II/III and below as
   "ranked". Filtering on one alone silently drops whole tiers of players. */
const RANKED_BATTLE_TYPES = new Set(["ranked", "legend"]);

/* Trophy movement for a single battle, from stars and destruction.
 *
 * The attacker's gain is drawn from a 40-trophy pool. In Legend League the
 * defender loses exactly what the attacker took (except on a 0-star hold, which
 * costs nothing). Under Ranked the defender instead GAINS the remainder of the
 * pool — which is why a 3-star defense shows +0 and a 0-star hold shows +40. */
function calculateTrophies(stars, destruction, { isAttack, isLegendLeague }) {
  let attackerGain = 0;

  if (stars === 3) {
    attackerGain = 40;                                        // 3 stars takes the whole pool
  } else if (stars === 2) {
    attackerGain = 16 + Math.floor((destruction - 50) / 3);   // 16 base, +1 per 3% over 50
  } else if (stars === 1) {
    attackerGain = 5 + Math.floor((destruction - 1) / 9);     // 5 base, +1 per 9% over 1
  } else if (destruction >= 9) {
    attackerGain = 1 + Math.floor((destruction - 9) / 10);    // 1 base, +1 per 10% over 9
  }

  if (attackerGain > 40) attackerGain = 40;

  if (isAttack) return attackerGain;
  if (isLegendLeague) return stars === 0 ? 0 : -attackerGain;
  return stars === 0 ? 40 : 40 - attackerGain;
}

/* "20260815T032813.000Z" → Date. The API omits the separators ISO 8601 wants. */
function parseBattleTime(stamp) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/.exec(String(stamp || ""));
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
}

/* Ranked battles only, newest first, with the trophy delta filled in. */
function extractRankedBattles(battlelog) {
  const items = (battlelog && battlelog.items) || [];

  return items
    .filter((b) => RANKED_BATTLE_TYPES.has(b.battleType))
    .map((b) => {
      const isAttack = !!b.attack;
      const stars = Number(b.stars) || 0;
      const destruction = Number(b.destructionPercentage) || 0;
      return {
        isAttack,
        stars,
        destruction,
        isLegendLeague: b.battleType === "legend",
        trophyChange: calculateTrophies(stars, destruction, {
          isAttack,
          isLegendLeague: b.battleType === "legend",
        }),
        opponentName: b.opponentName || null,
        opponentTag: b.opponentPlayerTag || null,
        opponentTH: b.opponentTownHallLevel || null,
        timestamp: parseBattleTime(b.battleTimestamp),
      };
    })
    .sort((a, b) => (b.timestamp?.getTime() || 0) - (a.timestamp?.getTime() || 0));
}

/* Stored history (data/battles-<clan>.json, written by scripts/collect-battles.mjs)
 * back into the API's shape, so everything downstream stays unaware of where the
 * battles came from.
 *
 * The stored rows are deliberately terse — the file is committed and grows every
 * day — so this expands t/d/k/a/s/p back to the full field names. Opponent
 * details are not stored: they are not scored, and they would triple the file.
 */
function fromStoredRows(rows) {
  return {
    items: (rows || []).map((r) => ({
      battleType: r.k === "l" ? "legend" : "ranked",
      attack: !!r.a,
      stars: r.s,
      destructionPercentage: r.p,
      battleTimestamp: r.d,
    })),
  };
}

/* Group stored rows by player tag, ready for summariseRanked. */
function groupStoredByPlayer(stored) {
  const byTag = new Map();
  for (const r of (stored && stored.battles) || []) {
    if (!byTag.has(r.t)) byTag.set(r.t, []);
    byTag.get(r.t).push(r);
  }
  const out = new Map();
  for (const [tag, rows] of byTag) out.set(tag, fromStoredRows(rows));
  return out;
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/* Per-player summary of the ranked window.
 *
 * `attacks` is the number the player actually made — the eligibility signal that
 * matters. A player with zero attacks and many defenses is being farmed while
 * inactive, which reads very differently from a player who attacks and loses. */
function summariseRanked(battlelog) {
  const battles = extractRankedBattles(battlelog);
  const attacks = battles.filter((b) => b.isAttack);
  const defenses = battles.filter((b) => !b.isAttack);
  const times = battles.map((b) => b.timestamp).filter(Boolean);

  const attackGain = attacks.reduce((a, b) => a + b.trophyChange, 0);
  const defenseGain = defenses.reduce((a, b) => a + b.trophyChange, 0);

  const windowStart = times.length ? new Date(Math.min(...times)) : null;
  const windowEnd = times.length ? new Date(Math.max(...times)) : null;
  const windowDays = windowStart && windowEnd
    ? Math.max(1, (windowEnd - windowStart) / 86400000)
    : null;

  return {
    hasData: battles.length > 0,
    battles,
    attackCount: attacks.length,
    defenseCount: defenses.length,
    netTrophies: attackGain + defenseGain,
    attackTrophies: attackGain,
    defenseTrophies: defenseGain,
    avgAttackGain: mean(attacks.map((b) => b.trophyChange)),
    avgAttackStars: mean(attacks.map((b) => b.stars)),
    avgAttackDestruction: mean(attacks.map((b) => b.destruction)),
    avgDefenseHeld: mean(defenses.map((b) => b.trophyChange)),
    tripleRate: attacks.length
      ? attacks.filter((b) => b.stars === 3).length / attacks.length
      : null,
    windowStart,
    windowEnd,
    windowDays,
    // Attacks per day over the observed window. The buffer truncates the window
    // for active players, so this is a floor on real activity, not an exact rate.
    attacksPerDay: windowDays ? attacks.length / windowDays : null,
  };
}

const api = { calculateTrophies, parseBattleTime, extractRankedBattles, summariseRanked,
              fromStoredRows, groupStoredByPlayer };

root.BattleLog = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;

})(typeof globalThis !== "undefined" ? globalThis : this);
