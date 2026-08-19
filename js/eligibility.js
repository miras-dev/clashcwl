/* CWL eligibility scoring.
 *
 * Ranks clan members purely on FORM — what they have actually been doing in
 * Ranked, from js/battlelog.js: attacks used, trophies earned per attack, and
 * triple rate, each measured against their own league's par.
 *
 * Town Hall, hero levels and war stars are deliberately NOT scored. They reward
 * accumulation rather than current form, and they let a maxed account that sits
 * at a lower Town Hall farming war stars outrank someone who is genuinely
 * attacking now. What predicts a good CWL attack is recent attacking, not a
 * lifetime total.
 *
 * The cost of that choice is honest: a player with no readable battle log gets
 * no score at all. They are listed as unrated and sorted last, not judged on
 * potential we cannot see — picking them is a manual call.
 */
(function (root) {
"use strict";

// In the browser js/battlelog.js has already run and left a global; under Node
// (tests, and any future bot) it is required. Guarding on the global first keeps
// `require` from being evaluated in the browser at all.
const BattleLog = root.BattleLog || (typeof require !== "undefined" ? require("./battlelog.js") : null);
const summariseRanked = BattleLog.summariseRanked;

/* How much of the league's OWN attack allowance counts as full activity.
 *
 * The allowance is not the same everywhere, and until this was tier-aware the
 * scorer quietly punished everyone outside Legend I for a cap the game imposed
 * on them: it asked for 4 attacks a day, which only a Legend I account (8 a day)
 * can reach — a Legend III player who used every one of their 24 weekly attacks
 * averages 3.4 a day, and a Skeleton player granted 6 a week averages 0.9, which
 * scored barely a fifth of the activity mark however completely they played.
 *
 * Half is the bar because that is what the old flat target already asked of a
 * Legend I account (4 of 8 a day), so this generalises the existing calibration
 * rather than retuning it — Legend I scores exactly as before. */
const TARGET_ALLOWANCE_SHARE = 0.5;

/* Ranked attacks a league grants per WEEK.
 *
 * Legend I is the exception on the ladder: it still plays daily legend days at 8
 * attacks a day, which is 56 over a week. Every tier below it is scored over the
 * week itself and granted a fixed allowance that rises with the ladder — see
 * js/legendday.js, which reads each account's real number from the API.
 *
 * The anchors are Legend II 30 and Legend III 24 (the latter confirmed against
 * `maxBattles` on a real /leaguehistory response), 18 in the Electro range, and 6
 * in the Skeleton leagues. The rungs between the last two are interpolated, the
 * same way expectedAttackGain() interpolates its measured pars. Approximate in
 * the middle of the ladder, and far closer than assuming everyone gets eight. */
function weeklyAttackAllowance(rank) {
  if (rank == null) return 24;                        // unknown tier — assume mid-ladder
  if (rank >= 36) return 56;                          // Legend I — 8 a day, daily reset
  if (rank >= 35) return 30;                          // Legend II
  if (rank >= 34) return 24;                          // Legend III
  if (rank >= 31) return 18;                          // Electro 31-33
  if (rank <= 3) return 6;                            // Skeleton 1-3
  return Math.round(6 + ((rank - 3) / 28) * 12);      // interpolated between those two
}

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
const MAX_TIER_RANK = 36;                 // Legend I

/* The ladder itself lives in js/leaguetiers.js, generated from the game's own
   GET /leaguetiers — it owns the names, the ids and the badge icons, so this
   file does not carry a second copy that could drift from it. */
const LeagueTiers = root.LeagueTiers || (typeof require !== "undefined" ? require("./leaguetiers.js") : null);

/* Ladder position 0-36, or null when the tier is unknown. Accepts the numeric
   id, the tier name, a bare rank, or the API's `{ id, name }` object. */
function tierRank(leagueTier) {
  return LeagueTiers.rankOf(leagueTier);
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
  // Measured against the league's own allowance rather than a flat rate, so
  // playing a league out completely scores the same wherever it is on the ladder.
  const attacksPerWeek = (summary.attacksPerDay || 0) * 7;
  const activity = clamp01(attacksPerWeek / (weeklyAttackAllowance(rank) * TARGET_ALLOWANCE_SHARE));

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
 * Volume is the signal — how many attacks we actually observed. Window length is
 * NOT: the battle log is a fixed ~50-battle buffer, so the harder someone plays
 * the faster they fill it and the SHORTER their window gets. Two Legend I
 * players with 16 attacks each showed 1.9-day windows precisely because they are
 * the most active people in the clan, and treating that as weak evidence ranked
 * them 18th and 19th on the third- and fourth-best form in the roster.
 *
 * So confidence is driven by attacks seen. A short window only counts against a
 * player when it comes with few attacks — that is genuinely thin data rather
 * than a busy player outrunning the buffer.
 */
const CONFIDENT_ATTACKS = 10;

/* Season history deliberately does NOT feed this.
 *
 * Reliability (attacks used per season, see js/leaguehistory.js) is one API call
 * per player, so it is fetched lazily when a row is expanded — long after the
 * ranking has been computed. Wiring it in here would mean either fetching it for
 * every member on load, which is a third clan-wide fan-out to answer a question
 * most players are never asked, or having confidence mean different things
 * depending on which rows happen to have been clicked.
 *
 * So confidence stays a statement about the battle log alone, and reliability is
 * presented beside it as separate evidence for the human making the call. It
 * would not have belonged in `formScore` in any case: reliability is
 * accumulation, and this model scores current form. */
function formConfidence(summary) {
  if (!summary || !summary.hasData) return 0;

  const byAttacks = clamp01((summary.attackCount || 0) / CONFIDENT_ATTACKS);
  // Defenses are weaker evidence, and not the kind the word "presence" suggests:
  // they land on a base whether or not anyone is playing, so they say the
  // account is in the ranked pool and nothing more. That still means the log we
  // are reading is a real, populated one rather than a stub — which is what
  // confidence measures — so they can carry it part of the way, never all of it.
  const byPresence = clamp01((summary.attackCount + summary.defenseCount) / 20) * 0.7;

  return Math.max(byAttacks, byPresence);
}

/* A verdict and a written case for it.
 *
 * The score alone does not tell you whether to field someone: 55 might be a
 * strong Legend I attacker with only five attacks on record, or a Dragon League
 * player coasting well below par. Those want opposite decisions, so the verdict
 * names the decision and the rationale argues it in plain language.
 *
 *   yes   — field them, the record supports it
 *   maybe — plausible, but something is unresolved: too little data, or form
 *           that is real but middling
 *   no    — the record argues against it, or there is no record at all
 *
 * Written as sentences rather than tags because the interesting cases are the
 * ones needing a "because": a low score that is actually fine, or a high one
 * resting on three attacks. */
function explain({ player, summary, rank, par, score, form, confidence, rated, band, tripledAgainst, bandRelative }) {
  const league = player.leagueTier || "an unknown league";
  const atk = summary.attackCount;
  const avg = summary.avgAttackGain;
  const parts = [];

  // No battle log at all. Distinct from a player who has one showing nothing:
  // this is our blind spot, not their inactivity, and the wording has to keep
  // the two apart or an API failure reads as a lazy player.
  if (!rated) {
    return {
      verdict: "no",
      call: "unknown",
      rationale: `No ranked battles could be read for this player, so there is nothing to judge. `
        + `The game's API returns an error for some accounts — that is a gap on our side, not `
        + `evidence they are inactive. If you know they play, field them on your own judgement.`,
    };
  }

  /* A log that exists and shows no attacks.
   *
   * This used to read as the strongest negative we had — "online and being
   * farmed, just not hitting back", closing on the flat prediction that they
   * would skip their war attack too. Two things were wrong with that.
   *
   * Defences do not prove presence. They happen TO a base whether or not
   * anyone is playing, so a player on holiday all week collects them exactly
   * like a player who is sitting there refusing to attack. Reading them as
   * evidence of someone being online was simply incorrect.
   *
   * And a quiet window is an absence of evidence, not evidence of absence. The
   * commonest reason for it is the dullest one: they were away. The score
   * already reflects what we can see, so the words do not need to add a verdict
   * on the person on top of it — they need to say what was and was not observed
   * and hand the call back to whoever knows the player. */
  if (!atk) {
    const def = summary.defenseCount;
    return {
      verdict: "no",
      call: "quiet",
      rationale: `No ranked attacks in the last ${summary.windowDays.toFixed(1)} days`
        + (def ? `, though the base was attacked ${def} time${def === 1 ? "" : "s"} in that window — `
               + `defences land whether or not anyone is playing, so they say nothing either way. `
               : ". ")
        + `That is an absence of evidence rather than evidence against them: a week away from the `
        + `game looks exactly like this. Worth asking before you count them out.`,
    };
  }

  // How they are performing, relative to their own league rather than raw.
  const ratio = avg / par;
  if (ratio >= 1.02) {
    parts.push(`Averaging +${avg.toFixed(0)} a hit against a ${league} par of about +${par}, `
      + `so they are beating what that league normally yields`);
  } else if (ratio >= 0.95) {
    parts.push(`Averaging +${avg.toFixed(0)} a hit, right on par for ${league}`);
  } else {
    parts.push(`Averaging +${avg.toFixed(0)} a hit against a ${league} par of about +${par}, `
      + `so they are running below what that league normally yields`);
  }

  // Legend tiers carry modifiers that make identical attacks score lower, which
  // is exactly the context a raw average hides. Only worth saying when they are
  // holding their own — telling someone below par that their league is hard
  // reads as an excuse being made for them.
  if (ratio >= 0.95) {
    if (rank >= 36) {
      parts.push(`Legend I carries the harshest battle modifiers in the game — defences and `
        + `defending heroes are buffed while their own heroes are weakened — so those numbers `
        + `are worth more than the same figures lower down`);
    } else if (rank >= 35) {
      parts.push(`Legend II carries heavy battle modifiers, so the raw number understates it`);
    }
  }

  if (summary.tripleRate === 1 && atk >= 5) {
    parts.push(`Every single attack was a triple`);
  } else if (summary.tripleRate >= 0.6 && atk >= 5) {
    parts.push(`${Math.round(summary.tripleRate * 100)}% of their attacks were triples`);
  }

  // Why they sit in the band they do. Band 2 is the defensive core, so it is
  // the one place where the base matters more than the attacks.
  if (band === 1) {
    parts.push(bandRelative
      ? `${league} is the top of your clan's ladder, and climbing there takes sustained form — `
        + `a stronger claim on a slot than any single week of attacks`
      : `Reaching Legend I takes sustained form under the game's harshest modifiers, `
        + `which is a stronger claim on a slot than any single week of attacks`);
  } else if (band === 2) {
    parts.push(bandRelative
      ? `One of the strongest bases in your clan at ${league}, so they are part of the defensive `
        + `core — the point is a base the opposition cannot casually three-star`
      : `A maxed TH18 in ${league}, so they are part of the defensive core — the point `
        + `is a base the opposition cannot casually three-star`);
  }

  // Measured defensive record, where there is enough of it. This beats hero
  // levels as a signal: two players at a full hero roster measured 6% and 75%
  // three-starred, because layout decides it and only the outcome shows that.
  if (tripledAgainst != null) {
    const pct = Math.round(tripledAgainst * 100);
    if (tripledAgainst <= 0.3) {
      parts.push(`Their base holds up too — three-starred only ${pct}% of the time in ranked defences`);
    } else if (tripledAgainst >= 0.7) {
      parts.push(`Their base is soft though — three-starred ${pct}% of the time in ranked defences, `
        + `so they cost stars on defence even when they earn them on offence`);
    }
  }

  // Volume decides how much the above is worth, so it comes last and drives the
  // verdict more than the averages do.
  let verdict;
  if (confidence >= 0.8) {
    parts.push(`Across ${atk} attacks, that is a settled picture rather than a hot streak`);
    verdict = score >= 70 ? "yes" : score >= 45 ? "maybe" : "no";
  } else {
    parts.push(`Only ${atk} attack${atk === 1 ? "" : "s"} on record though, so treat this as `
      + `indicative rather than proven — one good or bad session would move it a long way`);
    // Below full confidence the score is already discounted for thin evidence,
    // so judging it against the same thresholds punishes the shortage twice.
    // Form is what they actually did; volume decides how far to trust it, and it
    // has had its say in the score. A player three-starring every attack is a
    // "maybe" on five hits, never a "no".
    verdict = form >= 0.6 ? "maybe" : "no";
  }

  const closing = verdict === "yes"
    ? " Worth a place in the roster."
    : verdict === "maybe"
      ? " Playable, but there are safer picks if you are short of slots."
      : " Hard to justify a slot on this record.";

  return { verdict, rationale: parts.join(". ") + "." + closing };
}

/* ---------------- selection priorities ----------------
 *
 * Form alone answers "who attacks well". It does not answer "who should fill the
 * roster", because CWL is also won by not being three-starred, and a bench of
 * excellent attackers on soft bases loses. Players are therefore bucketed into
 * priority bands and the roster is filled band by band, best form first inside
 * each:
 *
 *   1  Legend I — they got there by sustaining form under the harshest
 *      modifiers in the game, which is a stronger claim than any single week
 *      of attacks.
 *   2  Maxed TH18 in Legend II or III — the defensive core. The point is not
 *      their offence; it is that their bases are hard to three-star.
 *   3  Strong attackers in Legend II or III who are not maxed — form carries
 *      them even where the base does not.
 *   4  Everyone else, by form.
 *
 * The API exposes NO defensive building levels — no walls, no defence levels,
 * nothing that says "supercharged" — so band 2 uses hero sum as the maxing
 * proxy and, where we have enough defences on record, how often the player is
 * actually three-starred. The second signal is the better one: two players at
 * heroSum 480 measured 6% and 75% three-starred, because base layout matters
 * more than max level and only the outcome reveals it.
 */
const MAXED_TH = 18;
const MAXED_HERO_SUM = 470;      // ~480 is a full TH18 hero roster; allow one mid-upgrade
const LEGEND_III = 34;
const LEGEND_I = 36;

/* The bands above are written for a clan that reaches Legend. Applied literally
   to a TH11 clan whose best player is in Golem League, every single member
   falls to band 4 and the whole ranking says nothing — the bands stop being a
   priority order and become a constant.
 *
 * So the cutoffs are relative to the clan being ranked, not to the top of the
 * ladder. A clan that genuinely reaches Legend keeps the absolute thresholds,
 * because those tiers mean something specific and a Legend I player should not
 * be demoted for having strong clanmates. Below that the same shape is applied
 * to the clan's own spread: its top tier stands in for Legend I, one rung down
 * for Legend III, and "maxed" becomes "maxed for this clan" rather than TH18.
 *
 * Returns the thresholds scoreMember/priorityBand should use. */
function bandThresholds(players) {
  const ranks = (players || [])
    .map((p) => tierRank(p.leagueTier))
    .filter((r) => r != null);
  const ths = (players || []).map((p) => Number(p.thLevel) || 0).filter(Boolean);
  const heroSums = (players || []).map((p) => Number(p.heroSum) || 0).filter(Boolean);

  // Not enough to reason about — fall back to the absolute ladder.
  if (ranks.length < 4) {
    return { top: LEGEND_I, mid: LEGEND_III, maxedTh: MAXED_TH, maxedHeroSum: MAXED_HERO_SUM, relative: false };
  }

  const sorted = ranks.slice().sort((a, b) => b - a);
  const best = sorted[0];

  // A clan that actually reaches Legend is judged on the real thing.
  if (best >= LEGEND_I) {
    return { top: LEGEND_I, mid: LEGEND_III, maxedTh: MAXED_TH, maxedHeroSum: MAXED_HERO_SUM, relative: false };
  }

  // A clan sitting entirely in one tier has no ladder spread to divide on. Any
  // cutoff would put everyone in the same band, which carries no more
  // information than putting everyone in band 4 — so skip the tier split and
  // let form alone order them.
  if (best === sorted[sorted.length - 1]) {
    return { top: Infinity, mid: Infinity, maxedTh: Infinity, maxedHeroSum: Infinity, relative: true };
  }

  // Otherwise anchor on the clan's own top of ladder. Use the 90th percentile
  // rather than the single highest, so one outlier who climbed far above the
  // rest does not define a band only they can occupy.
  const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  const top = pct(sorted, 0.10);
  // One meaningful rung below the top band, floored so the two never collapse
  // into each other on a clan with a narrow spread.
  let mid = Math.min(top - 1, pct(sorted, 0.40));
  // When a clan is one or two players above a single flat tier, no cutoff can
  // split the tail — every candidate value either includes all of it or none.
  // Sweeping it into band 3 would label the whole clan "upper-tier attacker",
  // so drop the middle band entirely and let the tail sit in band 4 where it
  // belongs. Band 3 reappears as soon as there is real spread to divide.
  const lowest = sorted[sorted.length - 1];
  if (mid <= lowest) mid = top;

  const topTh = Math.max(...ths, 0);
  const sortedHeroes = heroSums.slice().sort((a, b) => b - a);
  // "Maxed for this clan" — the upper end of its own hero range, not TH18's.
  const maxedHeroSum = sortedHeroes.length ? pct(sortedHeroes, 0.25) : 0;

  return { top, mid: Math.max(mid, 0), maxedTh: topTh, maxedHeroSum, relative: true };
}

/* A maxed base only helps if its owner turns up. Without this floor, band 2
   fills on hero levels alone: four maxed players scoring 46-53 took slots from
   attackers scoring 93-96 who simply had not maxed their heroes. Priority
   decides the order, not whether someone has stopped playing. */
const BAND_MIN_SCORE = 60;

/* How often this player gets three-starred in Ranked, or null when too few
   defences are on record to say. Lower is better. */
function tripledAgainstRate(summary) {
  if (!summary || !summary.hasData) return null;
  const defs = summary.battles.filter((b) => !b.isAttack);
  if (defs.length < 6) return null;
  return defs.filter((b) => b.stars === 3).length / defs.length;
}

function priorityBand(player, summary, thresholds = null) {
  const t = thresholds || { top: LEGEND_I, mid: LEGEND_III, maxedTh: MAXED_TH, maxedHeroSum: MAXED_HERO_SUM };
  const rank = tierRank(player.leagueTier);
  const maxed = (player.thLevel || 0) >= t.maxedTh
    && (Number(player.heroSum) || 0) >= t.maxedHeroSum;

  // An unknown tier cannot claim a band it might not deserve.
  if (rank == null) return 4;
  if (rank >= t.top) return 1;
  if (maxed && rank >= t.mid) return 2;
  if (rank >= t.mid) return 3;
  return 4;
}

const BAND_LABEL = {
  1: "Legend I",
  2: "Maxed TH18 · defensive core",
  3: "Legend II/III attacker",
  4: "Everyone else",
};

/* The absolute labels name real tiers, which would be wrong on a clan that
   never reaches them. When the bands are relative, describe the role each band
   plays in this clan instead. */
const BAND_LABEL_RELATIVE = {
  1: "Top of your ladder",
  2: "Strongest bases · defensive core",
  3: "Upper-tier attacker",
  4: "Everyone else",
};

/* Score one member. `player` is a clan-deep player row; `battlelog` is the raw
   API response for that member, or null if the call failed. */
function scoreMember(player, battlelog, thresholds = null) {
  const summary = summariseRanked(battlelog);
  const rank = tierRank(player.leagueTier);
  const form = formScore(summary, player.leagueTier);
  const confidence = formConfidence(summary);

  // No battle log means no score. There is nothing to fall back on now that
  // Town Hall and war stars are out, and inventing a number from capability is
  // exactly what this model refuses to do — see the file header.
  const rated = form != null;

  // Thin evidence is discounted rather than trusted at face value: a player with
  // two attacks in one day should not sit above someone with sixteen over five,
  // even if those two went well. Never below half, so a real attacker with a
  // truncated window is not buried by a measurement limit.
  let score = rated ? form * (0.5 + 0.5 * confidence) * 100 : 0;

  const par = expectedAttackGain(rank);
  const band = priorityBand(player, summary, thresholds);
  const tripledAgainst = tripledAgainstRate(summary);
  const { verdict, rationale, call } = explain({
    player, summary, rank, par, score, form, confidence, rated, band, tripledAgainst,
    bandRelative: !!thresholds?.relative,
  });

  return {
    verdict,
    rationale,
    /* How to LABEL the verdict, where "Avoid" would be wrong.
     *
     * The verdict itself is unchanged — these players are still not in the
     * suggested roster, because nothing we can see says they should be. But
     * "Avoid" is a judgement on a person, and neither of the cases that carry a
     * `call` has earned one: an unreadable log is our failure, and a quiet
     * window is most often a holiday. Ranking is one thing to get right and
     * naming is another. */
    call: call || null,
    band,
    bandLabel: (thresholds?.relative ? BAND_LABEL_RELATIVE : BAND_LABEL)[band],
    bandRelative: !!thresholds?.relative,
    tripledAgainst,
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
    rated,
    formScore: form == null ? null : Math.round(form * 100),
    confidence,
    summary,
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

  // Bands are calibrated against this clan before anyone is scored, so a clan
  // that never reaches Legend still gets a real priority order.
  const thresholds = bandThresholds(players);

  const scored = (players || [])
    .map((p) => scoreMember(p, logsByTag.get(p.tag) || null, thresholds))
    // League first, then score within it. Everyone in Legend I comes before
    // everyone in Legend II, and so on down the ladder, because a player's tier
    // is the harder-won fact: score measures a few days of form, but reaching
    // Legend I took a season of it. Unknown tiers sort last among their score
    // peers rather than being treated as Unranked.
    //
    // Rated ahead of unrated breaks the remaining tie. A proven-idle player and
    // an unrated one both sit at 0, but they are not equivalent: one is a gap in
    // our data, the other is someone we watched decline to attack, so the
    // unrated player sorts above.
    .sort((a, b) =>
      ((b.tierRank ?? -1) - (a.tierRank ?? -1))
      || (b.score - a.score)
      || (Number(a.rated) - Number(b.rated)));

  scored.forEach((m, i) => { m.rank = i + 1; });

  // Suggested roster: filled band by band — every Legend I first, then the maxed
  // TH18 defensive core, then Legend II/III attackers — taking the best form
  // available inside each band. Picking purely on score would fill the roster
  // with whoever attacked most this week and leave the clan soft on defence.
  //
  // Priority only applies to players who are actually playing. A maxed base
  // helps nobody if its owner has stopped attacking, and without the floor band
  // 2 filled on hero levels alone: four players scoring 46-53 displaced
  // attackers scoring 93-96 whose only shortfall was unmaxed heroes. Below the
  // floor a player keeps their band for display but queues on form with
  // everyone else.
  //
  // Unrated players and those with no attacks at all are skipped entirely —
  // suggesting someone we know nothing about presents a gap as a judgement.
  const eligible = scored.filter((m) => m.rated && m.summary.attackCount > 0);
  const effectiveBand = (m) => (m.score >= BAND_MIN_SCORE ? m.band : 4);

  const byScore = eligible.slice().sort((a, b) => {
    const bandDiff = effectiveBand(a) - effectiveBand(b);
    if (bandDiff) return bandDiff;
    // Inside the defensive core, prefer the base that actually holds. Two
    // players with a full hero roster measured 6% and 75% three-starred, so
    // hero levels alone cannot separate them — the record can. Unmeasured
    // players sort between the two, not last.
    if (effectiveBand(a) === 2) {
      const held = (m) => (m.tripledAgainst == null ? 0.5 : m.tripledAgainst);
      const defDiff = held(a) - held(b);
      if (Math.abs(defDiff) > 0.15) return defDiff;
    }
    return b.score - a.score;
  });

  return {
    members: scored,
    suggested: byScore.slice(0, warSize).map((m) => m.tag),
    missingLogs: scored.filter((m) => !m.summary.hasData).length,
    unrated: scored.filter((m) => !m.rated).length,
  };
}

const api = { formScore, formConfidence, scoreMember, rankClan,
              tierRank, expectedAttackGain, tierBonus, weeklyAttackAllowance };

root.Eligibility = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;

})(typeof globalThis !== "undefined" ? globalThis : this);
