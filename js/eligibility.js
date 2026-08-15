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
 * and the first is the more reliable one. */
function formScore(summary) {
  if (!summary || !summary.hasData) return null;

  const days = summary.windowDays || 1;
  const activity = clamp01((summary.attacksPerDay || 0) / TARGET_ATTACKS_PER_DAY);

  // No attacks means no quality signal — not zero quality. Defenses say nothing
  // about how someone attacks, so an inactive player scores on activity alone.
  if (!summary.attackCount) return activity * 0.6;

  const gain = clamp01((summary.avgAttackGain || 0) / MAX_ATTACK_GAIN);
  const triples = clamp01(summary.tripleRate || 0);

  return activity * 0.5 + gain * 0.35 + triples * 0.15;
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
  const form = formScore(summary);
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

  const reasons = [];
  if (form == null) reasons.push("No ranked battles in the log — scored on roster only");
  else if (confidence < 0.5) reasons.push("Thin battle log — form is a weak signal here");
  if (summary.hasData && !summary.attackCount) reasons.push("Attacked zero times this window");
  if (summary.attackCount && summary.avgAttackGain >= 38) reasons.push("Near-perfect attack average");
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

const api = { rosterScore, formScore, formConfidence, scoreMember, rankClan };

root.Eligibility = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;

})(typeof globalThis !== "undefined" ? globalThis : this);
