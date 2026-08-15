/* CWL eligibility scoring.
 *
 * Ranks clan members on how well they would perform in Clan War League. Two
 * kinds of evidence go in, and they are deliberately kept apart:
 *
 *   Form   — what the player has actually been doing in Ranked this week, from
 *            js/battlelog.js. Attacks used, trophies earned per attack, triples.
 *   Roster — what the player is capable of: Town Hall, heroes, war stars.
 *
 * Form is weighted higher because a maxed TH18 who never attacks is worth less
 * in CWL than an active TH16 who three-stars. But form is only trustworthy when
 * there is enough of it, so a player with a thin battle log leans on roster and
 * is flagged, never silently ranked low — see `confidence`.
 */
(function (root) {
"use strict";

// In the browser js/battlelog.js has already run and left a global; under Node
// (tests, and any future bot) it is required. Guarding on the global first keeps
// `require` from being evaluated in the browser at all.
const BattleLog = root.BattleLog || (typeof require !== "undefined" ? require("./battlelog.js") : null);
const summariseRanked = BattleLog.summariseRanked;

/* A full set of ranked attacks is 8/day. Over the buffer's typical 3-5 day
   window that is far more than anyone completes, so the rate is scored against
   a realistic target rather than the theoretical maximum. */
const TARGET_ATTACKS_PER_DAY = 4;

/* Trophies per attack tops out at 40 (a three-star takes the whole pool). */
const MAX_ATTACK_GAIN = 40;

/* ---------------- league difficulty ----------------
 *
 * A +38 average is not the same achievement in every league. Ranked applies
 * Battle Modifiers that scale with the tier: defences and defending heroes get
 * a damage and hitpoint buff while the attacker's heroes are penalised, so the
 * identical attack scores lower the higher you climb.
 * https://supercell.com/en/games/clashofclans/blog/news/balance-changes-4/
 *
 * Measured across one clan's 29 players with 3+ attacks each, the effect is
 * large and monotonic:
 *
 *   Dragon League 30    +38.7 avg   87% triples   99.2% destruction
 *   Electro League 33   +37.8       84%           98.1%
 *   Legend III          +36.8       75%           97.0%
 *   Legend II           +32.6       53%           91.8%
 *   Legend I            +28.1       13%           89.5%
 *
 * Triple rate collapsing 87% → 13% is the headline: the same player pushed up
 * the ladder produces far worse raw numbers. Scoring raw form therefore ranks
 * the strongest attackers LAST, which is precisely backwards for CWL, where
 * everyone attacks bases of their own size with no modifiers at all.
 *
 * So form is normalised against what its own tier typically yields, and a
 * separate bonus rewards competing high. The tier list is the game's own
 * ordering from GET /leaguetiers — 37 rungs, Unranked (0) to Legend I (36) —
 * and the id encodes the rank, so `id - 105000000` is the ladder position.
 */
const LEAGUE_TIER_BASE_ID = 105000000;
const MAX_TIER_RANK = 36;                 // Legend I

/* Name → rank, for the clan-deep rows that carry `leagueTier` as a string. */
const TIER_RANK_BY_NAME = (() => {
  const names = [
    "Unranked",
    "Skeleton League 1", "Skeleton League 2", "Skeleton League 3",
    "Barbarian League 4", "Barbarian League 5", "Barbarian League 6",
    "Archer League 7", "Archer League 8", "Archer League 9",
    "Wizard League 10", "Wizard League 11", "Wizard League 12",
    "Valkyrie League 13", "Valkyrie League 14", "Valkyrie League 15",
    "Witch League 16", "Witch League 17", "Witch League 18",
    "Golem League 19", "Golem League 20", "Golem League 21",
    "P.E.K.K.A League 22", "P.E.K.K.A League 23", "P.E.K.K.A League 24",
    "Titan League 25", "Titan League 26", "Titan League 27",
    "Dragon League 28", "Dragon League 29", "Dragon League 30",
    "Electro League 31", "Electro League 32", "Electro League 33",
    "Legend III", "Legend II", "Legend I",
  ];
  const map = new Map();
  names.forEach((n, i) => map.set(n.toLowerCase(), i));
  return map;
})();

/* Ladder position 0-36, or null when the tier is unknown. Accepts either the
   numeric id from the API or the tier name. */
function tierRank(leagueTier) {
  if (leagueTier == null) return null;
  if (typeof leagueTier === "object") {
    if (typeof leagueTier.id === "number") return leagueTier.id - LEAGUE_TIER_BASE_ID;
    leagueTier = leagueTier.name;
  }
  if (typeof leagueTier === "number") {
    return leagueTier > LEAGUE_TIER_BASE_ID ? leagueTier - LEAGUE_TIER_BASE_ID : leagueTier;
  }
  const rank = TIER_RANK_BY_NAME.get(String(leagueTier).toLowerCase().trim());
  return rank == null ? null : rank;
}

/* What a competent player's average attack is worth in this tier, in trophies.
 *
 * Interpolated from the measurements above: essentially the full 40 pool in the
 * unmodified leagues, easing down to ~28 in Legend I where the modifiers bite
 * hardest. Dividing a player's real average by this turns "+30 in Legend I" and
 * "+38 in Dragon League" into comparable numbers. */
function expectedAttackGain(rank) {
  if (rank == null) return 36;               // unknown tier — assume mid-ladder
  if (rank >= 36) return 28;                 // Legend I
  if (rank >= 35) return 33;                 // Legend II
  if (rank >= 34) return 37;                 // Legend III
  if (rank >= 31) return 38;                 // Electro 31-33
  return 39;                                 // Dragon and below: near-unmodified
}

/* Competing high is itself evidence of skill, independent of the raw numbers.
   Worth up to 1.0 at Legend I, scaling from Electro upward — below that the
   ladder mostly reflects time spent rather than ability. */
function tierBonus(rank) {
  if (rank == null) return 0;
  return clamp01((rank - 30) / (MAX_TIER_RANK - 30));
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

/* Capability, 0-1. Same shape as the clan-level roster model in cwl-group.js:
   TH is the backbone, heroes separate players inside a TH, war stars reward
   proven war experience. */
function rosterScore(player) {
  const th = clamp01(((Number(player.thLevel) || 0) - 9) / 9);     // TH9 → TH18
  const heroes = clamp01((Number(player.heroSum) || 0) / 380);
  const stars = clamp01((Number(player.warStars) || 0) / 1200);
  return th * 0.55 + heroes * 0.25 + stars * 0.20;
}

/* Recent ranked form, 0-1, or null when there is no battle log at all.
 *
 * Activity is how much of the expected attack load the player actually used;
 * quality is what they got for it. Both matter: 16 attacks at +20 each and 8 at
 * +40 earn the same trophies, but the second player is the better CWL attacker
 * and the first is the more reliable one.
 *
 * Quality is measured against what the player's own league typically yields, so
 * a Legend I attacker is not punished for the Battle Modifiers stacked against
 * them. Raw numbers alone would rank the clan's best attackers last. */
function formScore(summary, leagueTier) {
  if (!summary || !summary.hasData) return null;

  const rank = tierRank(leagueTier);
  const activity = clamp01((summary.attacksPerDay || 0) / TARGET_ATTACKS_PER_DAY);

  // No attacks means no quality signal — not zero quality. Defenses say nothing
  // about how someone attacks, so an inactive player scores on activity alone.
  if (!summary.attackCount) return activity * 0.6;

  // Relative to the tier's par, capped a little above 1 so beating par helps but
  // cannot run away with the score.
  const par = expectedAttackGain(rank);
  const gain = clamp01((summary.avgAttackGain || 0) / par / 1.05);

  // Triples are the sharpest tier signal — 87% in Dragon League against 13% in
  // Legend I — so they are judged against the tier's own rate too. Legend I par
  // is deliberately low: a triple there is exceptional, not routine.
  const tripleParByRank = rank == null ? 0.6 : rank >= 36 ? 0.2 : rank >= 35 ? 0.5 : rank >= 34 ? 0.7 : 0.85;
  const triples = clamp01((summary.tripleRate || 0) / tripleParByRank);

  const form = activity * 0.45 + gain * 0.30 + triples * 0.15;

  // Competing in a harder league is evidence in itself. Small, so it sharpens
  // ties between similar players rather than overriding actual performance.
  return clamp01(form + tierBonus(rank) * 0.10);
}

/* How much the form number can be trusted, 0-1.
 *
 * The battle log is a rolling buffer, so a short window or few attacks is a
 * measurement limitation rather than evidence about the player. Low confidence
 * shifts weight onto roster and surfaces a warning in the UI. */
function formConfidence(summary) {
  if (!summary || !summary.hasData) return 0;
  const byVolume = clamp01((summary.attackCount + summary.defenseCount) / 12);
  const byWindow = clamp01((summary.windowDays || 0) / 3);
  return Math.min(byVolume, byWindow);
}

/* Score one member. `player` is a clan-deep player row; `battlelog` is the raw
   API response for that member, or null if the call failed. */
function scoreMember(player, battlelog) {
  const summary = summariseRanked(battlelog);
  const roster = rosterScore(player);
  const rank = tierRank(player.leagueTier);
  const form = formScore(summary, player.leagueTier);
  const confidence = formConfidence(summary);

  // As confidence rises, form takes over — up to 65% of the final number, since
  // CWL is won by people who turn up, not by the biggest bases.
  //
  // Unproven players are held at a ceiling rather than scored on capability
  // alone. Otherwise a maxed TH18 with no battle log outranks every attacker in
  // the clan on potential we have no evidence for, which is precisely backwards
  // for picking a roster. The ceiling keeps them visible and pickable without
  // letting them displace people who have demonstrably been attacking.
  const UNPROVEN_CEILING = 0.80;
  const formWeight = form == null ? 0 : 0.65 * confidence;
  let score = form == null
    ? roster * UNPROVEN_CEILING
    : (form * formWeight + roster * (1 - formWeight));

  // Partial evidence is scaled the same way, in proportion to how thin it is.
  if (form != null && confidence < 1) {
    score *= UNPROVEN_CEILING + (1 - UNPROVEN_CEILING) * confidence;
  }
  score *= 100;

  const par = expectedAttackGain(rank);
  const reasons = [];
  if (form == null) reasons.push("No ranked battles in the log — scored on roster only");
  else if (confidence < 0.5) reasons.push("Thin battle log — form is a weak signal here");
  if (summary.hasData && !summary.attackCount) reasons.push("Attacked zero times this window");
  // Judged against the tier's par, so a +30 in Legend I reads as the strong
  // result it is and a +38 in an unmodified league is not flattered.
  if (summary.attackCount >= 3 && summary.avgAttackGain >= par * 1.02) {
    reasons.push(rank >= 34
      ? `Beating ${player.leagueTier} par (+${summary.avgAttackGain.toFixed(0)} vs ~${par})`
      : "Above par for their league");
  }
  if (rank >= 36) reasons.push("Legend I — the harshest battle modifiers in the game");
  else if (rank >= 35) reasons.push("Legend II — heavy battle modifiers");
  if (summary.tripleRate === 1 && summary.attackCount >= 5) reasons.push("Triples every attack");
  if ((Number(player.warStars) || 0) >= 1000) reasons.push("Deep war experience");
  if (player.warPreference === "out") reasons.push("War preference is OUT");

  return {
    tag: player.tag,
    name: player.name,
    thLevel: player.thLevel,
    heroSum: player.heroSum,
    warStars: player.warStars,
    warPreference: player.warPreference,
    leagueTier: player.leagueTier,
    tierRank: rank,
    expectedGain: par,
    score: Math.round(score),
    rosterScore: Math.round(roster * 100),
    formScore: form == null ? null : Math.round(form * 100),
    confidence,
    summary,
    reasons,
  };
}

/* Rank a whole clan.
 *
 * `players` comes from /api/clan-deep, `battlelogs` from /api/clan-battlelogs.
 * They are joined on tag rather than position — the two endpoints do not
 * guarantee the same member order, and a mismatch would attribute one player's
 * attacks to another. */
function rankClan(players, battlelogs, { warSize = 15 } = {}) {
  const logsByTag = new Map();
  for (const entry of battlelogs || []) logsByTag.set(entry.tag, entry.battlelog);

  const scored = (players || [])
    .map((p) => scoreMember(p, logsByTag.get(p.tag) || null))
    .sort((a, b) => b.score - a.score);

  scored.forEach((m, i) => { m.rank = i + 1; });

  return {
    members: scored,
    // Suggested roster: the top warSize who have not opted out of war.
    suggested: scored.filter((m) => m.warPreference !== "out").slice(0, warSize).map((m) => m.tag),
    missingLogs: scored.filter((m) => !m.summary.hasData).length,
  };
}

const api = { rosterScore, formScore, formConfidence, scoreMember, rankClan,
              tierRank, expectedAttackGain, tierBonus };

root.Eligibility = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;

})(typeof globalThis !== "undefined" ? globalThis : this);
