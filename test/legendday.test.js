/* Regression test for js/legendday.js.
 *
 * The fixtures are the same real GET /players/{tag}/battlelog responses the
 * battle-log tests use, so the per-battle trophy values are already known to
 * agree with ClashPerk. What is checked here is the layer above: which clock an
 * account is on, where that clock's boundary falls, and whether the trophy count
 * walked backwards from the live total lands where it should.
 *
 * The weekly numbers are checkable against the same external source: ClashPerk
 * reported the ranked fixture as "0/24 attacks, 16/24 defenses", and that is one
 * WEEK — all sixteen battles fall inside the week opening Monday 2026-08-10.
 *
 * Run: node test/legendday.test.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  rankedPeriods, periodKey, dayStartFor, weekStartFor, keyToStart, findPeriod,
  cadenceForTier, cadenceForBattles, weeklyAllowance, seasonForPeriod,
} = require("../js/legendday.js");

const fixture = (name) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8"));

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL  ${name}\n      ${e.message}`);
  }
}

console.log("which clock an account is on");
{
  // Legend I still plays legend days; every tier below it is in the weekly pool.
  test("Legend I is daily, everything below is weekly", () => {
    assert.strictEqual(cadenceForTier(105000036), "daily");        // Legend I
    assert.strictEqual(cadenceForTier(105000035), "weekly");       // Legend II
    assert.strictEqual(cadenceForTier(105000034), "weekly");       // Legend III
    assert.strictEqual(cadenceForTier(105000001), "weekly");       // Skeleton 1
    assert.strictEqual(cadenceForTier(105000000), "weekly");       // Unranked
  });

  test("a tier can be named or given as an object", () => {
    assert.strictEqual(cadenceForTier("Legend I"), "daily");
    assert.strictEqual(cadenceForTier({ id: 105000035, name: "Legend II" }), "weekly");
  });

  test("an unreadable tier answers null, not a guess", () =>
    assert.strictEqual(cadenceForTier(null), null));

  // The battle types say the same thing, and are the fallback when the player's
  // tier is missing: Legend I returns "legend", everything below "ranked".
  test("the battle log answers the same question", () => {
    assert.strictEqual(cadenceForBattles(fixture("battlelog-legend.json")), "daily");
    assert.strictEqual(cadenceForBattles(fixture("battlelog-ranked.json")), "weekly");
    assert.strictEqual(cadenceForBattles({ items: [{ battleType: "homeVillage" }] }), null);
  });
}

console.log("the 05:00 UTC boundary");
{
  test("a battle at 04:59 belongs to the day before", () =>
    assert.strictEqual(periodKey("2026-08-15T04:59:59Z", "daily"), "2026-08-14"));

  test("a battle at 05:00 opens the new day", () =>
    assert.strictEqual(periodKey("2026-08-15T05:00:00Z", "daily"), "2026-08-15"));

  test("a day starts at 05:00 UTC, not midnight", () =>
    assert.strictEqual(dayStartFor("2026-08-15T22:00:00Z").toISOString(),
      "2026-08-15T05:00:00.000Z"));

  test("keys round-trip back to their start", () =>
    assert.strictEqual(keyToStart("2026-08-14").toISOString(), "2026-08-14T05:00:00.000Z"));

  test("a malformed key is null, not an Invalid Date", () =>
    assert.strictEqual(keyToStart("not-a-day"), null));
}

console.log("the Monday 05:00 UTC week");
{
  // leagueSeasonId on /leaguehistory lands on Monday 05:00 UTC and steps in
  // exact 604,800-second jumps, which is where both the anchor and the length
  // come from.
  test("a week opens on Monday at 05:00 UTC", () =>
    assert.strictEqual(weekStartFor("2026-08-14T22:00:00Z").toISOString(),
      "2026-08-10T05:00:00.000Z"));

  test("Monday 04:59 is still last week", () =>
    assert.strictEqual(periodKey("2026-08-17T04:59:59Z", "weekly"), "2026-08-10"));

  test("Monday 05:00 opens the new week", () =>
    assert.strictEqual(periodKey("2026-08-17T05:00:00Z", "weekly"), "2026-08-17"));

  test("Sunday night belongs to the week that started six days earlier", () =>
    assert.strictEqual(periodKey("2026-08-16T23:30:00Z", "weekly"), "2026-08-10"));

  test("a week runs a full seven days", () => {
    const [w] = rankedPeriods(fixture("battlelog-ranked.json"), { cadence: "weekly" });
    assert.strictEqual(w.end.getTime() - w.start.getTime(), 7 * 86400000);
  });
}

console.log("the weekly allowance comes from the game, not from us");
{
  // maxBattles per completed week, alongside the tier it was played in.
  const history = { items: [
    { leagueSeasonId: 1785128400, leagueTierId: 105000033, maxBattles: 18 },
    { leagueSeasonId: 1785733200, leagueTierId: 105000034, maxBattles: 24 },
    { leagueSeasonId: 1786338000, leagueTierId: 105000035, maxBattles: 30 },
  ]};

  test("the allowance is read for the tier asked about", () => {
    assert.strictEqual(weeklyAllowance(history, 105000034), 24);   // Legend III
    assert.strictEqual(weeklyAllowance(history, 105000035), 30);   // Legend II
    assert.strictEqual(weeklyAllowance(history, 105000033), 18);
  });

  test("a tier the history has never seen has no allowance", () =>
    assert.strictEqual(weeklyAllowance(history, 105000001), null));

  test("the most recent week in that tier wins", () => {
    const moved = { items: [
      { leagueSeasonId: 1785128400, leagueTierId: 105000034, maxBattles: 20 },
      { leagueSeasonId: 1785733200, leagueTierId: 105000034, maxBattles: 24 },
    ]};
    assert.strictEqual(weeklyAllowance(moved, 105000034), 24);
  });

  test("a sat-out week (maxBattles 0) is not an allowance of zero", () =>
    assert.strictEqual(weeklyAllowance({ items: [
      { leagueSeasonId: 1786338000, leagueTierId: 105000034, maxBattles: 0 },
      { leagueSeasonId: 1785733200, leagueTierId: 105000034, maxBattles: 24 },
    ]}, 105000034), 24));

  test("no history at all is null", () => {
    assert.strictEqual(weeklyAllowance(null, 105000034), null);
    assert.strictEqual(weeklyAllowance({ items: [] }, 105000034), null);
  });
}

console.log("a Legend I day (battleType 'legend')");
{
  const days = rankedPeriods(fixture("battlelog-legend.json"), {
    cadence: "daily",
    currentTrophies: 5161,
    now: new Date("2026-08-15T12:00:00Z"),
  });
  const day = findPeriod(days, "2026-08-14");

  test("days come back newest first", () =>
    assert.deepStrictEqual(days.map((d) => d.key), ["2026-08-15", "2026-08-14", "2026-08-13"]));

  // A Legend day is eight attacks and eight defences; this one is both, with
  // the last defence landing at 04:02 the following morning — before the reset,
  // so it counts here rather than opening the next day.
  test("eight attacks and eight defences", () => {
    assert.strictEqual(day.attackCount, 8);
    assert.strictEqual(day.defenseCount, 8);
  });

  test("the pre-reset defence stays on this day", () =>
    assert.strictEqual(day.defenses[0].timestamp.toISOString(), "2026-08-15T04:02:23.000Z"));

  test("attack and defence trophies are totalled separately", () => {
    assert.strictEqual(day.attackTrophies, 227);
    assert.strictEqual(day.defenseTrophies, -243);
    assert.strictEqual(day.net, -16);
  });

  test("averages are per side", () => {
    assert.strictEqual(Math.round(day.avgAttack * 10) / 10, 28.4);
    assert.strictEqual(Math.round(day.avgDefense * 10) / 10, -30.4);
  });

  test("the daily allowance is eight and eight", () => {
    assert.strictEqual(day.cadence, "daily");
    assert.strictEqual(day.attacksAllowed, 8);
    assert.strictEqual(day.defensesAllowed, 8);
  });

  test("a weekly allowance cannot override the daily eight", () => {
    const [d] = rankedPeriods(fixture("battlelog-legend.json"),
      { cadence: "daily", attacksAllowed: 30, now: new Date("2026-08-15T12:00:00Z") });
    assert.strictEqual(d.attacksAllowed, 8);
  });
}

console.log("a Ranked week (battleType 'ranked')");
{
  // ClashPerk read this same fixture as 0/24 attacks and 16/24 defenses. Both
  // of those are week totals, and 24 is the Legend III weekly allowance.
  const weeks = rankedPeriods(fixture("battlelog-ranked.json"), {
    cadence: "weekly",
    attacksAllowed: 24,
    currentTrophies: 4712,
    now: new Date("2026-08-15T12:00:00Z"),
  });

  test("five days of battles are one week, not five days", () =>
    assert.deepStrictEqual(weeks.map((w) => w.key), ["2026-08-10"]));

  test("the week matches ClashPerk's 0/24 and 16/24", () => {
    assert.strictEqual(weeks[0].attackCount, 0);
    assert.strictEqual(weeks[0].defenseCount, 16);
    assert.strictEqual(weeks[0].attacksAllowed, 24);
    assert.strictEqual(weeks[0].defensesAllowed, 24);
  });

  test("the week's net is the log's net", () =>
    assert.strictEqual(weeks[0].net, 213));

  // A denominator we cannot source is left off rather than defaulted to eight,
  // which is a Legend I number and would be wrong in every other league.
  test("an unknown allowance stays null", () => {
    const [w] = rankedPeriods(fixture("battlelog-ranked.json"), { cadence: "weekly" });
    assert.strictEqual(w.attacksAllowed, null);
    assert.strictEqual(w.defensesAllowed, null);
  });

  test("a defence-only week reports null attack averages", () => {
    assert.strictEqual(weeks[0].avgAttack, null);
    assert.strictEqual(weeks[0].avgAttackStars, null);
  });

  test("without a cadence the battle types choose one", () => {
    const [w] = rankedPeriods(fixture("battlelog-ranked.json"), { now: new Date("2026-08-15T12:00:00Z") });
    assert.strictEqual(w.cadence, "weekly");
    assert.strictEqual(w.key, "2026-08-10");
  });
}

console.log("the completed week behind a period");
{
  const weeks = rankedPeriods(fixture("battlelog-ranked.json"), { cadence: "weekly" });
  const history = { items: [
    { leagueSeasonId: 1785733200, leagueTierId: 105000034, maxBattles: 24, placement: 15 },
    { leagueSeasonId: 1786338000, leagueTierId: 105000034, maxBattles: 24, placement: 7 },
  ]};

  // leagueSeasonId 1786338000 is Monday 2026-08-10 05:00 UTC — the same instant
  // this week opens, which is what ties the two records together.
  test("a week finds its own season row", () =>
    assert.strictEqual(seasonForPeriod(history, weeks[0]).placement, 7));

  test("a week with no matching row is null", () =>
    assert.strictEqual(seasonForPeriod({ items: [history.items[0]] }, weeks[0]), null));

  test("a legend day never claims a weekly season row", () => {
    const [day] = rankedPeriods(fixture("battlelog-legend.json"), { cadence: "daily" });
    assert.strictEqual(seasonForPeriod(history, day), null);
  });
}

console.log("trophies walked back from the live total");
{
  const days = rankedPeriods(fixture("battlelog-legend.json"), {
    cadence: "daily",
    currentTrophies: 5161,
    now: new Date("2026-08-15T12:00:00Z"),
  });

  test("the newest period ends where the player stands now", () =>
    assert.strictEqual(days[0].endTrophies, 5161));

  test("each period starts where it ended minus its own net", () => {
    for (const d of days) assert.strictEqual(d.startTrophies, d.endTrophies - d.net);
  });

  test("one period's start is the previous one's end", () => {
    for (let i = 1; i < days.length; i++)
      assert.strictEqual(days[i].endTrophies, days[i - 1].startTrophies);
  });

  test("without a live total the ends are null, not zero", () => {
    const blind = rankedPeriods(fixture("battlelog-legend.json"), { cadence: "daily" });
    assert.strictEqual(blind[0].startTrophies, null);
    assert.strictEqual(blind[0].endTrophies, null);
    // The movement itself is measured from the battles, so it survives.
    assert.strictEqual(findPeriod(blind, "2026-08-14").net, -16);
  });
}

console.log("what the log can and cannot see");
{
  const days = rankedPeriods(fixture("battlelog-legend.json"), {
    cadence: "daily",
    currentTrophies: 5161,
    now: new Date("2026-08-15T12:00:00Z"),
  });

  // This log's oldest battle of any type predates every ranked day in it, so
  // nothing has been cut off — 2026-08-13 really did see four ranked battles.
  test("periods the log reaches back past are complete", () => {
    assert.strictEqual(findPeriod(days, "2026-08-13").complete, true);
    assert.strictEqual(findPeriod(days, "2026-08-14").complete, true);
  });

  // The buffer holds only ~50 battles of every type. When it runs out mid-period
  // the missing battles look exactly like a quiet morning, so the period says so
  // rather than reporting a two-attack day the player never had.
  test("a period the buffer cuts in half is flagged incomplete", () => {
    const cut = { items: fixture("battlelog-legend.json").items
      .filter((b) => b.battleTimestamp > "20260814T140000") };
    const day = findPeriod(rankedPeriods(cut, { cadence: "daily", now: new Date("2026-08-15T12:00:00Z") }), "2026-08-14");
    assert.strictEqual(day.complete, false);
    assert.ok(day.attackCount < 8, "expected the cut to lose attacks");
  });

  // A week is seven days and the buffer is rarely that long, so this is the
  // normal state for a weekly account rather than an edge case.
  test("a week the buffer opens inside is incomplete", () =>
    assert.strictEqual(rankedPeriods(fixture("battlelog-ranked.json"), { cadence: "weekly" })[0].complete, false));

  test("the period containing 'now' is in progress", () => {
    assert.strictEqual(days[0].inProgress, true);
    assert.strictEqual(days[1].inProgress, false);
  });

  test("an old log has no period in progress", () => {
    const later = rankedPeriods(fixture("battlelog-legend.json"),
      { cadence: "daily", now: new Date("2026-09-01T12:00:00Z") });
    assert.ok(later.every((d) => !d.inProgress));
  });

  test("a week in progress is measured against the week's end", () => {
    const [w] = rankedPeriods(fixture("battlelog-ranked.json"),
      { cadence: "weekly", now: new Date("2026-08-15T12:00:00Z") });
    assert.strictEqual(w.inProgress, true);
    const [over] = rankedPeriods(fixture("battlelog-ranked.json"),
      { cadence: "weekly", now: new Date("2026-08-17T06:00:00Z") });
    assert.strictEqual(over.inProgress, false);
  });
}

console.log("empty and broken input");
{
  test("no battlelog is an empty list, not a throw", () => {
    assert.deepStrictEqual(rankedPeriods(null), []);
    assert.deepStrictEqual(rankedPeriods({ items: [] }), []);
  });

  test("non-ranked battles alone produce no periods", () =>
    assert.deepStrictEqual(
      rankedPeriods({ items: [{ battleType: "homeVillage", attack: true, stars: 3,
                               destructionPercentage: 100, battleTimestamp: "20260815T120000.000Z" }] }),
      []));

  test("a battle with an unreadable timestamp is skipped", () =>
    assert.deepStrictEqual(
      rankedPeriods({ items: [{ battleType: "legend", attack: true, stars: 3,
                               destructionPercentage: 100, battleTimestamp: "nonsense" }] }),
      []));

  test("an unknown key finds nothing", () =>
    assert.strictEqual(findPeriod(rankedPeriods({ items: [] }), "2026-08-14"), null));
}

console.log(failures ? `\n${failures} test(s) failed` : "\nAll tests passed");
process.exit(failures ? 1 : 0);
