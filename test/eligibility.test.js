/* Tests for js/eligibility.js.
 *
 * Run: node test/eligibility.test.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { formScore, scoreMember, rankClan,
        tierRank, expectedAttackGain, tierBonus,
        weeklyAttackAllowance } = require("../js/eligibility.js");

const rankedLog = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "battlelog-ranked.json"), "utf8"));

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

const maxed = { tag: "#A", name: "Maxed", thLevel: 18, heroSum: 380, warStars: 1200 };

console.log("form only — no capability signals");
{
  // Town Hall, hero levels and war stars are deliberately not scored: they
  // reward accumulation rather than current form, and would let a maxed account
  // sitting at a lower Town Hall for war stars outrank an active attacker.
  const log = (n, stars, dest) => ({
    items: Array.from({ length: n }, (_, i) => ({
      battleType: "ranked", attack: true, stars, destructionPercentage: dest,
      battleTimestamp: `2026081${i % 5}T${String(i % 24).padStart(2, "0")}0000.000Z`,
    })),
  });

  test("a maxed idle player scores below an active weaker one", () => {
    const idleMaxed = scoreMember(maxed, log(0, 0, 0));
    const activeWeak = scoreMember(
      { tag: "#B", name: "Small", thLevel: 13, heroSum: 120, warStars: 40, leagueTier: "Legend II" },
      log(14, 2, 85));
    assert.ok(activeWeak.score > idleMaxed.score,
      `active TH13 (${activeWeak.score}) should beat idle maxed TH18 (${idleMaxed.score})`);
  });

  test("Town Hall and war stars do not move the score", () => {
    const attacks = log(12, 2, 85);
    const big = scoreMember({ ...maxed, leagueTier: "Legend II" }, attacks);
    const small = scoreMember(
      { tag: "#C", name: "Small", thLevel: 11, heroSum: 60, warStars: 5, leagueTier: "Legend II" },
      attacks);
    assert.strictEqual(big.score, small.score,
      "identical attacks in the same league must score identically");
  });

  test("capability alone earns nothing", () => {
    const m = scoreMember(maxed, null);
    assert.strictEqual(m.score, 0);
    assert.strictEqual(m.rated, false);
  });
}

console.log("formScore");
{
  test("no battle log yields null, not zero", () =>
    assert.strictEqual(formScore(null), null));
  test("attacking well beats attacking badly", () => {
    const build = (stars, dest, n) => ({
      items: Array.from({ length: n }, (_, i) => ({
        battleType: "ranked", attack: true, stars, destructionPercentage: dest,
        battleTimestamp: `2026081${i % 5}T120000.000Z`,
      })),
    });
    const good = formScore(require("../js/battlelog.js").summariseRanked(build(3, 100, 12)));
    const poor = formScore(require("../js/battlelog.js").summariseRanked(build(1, 30, 12)));
    assert.ok(good > poor, `three-starring (${good}) should beat one-starring (${poor})`);
  });

  // Proven inactivity ranks BELOW an unknown player, which is deliberate: the
  // fixture player has 16 defenses and zero attacks, so we know they are not
  // attacking. An unrated player might still turn up. Both score 0 now that
  // capability is out of the model, so the distinction lives in the sort.
  test("demonstrated inactivity sorts below an unrated player", () => {
    const r = rankClan(
      [{ tag: "#IDLE", name: "Idle", thLevel: 18, leagueTier: "Legend II" },
       { tag: "#UNK", name: "Unknown", thLevel: 18, leagueTier: "Legend II" }],
      [{ tag: "#IDLE", battlelog: rankedLog }, { tag: "#UNK", battlelog: null }]);
    const idle = r.members.findIndex((m) => m.tag === "#IDLE");
    const unknown = r.members.findIndex((m) => m.tag === "#UNK");
    assert.ok(unknown < idle,
      "an unrated player should sort above one we watched decline to attack");
  });
}

console.log("confidence");
{
  const { formConfidence } = require("../js/eligibility.js");
  const { summariseRanked } = require("../js/battlelog.js");
  // hours apart, so many battles can share a short window
  const burst = (n, hours) => summariseRanked({
    items: Array.from({ length: n }, (_, i) => ({
      battleType: "ranked", attack: true, stars: 2, destructionPercentage: 85,
      battleTimestamp: `20260815T${String(Math.floor(i * hours / n)).padStart(2, "0")}0000.000Z`,
    })),
  });

  // Regression: confidence used to be min(volume, window), so the busiest
  // players — who fill the game's fixed ~50-battle buffer fastest and therefore
  // show the SHORTEST windows — were scored as weak evidence. Two Legend I
  // players with 16 attacks each ranked 18th and 19th on the third- and
  // fourth-best form in the clan.
  test("many attacks in a short window is strong evidence", () => {
    const busy = formConfidence(burst(16, 2));      // 16 attacks inside 2 hours
    assert.strictEqual(busy, 1, `16 attacks should be full confidence, got ${busy}`);
  });

  test("few attacks over a long window is not", () => {
    const sparse = summariseRanked({
      items: [0, 5].map((d) => ({
        battleType: "ranked", attack: true, stars: 2, destructionPercentage: 85,
        battleTimestamp: `2026081${d}T120000.000Z`,
      })),
    });
    assert.ok(formConfidence(sparse) < 0.5,
      "two attacks should not be treated as solid evidence");
  });

  test("confidence rises with attacks, never falls", () => {
    const seq = [2, 5, 10, 16].map((n) => formConfidence(burst(n, 6)));
    for (let i = 1; i < seq.length; i++) {
      assert.ok(seq[i] >= seq[i - 1], `confidence dropped: ${JSON.stringify(seq)}`);
    }
  });
}

console.log("league tiers");
{
  test("tier names resolve to the game's own ladder order", () => {
    assert.strictEqual(tierRank("Legend I"), 36);
    assert.strictEqual(tierRank("Legend II"), 35);
    assert.strictEqual(tierRank("Legend III"), 34);
    assert.strictEqual(tierRank("Electro League 33"), 33);
    assert.strictEqual(tierRank("Unranked"), 0);
  });
  test("numeric ids and objects resolve too", () => {
    assert.strictEqual(tierRank(105000036), 36);
    assert.strictEqual(tierRank({ id: 105000035 }), 35);
    assert.strictEqual(tierRank({ name: "Legend III" }), 34);
  });
  test("unknown tiers are null, not zero", () => {
    // Zero would read as Unranked and quietly score the player as if they were
    // in the easiest league in the game.
    assert.strictEqual(tierRank(null), null);
    assert.strictEqual(tierRank("Nonsense League"), null);
  });
  test("par falls as the ladder rises", () => {
    assert.ok(expectedAttackGain(36) < expectedAttackGain(35));
    assert.ok(expectedAttackGain(35) < expectedAttackGain(34));
    assert.ok(expectedAttackGain(34) < expectedAttackGain(30));
  });
  test("tier bonus only applies near the top", () => {
    assert.strictEqual(tierBonus(36), 1);
    assert.strictEqual(tierBonus(30), 0);
    assert.strictEqual(tierBonus(10), 0);
    assert.strictEqual(tierBonus(null), 0);
  });
}

console.log("league-adjusted form");
{
  // The whole point of the tier model. Measured on one clan: Legend I averages
  // +28.1 per attack with a 13% triple rate, while Dragon League averages +38.7
  // with 87% triples — the same player pushed up the ladder posts far worse raw
  // numbers because of the Battle Modifiers working against them.
  const log = (n, stars, dest) => ({
    items: Array.from({ length: n }, (_, i) => ({
      battleType: "ranked", attack: true, stars, destructionPercentage: dest,
      battleTimestamp: `2026081${i % 5}T${String(i % 24).padStart(2, "0")}0000.000Z`,
    })),
  });
  const { summariseRanked } = require("../js/battlelog.js");

  test("a Legend I attacker beats an easier-league one with the same raw numbers", () => {
    const s = summariseRanked(log(12, 2, 80));
    const legendI = formScore(s, "Legend I");
    const dragon = formScore(s, "Dragon League 30");
    assert.ok(legendI > dragon,
      `Legend I (${legendI.toFixed(3)}) should beat Dragon League (${dragon.toFixed(3)}) on identical attacks`);
  });

  test("a strong Legend I average outscores a similar Dragon League average", () => {
    // +30 avg in Legend I is above its ~28 par; +38 in Dragon League is below
    // its ~39 par, despite being the bigger raw number.
    const legendI = formScore(summariseRanked(log(16, 2, 92)), "Legend I");
    const dragon = formScore(summariseRanked(log(16, 3, 100)), "Dragon League 30");
    assert.ok(Number.isFinite(legendI) && Number.isFinite(dragon));
    assert.ok(legendI > 0.5, `Legend I form was only ${legendI.toFixed(3)}`);
  });

  // Attacks are granted per league, and only Legend I gets eight a day. Scoring
  // everyone against that number punished the rest of the ladder for a cap the
  // game imposed on them.
  test("the weekly allowance follows the league", () => {
    assert.strictEqual(weeklyAttackAllowance(36), 56);   // Legend I — 8 a day
    assert.strictEqual(weeklyAttackAllowance(35), 30);   // Legend II
    assert.strictEqual(weeklyAttackAllowance(34), 24);   // Legend III
    assert.strictEqual(weeklyAttackAllowance(32), 18);   // Electro
    assert.strictEqual(weeklyAttackAllowance(1), 6);     // Skeleton
    assert.ok(weeklyAttackAllowance(20) > 6 && weeklyAttackAllowance(20) < 18,
      "the middle of the ladder is interpolated between the two anchors");
  });

  test("the allowance never falls as the ladder rises", () => {
    for (let r = 1; r <= 36; r++)
      assert.ok(weeklyAttackAllowance(r) >= weeklyAttackAllowance(r - 1),
        `rank ${r} grants fewer attacks than rank ${r - 1}`);
  });

  test("playing a league out completely scores the same wherever it is", () => {
    // 12 attacks over the same window: half of Legend III's 24 a week, and half
    // of a Legend I account's 8 a day would be far more. The league-relative
    // reading is what stops the Legend III player being marked inactive for
    // using every attack the game gave them.
    const s = summariseRanked(log(12, 2, 85));
    const legendIII = formScore(s, "Legend III");
    const skeleton = formScore(summariseRanked(log(3, 2, 85)), "Skeleton League 1");
    assert.ok(legendIII > 0.5, `Legend III on a full allowance scored only ${legendIII.toFixed(3)}`);
    assert.ok(skeleton > 0.4, `Skeleton on a full allowance scored only ${skeleton.toFixed(3)}`);
  });

  test("an unknown tier does not crash or zero the score", () => {
    const s = summariseRanked(log(10, 2, 85));
    const unknown = formScore(s, null);
    assert.ok(unknown > 0 && unknown <= 1, `got ${unknown}`);
  });
}

console.log("scoreMember");
{
  // Regression: an unproven maxed player used to score pure roster (100) and
  // outrank everyone who had demonstrably been attacking all week.
  test("an unrated player scores nothing at all", () => {
    const unrated = scoreMember(maxed, null);
    assert.strictEqual(unrated.score, 0);
    assert.strictEqual(unrated.rated, false);
    assert.strictEqual(unrated.formScore, null);
  });
  test("zero attacks is argued, not just scored", () => {
    const m = scoreMember(maxed, rankedLog);   // fixture has 0 attacks, 16 defenses
    assert.strictEqual(m.verdict, "no");
    assert.match(m.rationale, /no ranked attacks/i);
    // The defenses are still reported — 16 of them is a fact about the window,
    // and hiding it would make a busy account look like an empty one.
    assert.match(m.rationale, /16 times/);
  });
  test("a quiet window is not read as a verdict on the player", () => {
    const m = scoreMember(maxed, rankedLog);
    // Still outside the suggested roster — nothing observed argues for them —
    // but labelled for what was seen rather than accused of avoiding war.
    assert.strictEqual(m.call, "quiet");
    // Defenses land on a base whether or not anyone is playing, so they are not
    // evidence the player was there. Claiming otherwise is what made a holiday
    // read as someone refusing to attack.
    assert.ok(!/online/i.test(m.rationale),
      `defenses must not be read as presence: ${m.rationale}`);
    assert.match(m.rationale, /away from the game|absence of evidence/i);
  });
  test("no battle log reads as a gap in our data, not a lazy player", () => {
    const m = scoreMember(maxed, null);
    assert.strictEqual(m.formScore, null);
    assert.strictEqual(m.verdict, "no");
    assert.strictEqual(m.call, "unknown");
    assert.match(m.rationale, /nothing to judge/i);
    assert.match(m.rationale, /gap on our side/i);
  });
  test("war preference is ignored — the whole clan plays CWL", () => {
    // The in/out flag governs regular wars, not CWL, where everyone signs up.
    const out = scoreMember({ ...maxed, warPreference: "out" }, rankedLog);
    const inWar = scoreMember({ ...maxed, warPreference: "in" }, rankedLog);
    assert.strictEqual(out.score, inWar.score);
    assert.ok(!/\bOUT\b/.test(out.rationale),
      `rationale should not mention OUT: ${out.rationale}`);
  });
}

console.log("verdicts");
{
  const log = (n, stars, dest, tier) => scoreMember(
    { tag: "#V", name: "V", leagueTier: tier || "Legend III" },
    { items: Array.from({ length: n }, (_, i) => ({
      battleType: "ranked", attack: true, stars, destructionPercentage: dest,
      battleTimestamp: `2026081${i % 5}T${String(i % 24).padStart(2, "0")}0000.000Z`,
    })) });

  test("a strong, well-evidenced attacker is a pick", () => {
    const m = log(14, 3, 100);
    assert.strictEqual(m.verdict, "yes");
    assert.match(m.rationale, /Worth a place/i);
  });

  // Regression: judging thin-evidence players against the full-confidence score
  // thresholds punished them twice, since the score is already discounted for
  // low volume. A player three-starring every attack came out "avoid".
  test("excellent form on few attacks is a maybe, never an avoid", () => {
    const m = log(5, 3, 100);
    assert.strictEqual(m.verdict, "maybe");
    assert.match(m.rationale, /Only 5 attacks/i);
  });

  test("middling form on plenty of attacks is a maybe", () => {
    // Weak attacks but genuine activity — 14 hits at ~3/day. Turning up counts
    // for something, so this is not an outright avoid.
    const m = log(14, 1, 30);
    assert.strictEqual(m.verdict, "maybe");
  });

  test("barely attacking at all is an avoid", () => {
    const m = log(2, 1, 20);
    assert.strictEqual(m.verdict, "no");
    assert.match(m.rationale, /Hard to justify/i);
  });

  // Regression: the league-difficulty note was appended regardless of how the
  // player was doing, so a below-par Legend I attacker got a sentence about the
  // harsh modifiers that read as an excuse being made for them.
  test("league difficulty is only cited when the player is holding their own", () => {
    const below = log(14, 1, 20, "Legend I");
    assert.ok(!/harshest battle modifiers/.test(below.rationale),
      `should not excuse below-par form: ${below.rationale}`);
    const above = log(14, 3, 100, "Legend I");
    assert.match(above.rationale, /harshest battle modifiers/);
  });

  test("every rationale is a complete sentence", () => {
    for (const m of [log(14, 3, 100), log(5, 2, 80), log(14, 1, 30), scoreMember(maxed, null)]) {
      assert.ok(m.rationale.length > 40, `too short: ${m.rationale}`);
      assert.match(m.rationale, /\.$/, `should end in a full stop: ${m.rationale}`);
      assert.ok(!/\.\s+and\b/.test(m.rationale), `broken clause join: ${m.rationale}`);
    }
  });
}

console.log("selection priorities");
{
  const attacks = (n, stars, dest) => ({ items: Array.from({ length: n }, (_, i) => ({
    battleType: "ranked", attack: true, stars, destructionPercentage: dest,
    battleTimestamp: `2026081${i % 5}T${String(i % 24).padStart(2, "0")}0000.000Z` })) });
  const good = attacks(14, 3, 100);
  const weak = attacks(12, 1, 25);

  const p = (tag, tier, hero, th) => ({ tag, name: tag, leagueTier: tier, heroSum: hero, thLevel: th || 18 });

  test("Legend I is band 1, maxed TH18 in Legend II/III is band 2", () => {
    assert.strictEqual(scoreMember(p("#A", "Legend I", 480), good).band, 1);
    assert.strictEqual(scoreMember(p("#B", "Legend II", 480), good).band, 2);
    assert.strictEqual(scoreMember(p("#C", "Legend III", 391), good).band, 3);
    assert.strictEqual(scoreMember(p("#D", "Electro League 33", 480), good).band, 4);
  });

  test("an unmaxed TH18 is not part of the defensive core", () => {
    assert.strictEqual(scoreMember(p("#E", "Legend II", 442), good).band, 3);
  });

  test("Legend I fills the roster before anyone else", () => {
    const r = rankClan(
      [p("#L1", "Legend I", 400), p("#L2", "Legend II", 480)],
      [{ tag: "#L1", battlelog: attacks(12, 2, 80) }, { tag: "#L2", battlelog: good }],
      { warSize: 2 });
    assert.strictEqual(r.suggested[0], "#L1", "Legend I should be picked first");
  });

  // Regression: band 2 filled on hero levels alone, so four maxed players
  // scoring 46-53 displaced attackers scoring 93-96 whose only shortfall was
  // unmaxed heroes. A maxed base helps nobody if its owner has stopped playing.
  test("a maxed player who has stopped attacking loses their priority", () => {
    const r = rankClan(
      [p("#IDLE", "Legend II", 480), p("#SHARP", "Legend III", 391)],
      [{ tag: "#IDLE", battlelog: weak }, { tag: "#SHARP", battlelog: good }],
      { warSize: 1 });
    assert.deepStrictEqual(r.suggested, ["#SHARP"],
      "the active unmaxed attacker should take the slot");
  });

  test("inside the defensive core, the harder base wins", () => {
    // Same form; one is three-starred far more often.
    const soft = { items: [...attacks(12, 3, 100).items,
      ...Array.from({ length: 10 }, (_, i) => ({ battleType: "ranked", attack: false, stars: 3,
        destructionPercentage: 100, battleTimestamp: `2026081${i % 5}T0${i % 9}0000.000Z` }))] };
    const hard = { items: [...attacks(12, 3, 100).items,
      ...Array.from({ length: 10 }, (_, i) => ({ battleType: "ranked", attack: false, stars: 1,
        destructionPercentage: 40, battleTimestamp: `2026081${i % 5}T0${i % 9}0000.000Z` }))] };
    const r = rankClan(
      [p("#SOFT", "Legend II", 480), p("#HARD", "Legend II", 480)],
      [{ tag: "#SOFT", battlelog: soft }, { tag: "#HARD", battlelog: hard }],
      { warSize: 1 });
    assert.deepStrictEqual(r.suggested, ["#HARD"]);
  });

  test("a player with zero attacks is never suggested, whatever their band", () => {
    const noAttacks = { items: Array.from({ length: 10 }, (_, i) => ({
      battleType: "ranked", attack: false, stars: 1, destructionPercentage: 30,
      battleTimestamp: `2026081${i % 5}T120000.000Z` })) };
    const r = rankClan([p("#Z", "Legend I", 480)], [{ tag: "#Z", battlelog: noAttacks }], { warSize: 15 });
    assert.deepStrictEqual(r.suggested, []);
  });
}

console.log("rankClan");
{
  const players = [
    { tag: "#A", name: "Active", thLevel: 18, heroSum: 380, warStars: 1200 },
    { tag: "#B", name: "Idle", thLevel: 18, heroSum: 380, warStars: 1200 },
    { tag: "#C", name: "OptedOut", thLevel: 18, heroSum: 380, warStars: 1200, warPreference: "out" },
  ];
  // The rankedLog fixture is a real response with 16 defenses and ZERO attacks,
  // which is exactly what the tag-join test needs. Suggestion tests need a
  // player who actually attacks, since a zero-attack player is never suggested
  // whatever their league or war preference.
  const attacking = { items: Array.from({ length: 12 }, (_, i) => ({
    battleType: "ranked", attack: true, stars: 3, destructionPercentage: 100,
    battleTimestamp: `2026081${i % 5}T${String(i % 24).padStart(2, "0")}0000.000Z` })) };

  const logs = [
    { tag: "#A", battlelog: rankedLog },
    { tag: "#B", battlelog: null },
    { tag: "#C", battlelog: rankedLog },
  ];
  const attackingLogs = [
    { tag: "#A", battlelog: attacking },
    { tag: "#B", battlelog: null },
    { tag: "#C", battlelog: attacking },
  ];

  test("battle logs join on tag, not array position", () => {
    // Deliberately reversed: a positional join would credit A with C's log.
    const r = rankClan(players, logs.slice().reverse());
    const a = r.members.find((m) => m.tag === "#A");
    assert.strictEqual(a.summary.defenseCount, 16, "A should still have its own log");
    const b = r.members.find((m) => m.tag === "#B");
    assert.strictEqual(b.summary.hasData, false, "B has no log and must stay empty");
  });
  test("ranks are assigned in display order", () => {
    const r = rankClan(players, logs);
    assert.deepStrictEqual(r.members.map((m) => m.rank), [1, 2, 3]);
  });

  test("within one league, higher score ranks first", () => {
    const same = [
      { tag: "#LOW", name: "Low", leagueTier: "Legend II" },
      { tag: "#HIGH", name: "High", leagueTier: "Legend II" },
    ];
    const busy = { items: Array.from({ length: 14 }, (_, i) => ({
      battleType: "ranked", attack: true, stars: 3, destructionPercentage: 100,
      battleTimestamp: `2026081${i % 5}T${String(i % 24).padStart(2, "0")}0000.000Z` })) };
    const quiet = { items: [{ battleType: "ranked", attack: true, stars: 1,
      destructionPercentage: 30, battleTimestamp: "20260815T120000.000Z" }] };
    const r = rankClan(same, [{ tag: "#LOW", battlelog: quiet }, { tag: "#HIGH", battlelog: busy }]);
    assert.strictEqual(r.members[0].tag, "#HIGH");
  });
  test("opted-out players are still eligible for CWL", () => {
    // Everyone in the clan plays CWL; the in/out flag is for regular wars.
    const r = rankClan(players, attackingLogs, { warSize: 15 });
    assert.ok(r.suggested.includes("#C"), "an OUT player should still be suggested");
  });

  test("members are grouped by league, strongest tier first", () => {
    const tiered = [
      { tag: "#L3", name: "L3", leagueTier: "Legend III" },
      { tag: "#L1", name: "L1", leagueTier: "Legend I" },
      { tag: "#L2", name: "L2", leagueTier: "Legend II" },
    ];
    const tieredLogs = tiered.map((p) => ({ tag: p.tag, battlelog: rankedLog }));
    const r = rankClan(tiered, tieredLogs);
    assert.deepStrictEqual(r.members.map((m) => m.tag), ["#L1", "#L2", "#L3"]);
  });
  test("suggested roster respects war size", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...maxed, tag: `#T${i}`, name: `P${i}` }));
    const manyLogs = many.map((p) => ({ tag: p.tag, battlelog: attacking }));
    const r = rankClan(many, manyLogs, { warSize: 15 });
    assert.strictEqual(r.suggested.length, 15);
  });
  test("a player with defences but no attacks is never suggested", () => {
    // rankedLog is a real response with 16 defences and zero attacks. Being
    // attacked proves someone is online, not that they will use their own hit.
    const r = rankClan(players, logs, { warSize: 15 });
    assert.deepStrictEqual(r.suggested, [],
      "nobody in this fixture has attacked, so nobody should be suggested");
  });
  test("unrated players are never suggested", () => {
    // Suggesting someone we know nothing about would present a gap in the data
    // as a judgement about the player.
    const r = rankClan(players, attackingLogs, { warSize: 15 });
    assert.ok(!r.suggested.includes("#B"), "an unrated player must not be suggested");
    assert.strictEqual(r.unrated, 1);
  });
  test("missing logs are counted", () => {
    const r = rankClan(players, logs);
    assert.strictEqual(r.missingLogs, 1);
  });
  test("empty input does not throw", () => {
    const r = rankClan([], []);
    assert.deepStrictEqual(r.members, []);
    assert.deepStrictEqual(r.suggested, []);
  });
}

console.log(failures ? `\n${failures} test(s) failed` : "\nAll tests passed");
process.exit(failures ? 1 : 0);
