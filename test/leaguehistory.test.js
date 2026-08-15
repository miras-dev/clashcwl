/* Tests for js/leaguehistory.js.
 *
 * Run: node test/leaguehistory.test.js
 */
const assert = require("assert");
const { summariseSeasons, groupByPlayer, RELIABLE_USAGE } = require("../js/leaguehistory.js");

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

/* A season row. Defaults describe a full-participation season so tests only
   state the field they are actually about. */
const season = (over = {}) => ({
  leagueSeasonId: 1782709200,
  leagueTierId: 105000034,
  leagueTrophies: 1082,
  placement: 15,
  attackWins: 24,
  attackLosses: 0,
  maxBattles: 24,
  ...over,
});

console.log("attack usage");
{
  test("a perfect record reads as 100%", () => {
    const s = summariseSeasons({ items: [season(), season(), season()] });
    assert.strictEqual(s.usage, 1);
    assert.strictEqual(s.attacksUsed, 72);
    assert.strictEqual(s.attacksAvailable, 72);
    assert.strictEqual(s.perfectSeasons, 3);
    assert.strictEqual(s.reliable, true);
  });

  // A lost attack was still an attack taken. Usage measures participation, not
  // skill, so counting only wins would punish players for attacking hard.
  test("losses count as attacks used", () => {
    const s = summariseSeasons({
      items: [season({ attackWins: 20, attackLosses: 4 }), season({ attackWins: 18, attackLosses: 6 })],
    });
    assert.strictEqual(s.attacksUsed, 48);
    assert.strictEqual(s.usage, 1);
    assert.strictEqual(s.reliable, true);
  });

  test("skipped attacks drag the rate down", () => {
    const s = summariseSeasons({
      items: [season({ attackWins: 12, attackLosses: 0 }), season({ attackWins: 12, attackLosses: 0 })],
    });
    assert.strictEqual(s.usage, 0.5);
    assert.strictEqual(s.reliable, false);
  });

  test("the reliability line falls where documented", () => {
    // 85% of 100 available.
    const at = summariseSeasons({
      items: [season({ attackWins: 43, maxBattles: 50 }), season({ attackWins: 42, maxBattles: 50 })],
    });
    assert.strictEqual(at.usage, 0.85);
    assert.strictEqual(at.reliable, true, "exactly at the threshold counts as reliable");

    const below = summariseSeasons({
      items: [season({ attackWins: 42, maxBattles: 50 }), season({ attackWins: 42, maxBattles: 50 })],
    });
    assert.ok(below.usage < RELIABLE_USAGE);
    assert.strictEqual(below.reliable, false);
  });
}

// "Not enough evidence" and "demonstrably unreliable" are different states, and
// only the second should ever count against a player.
console.log("thin and missing data are never held against a player");
{
  test("a single season is thin, so reliable is null not false", () => {
    const s = summariseSeasons({ items: [season({ attackWins: 2 })] });
    assert.strictEqual(s.thin, true);
    assert.strictEqual(s.reliable, null, "one bad season must not brand a player unreliable");
    assert.ok(s.usage < 0.2, "the rate is still computed, just not acted on");
  });

  test("no history at all is null", () => {
    assert.strictEqual(summariseSeasons(null), null);
    assert.strictEqual(summariseSeasons({}), null);
    assert.strictEqual(summariseSeasons({ items: [] }), null);
  });

  // Dividing by zero available attacks would report a player who did nothing as
  // perfectly reliable, which is the exact inversion of the truth.
  test("seasons with no battles available do not read as perfect", () => {
    const s = summariseSeasons({
      items: [season({ attackWins: 0, attackLosses: 0, maxBattles: 0 }),
              season({ attackWins: 0, attackLosses: 0, maxBattles: 0 })],
    });
    assert.strictEqual(s.hasData, false);
    assert.strictEqual(s.usage, null);
    assert.notStrictEqual(s.usage, 1);
    assert.strictEqual(s.reliable, null);
  });
}

console.log("season windowing");
{
  test("only the most recent seasons are read", () => {
    // Twelve seasons: the first six perfect, the last six half-used. Reading the
    // recent tail must reflect the recent half, not the lifetime average.
    const old = Array.from({ length: 6 }, () => season());
    const recent = Array.from({ length: 6 }, () => season({ attackWins: 12 }));
    const s = summariseSeasons({ items: [...old, ...recent] });
    assert.strictEqual(s.seasonCount, 6);
    assert.strictEqual(s.usage, 0.5, "old good seasons must not mask a recent decline");
  });

  test("the window is configurable", () => {
    const items = Array.from({ length: 6 }, () => season());
    assert.strictEqual(summariseSeasons({ items }, { seasons: 2 }).seasonCount, 2);
  });

  test("fewer seasons than the window is fine", () => {
    const s = summariseSeasons({ items: [season(), season()] });
    assert.strictEqual(s.seasonCount, 2);
    assert.strictEqual(s.thin, false);
  });
}

console.log("per-season rows");
{
  test("rows carry tier, trophies and placement for display", () => {
    const s = summariseSeasons({ items: [season({ leagueTierId: 105000036, leagueTrophies: 1117, placement: 11 })] });
    const row = s.seasons[0];
    assert.strictEqual(row.tier.name, "Legend I");
    assert.strictEqual(row.trophies, 1117);
    assert.strictEqual(row.placement, 11);
    assert.strictEqual(row.usage, 1);
  });

  test("the season id becomes a real date", () => {
    const s = summariseSeasons({ items: [season({ leagueSeasonId: 1782709200 })] });
    assert.ok(s.seasons[0].date instanceof Date);
    assert.strictEqual(s.seasons[0].date.getTime(), 1782709200 * 1000);
  });

  test("an unknown tier does not throw", () => {
    const s = summariseSeasons({ items: [season({ leagueTierId: 999999999 }), season()] });
    assert.strictEqual(s.seasons[0].tier, null);
    assert.strictEqual(s.usage, 1);
  });
}

// The real payload for #P9UQVUJJ0 — six seasons, 144/144 attacks. The fields
// this module refuses to read are present here on purpose: if a future change
// starts trusting attackStars or defenseStars, this fixture makes it obvious.
console.log("the real six-season sample");
{
  const real = { items: [
    { leagueSeasonId: 1782709200, leagueTrophies: 1082, leagueTierId: 105000034, placement: 15,
      attackWins: 24, attackLosses: 0, attackStars: 0, defenseWins: 1, defenseLosses: 22, defenseStars: 54, maxBattles: 24 },
    { leagueSeasonId: 1783314000, leagueTrophies: 889, leagueTierId: 105000034, placement: 66,
      attackWins: 24, attackLosses: 0, attackStars: 0, defenseWins: 0, defenseLosses: 22, defenseStars: 58, maxBattles: 24 },
    { leagueSeasonId: 1783918800, leagueTrophies: 1048, leagueTierId: 105000034, placement: 23,
      attackWins: 23, attackLosses: 1, attackStars: 0, defenseWins: 0, defenseLosses: 22, defenseStars: 49, maxBattles: 24 },
    { leagueSeasonId: 1784523600, leagueTrophies: 1117, leagueTierId: 105000034, placement: 11,
      attackWins: 24, attackLosses: 0, attackStars: 0, defenseWins: 0, defenseLosses: 20, defenseStars: 47, maxBattles: 24 },
    { leagueSeasonId: 1785128400, leagueTrophies: 1083, leagueTierId: 105000034, placement: 15,
      attackWins: 24, attackLosses: 0, attackStars: 0, defenseWins: 0, defenseLosses: 22, defenseStars: 52, maxBattles: 24 },
    { leagueSeasonId: 1785733200, leagueTrophies: 1112, leagueTierId: 105000034, placement: 14,
      attackWins: 24, attackLosses: 0, attackStars: 0, defenseWins: 1, defenseLosses: 22, defenseStars: 56, maxBattles: 24 },
  ] };

  test("144 of 144 attacks used across six seasons", () => {
    const s = summariseSeasons(real);
    assert.strictEqual(s.seasonCount, 6);
    assert.strictEqual(s.attacksUsed, 144);
    assert.strictEqual(s.attacksAvailable, 144);
    assert.strictEqual(s.usage, 1);
    assert.strictEqual(s.perfectSeasons, 6);
    assert.strictEqual(s.reliable, true);
  });

  test("the season with a loss still counts as fully used", () => {
    const s = summariseSeasons(real);
    const withLoss = s.seasons.find((x) => x.seasonId === 1783918800);
    assert.strictEqual(withLoss.attacksUsed, 24, "23 wins + 1 loss is 24 attacks taken");
    assert.strictEqual(withLoss.usage, 1);
  });

  // attackStars is 0 on every season of every account observed. If it is ever
  // surfaced as a triple rate, a player who tripled 143 times reads as zero.
  test("no triple rate is derived from this endpoint", () => {
    const s = summariseSeasons(real);
    assert.ok(!("tripleRate" in s), "attackStars is a dead field — see the module header");
    assert.ok(!("stars" in s.seasons[0]));
  });

  test("no defensive rate is derived either", () => {
    const s = summariseSeasons(real);
    assert.ok(!("defenseStars" in s.seasons[0]),
      "defenseStars is a season aggregate and cannot become a per-defence rate");
  });
}

console.log("grouping a batched response");
{
  test("members join on tag", () => {
    const m = groupByPlayer({ members: [
      { tag: "#A", history: { items: [season()] } },
      { tag: "#B", history: null, error: "HTTP 404" },
      { tag: "#C", history: { items: [season()] } },
    ] });
    assert.strictEqual(m.size, 2, "a failed fetch is skipped, not stored as empty");
    assert.ok(m.has("#A") && m.has("#C"));
    assert.ok(!m.has("#B"));
  });

  test("an empty or missing batch is inert", () => {
    assert.strictEqual(groupByPlayer(null).size, 0);
    assert.strictEqual(groupByPlayer({}).size, 0);
    assert.strictEqual(groupByPlayer({ members: [] }).size, 0);
  });
}

console.log(failures ? `\n${failures} failing` : "\nAll tests passed");
process.exit(failures ? 1 : 0);
