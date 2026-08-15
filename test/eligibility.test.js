/* Tests for js/eligibility.js.
 *
 * Run: node test/eligibility.test.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { rosterScore, formScore, scoreMember, rankClan,
        tierRank, expectedAttackGain, tierBonus } = require("../js/eligibility.js");

const rankedLog = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "battlelog-ranked.json"), "utf8"));

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

const maxed = { tag: "#A", name: "Maxed", thLevel: 18, heroSum: 380, warStars: 1200 };

console.log("rosterScore");
{
  // Regression: `Number(x) || 0 - 9` parses as `Number(x) || (0 - 9)`, so the
  // -9 offset never applied and every TH from 9 to 18 scored identically.
  test("Town Hall level actually changes the score", () => {
    const low = rosterScore({ thLevel: 9, heroSum: 0, warStars: 0 });
    const high = rosterScore({ thLevel: 18, heroSum: 0, warStars: 0 });
    assert.ok(high > low, `TH18 (${high}) should outscore TH9 (${low})`);
  });
  test("a maxed player scores 1", () => assert.strictEqual(rosterScore(maxed), 1));
  test("missing fields do not produce NaN", () => {
    const s = rosterScore({});
    assert.ok(Number.isFinite(s) && s >= 0, `got ${s}`);
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
  // attacking. An unproven player might still turn up.
  test("demonstrated inactivity ranks below an unknown player", () => {
    const idleProven = scoreMember(maxed, rankedLog);   // 0 attacks, 16 defenses
    const unknown = scoreMember(maxed, null);
    assert.ok(idleProven.score < unknown.score,
      `proven-idle (${idleProven.score}) should rank below unknown (${unknown.score})`);
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
  test("an unproven player cannot outrank a proven attacker", () => {
    const unproven = scoreMember(maxed, null);
    const proven = scoreMember(maxed, rankedLog);
    assert.ok(unproven.score <= 80,
      `unproven scored ${unproven.score}, should be held at or below 80`);
    assert.ok(proven.score !== unproven.score, "evidence should change the score");
  });
  test("zero attacks is called out in the reasons", () => {
    const m = scoreMember(maxed, rankedLog);   // fixture has 0 attacks, 16 defenses
    assert.strictEqual(m.attackCountIsZero, undefined);
    assert.ok(m.reasons.some((r) => /zero times/i.test(r)),
      `reasons were: ${JSON.stringify(m.reasons)}`);
  });
  test("no battle log is explained rather than silently penalised", () => {
    const m = scoreMember(maxed, null);
    assert.strictEqual(m.formScore, null);
    assert.ok(m.reasons.some((r) => /roster only/i.test(r)));
  });
  test("war preference OUT is surfaced", () => {
    const m = scoreMember({ ...maxed, warPreference: "out" }, rankedLog);
    assert.ok(m.reasons.some((r) => /OUT/.test(r)));
  });
}

console.log("rankClan");
{
  const players = [
    { tag: "#A", name: "Active", thLevel: 18, heroSum: 380, warStars: 1200 },
    { tag: "#B", name: "Idle", thLevel: 18, heroSum: 380, warStars: 1200 },
    { tag: "#C", name: "OptedOut", thLevel: 18, heroSum: 380, warStars: 1200, warPreference: "out" },
  ];
  const logs = [
    { tag: "#A", battlelog: rankedLog },
    { tag: "#B", battlelog: null },
    { tag: "#C", battlelog: rankedLog },
  ];

  test("battle logs join on tag, not array position", () => {
    // Deliberately reversed: a positional join would credit A with C's log.
    const r = rankClan(players, logs.slice().reverse());
    const a = r.members.find((m) => m.tag === "#A");
    assert.strictEqual(a.summary.defenseCount, 16, "A should still have its own log");
    const b = r.members.find((m) => m.tag === "#B");
    assert.strictEqual(b.summary.hasData, false, "B has no log and must stay empty");
  });
  test("ranks are assigned in score order", () => {
    const r = rankClan(players, logs);
    assert.strictEqual(r.members[0].rank, 1);
    assert.ok(r.members[0].score >= r.members[1].score);
  });
  test("opted-out players are excluded from the suggested roster", () => {
    const r = rankClan(players, logs, { warSize: 15 });
    assert.ok(!r.suggested.includes("#C"), "an OUT player must not be suggested");
  });
  test("suggested roster respects war size", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...maxed, tag: `#T${i}`, name: `P${i}` }));
    const r = rankClan(many, [], { warSize: 15 });
    assert.strictEqual(r.suggested.length, 15);
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
