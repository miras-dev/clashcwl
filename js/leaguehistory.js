/* Ranked League season history — GET /players/{tag}/leaguehistory.
 *
 * One row per completed season, which answers a question the battle log cannot:
 * has this player been reliable for months, or did they just wake up this week?
 * js/battlelog.js reads a rolling ~50-battle buffer — under four days for the
 * most active players — so it sees current form with no memory behind it.
 *
 * ONLY attack usage is read from this endpoint. The rest of the payload is
 * either broken or not comparable:
 *
 *   attackStars    0 in every season on every account observed. It is a dead
 *                  field, not a real zero, so there is no historical triple rate
 *                  to be had here. Deriving one from attackWins would be wrong —
 *                  a ranked "win" means out-starring the defender, which a two
 *                  star can do; it is not a triple.
 *   defenseStars   a season aggregate, not a per-defence record, so it cannot be
 *                  turned into a three-starred rate. js/battlelog.js measures
 *                  that properly from individual defences.
 *   trophies       no trophy cutoffs are published per tier, so these are only
 *   placement      comparable between players when leagueTierId matches. Across
 *                  tiers they are noise — see js/leaguetiers.js.
 *
 * That leaves attacks used ÷ attacks available, which is unambiguous, hard to
 * fake and directly predictive of the thing CWL punishes hardest: missed hits.
 */
(function (root) {
"use strict";

const LeagueTiers = root.LeagueTiers || (typeof require !== "undefined" ? require("./leaguetiers.js") : null);

/* Below this, a player has a track record of leaving attacks unused.
 *
 * Set at 85% because the failure it predicts is total — one missed CWL attack
 * costs up to three stars and cannot be made up. A player who used 85% of their
 * ranked attacks has still skipped roughly three per season. */
const RELIABLE_USAGE = 0.85;

/* Fewer seasons than this and the rate is too thin to lean on: a single season
   where someone was ill or travelling swings a two-season average by half. */
const MIN_SEASONS = 2;

/* How many recent seasons to read. Older ones describe a different player —
   account sold, roster changed, or simply a year of drift — and the endpoint
   returns them oldest-first, so the tail is the recent end. */
const SEASONS_READ = 6;

/* leagueSeasonId is a unix timestamp in seconds. */
function seasonDate(id) {
  return typeof id === "number" ? new Date(id * 1000) : null;
}

/* Attack usage across recent seasons, or null when there is nothing to read.
 *
 * `used / available` where used counts wins AND losses — a lost attack was still
 * an attack taken, and the question here is participation, not skill. */
function summariseSeasons(history, opts) {
  const options = opts || {};
  const limit = options.seasons || SEASONS_READ;

  const items = (history && history.items) || [];
  if (!items.length) return null;

  // The API returns oldest-first; take the recent tail.
  const recent = items.slice(-limit);

  let used = 0;
  let available = 0;
  const seasons = recent.map((s) => {
    const attacks = (s.attackWins || 0) + (s.attackLosses || 0);
    const max = s.maxBattles || 0;
    used += attacks;
    available += max;
    return {
      seasonId: s.leagueSeasonId,
      date: seasonDate(s.leagueSeasonId),
      attacksUsed: attacks,
      attacksAvailable: max,
      usage: max ? attacks / max : null,
      trophies: s.leagueTrophies || 0,
      placement: s.placement || null,
      tier: LeagueTiers ? LeagueTiers.resolve(s.leagueTierId) : null,
      tierId: s.leagueTierId || null,
    };
  });

  // Every season with maxBattles: 0 is a season the player sat out entirely, and
  // dividing by zero available attacks would report perfect reliability for
  // someone who did nothing at all.
  if (!available) {
    return {
      hasData: false, seasons, seasonCount: seasons.length,
      attacksUsed: 0, attacksAvailable: 0, usage: null,
      perfectSeasons: 0, reliable: null, thin: true,
    };
  }

  const usage = used / available;
  const perfectSeasons = seasons.filter((s) => s.usage === 1).length;
  // Under MIN_SEASONS the rate exists but should not carry weight on its own.
  const thin = seasons.length < MIN_SEASONS;

  return {
    hasData: true,
    seasons,
    seasonCount: seasons.length,
    attacksUsed: used,
    attacksAvailable: available,
    usage,
    perfectSeasons,
    // Null rather than false when thin: "not enough seasons to say" is a
    // different state from "demonstrably unreliable", and only the second one
    // should ever count against a player.
    reliable: thin ? null : usage >= RELIABLE_USAGE,
    thin,
  };
}

/* Group a batched /api/clan-leaguehistory response by player tag. */
function groupByPlayer(batch) {
  const map = new Map();
  ((batch && batch.members) || []).forEach((m) => {
    if (m && m.tag && m.history) map.set(m.tag, m.history);
  });
  return map;
}

const api = { summariseSeasons, groupByPlayer, seasonDate,
              RELIABLE_USAGE, MIN_SEASONS, SEASONS_READ };

root.LeagueHistory = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;

})(typeof globalThis !== "undefined" ? globalThis : this);
