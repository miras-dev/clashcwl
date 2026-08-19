/* Regression test for js/legendday.js.
 *
 * The fixtures are the same real GET /players/{tag}/battlelog responses the
 * battle-log tests use, so the per-battle trophy values are already known to
 * agree with ClashPerk. What is checked here is the layer above: where the
 * 05:00 UTC boundary falls, and whether the trophy count walked backwards from
 * the live total lands where it should.
 *
 * Run: node test/legendday.test.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { legendDays, dayKey, dayStartFor, keyToStart, findDay } = require("../js/legendday.js");

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

console.log("the 05:00 UTC boundary");
{
  test("a battle at 04:59 belongs to the day before", () =>
    assert.strictEqual(dayKey("2026-08-15T04:59:59Z"), "2026-08-14"));

  test("a battle at 05:00 opens the new day", () =>
    assert.strictEqual(dayKey("2026-08-15T05:00:00Z"), "2026-08-15"));

  test("a day starts at 05:00 UTC, not midnight", () =>
    assert.strictEqual(dayStartFor("2026-08-15T22:00:00Z").toISOString(),
      "2026-08-15T05:00:00.000Z"));

  test("keys round-trip back to their start", () =>
    assert.strictEqual(keyToStart("2026-08-14").toISOString(), "2026-08-14T05:00:00.000Z"));

  test("a malformed key is null, not an Invalid Date", () =>
    assert.strictEqual(keyToStart("not-a-day"), null));
}

console.log("a full legend day (battleType 'legend')");
{
  const days = legendDays(fixture("battlelog-legend.json"), {
    currentTrophies: 5161,
    now: new Date("2026-08-15T12:00:00Z"),
  });
  const day = findDay(days, "2026-08-14");

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

  test("a legend day carries the 8-attack allowance", () => {
    assert.strictEqual(day.isLegend, true);
    assert.strictEqual(day.attacksAllowed, 8);
    assert.strictEqual(day.defensesAllowed, 8);
  });
}

console.log("trophies walked back from the live total");
{
  const days = legendDays(fixture("battlelog-legend.json"), {
    currentTrophies: 5161,
    now: new Date("2026-08-15T12:00:00Z"),
  });

  test("the newest day ends where the player stands now", () =>
    assert.strictEqual(days[0].endTrophies, 5161));

  test("each day starts where it ended minus its own net", () => {
    for (const d of days) assert.strictEqual(d.startTrophies, d.endTrophies - d.net);
  });

  test("one day's start is the previous day's end", () => {
    for (let i = 1; i < days.length; i++)
      assert.strictEqual(days[i].endTrophies, days[i - 1].startTrophies);
  });

  test("without a live total the ends are null, not zero", () => {
    const blind = legendDays(fixture("battlelog-legend.json"));
    assert.strictEqual(blind[0].startTrophies, null);
    assert.strictEqual(blind[0].endTrophies, null);
    // The movement itself is measured from the battles, so it survives.
    assert.strictEqual(findDay(blind, "2026-08-14").net, -16);
  });
}

console.log("what the log can and cannot see");
{
  const days = legendDays(fixture("battlelog-legend.json"), {
    currentTrophies: 5161,
    now: new Date("2026-08-15T12:00:00Z"),
  });

  // This log's oldest battle of any type predates every ranked day in it, so
  // nothing has been cut off — 2026-08-13 really did see four ranked battles.
  test("days the log reaches back past are complete", () => {
    assert.strictEqual(findDay(days, "2026-08-13").complete, true);
    assert.strictEqual(findDay(days, "2026-08-14").complete, true);
  });

  // The buffer holds only ~50 battles of every type. When it runs out mid-day
  // the missing battles look exactly like a quiet morning, so the day says so
  // rather than reporting a two-attack day the player never had.
  test("a day the buffer cuts in half is flagged incomplete", () => {
    const cut = { items: fixture("battlelog-legend.json").items
      .filter((b) => b.battleTimestamp > "20260814T140000") };
    const day = findDay(legendDays(cut, { now: new Date("2026-08-15T12:00:00Z") }), "2026-08-14");
    assert.strictEqual(day.complete, false);
    assert.ok(day.attackCount < 8, "expected the cut to lose attacks");
  });

  test("the day containing 'now' is in progress", () => {
    assert.strictEqual(days[0].inProgress, true);
    assert.strictEqual(days[1].inProgress, false);
  });

  test("an old log has no day in progress", () => {
    const later = legendDays(fixture("battlelog-legend.json"), { now: new Date("2026-09-01T12:00:00Z") });
    assert.ok(later.every((d) => !d.inProgress));
  });
}

console.log("ranked days below Legend (battleType 'ranked')");
{
  const days = legendDays(fixture("battlelog-ranked.json"), { now: new Date("2026-08-15T12:00:00Z") });

  test("ranked battles are grouped too", () =>
    assert.deepStrictEqual(days.map((d) => d.key),
      ["2026-08-14", "2026-08-13", "2026-08-12", "2026-08-11", "2026-08-10"]));

  // Below Legend there is no eight-a-day allowance, so a "0 / 8" would be a
  // limit the game never imposed on this account.
  test("no allowance is claimed outside Legend", () => {
    const d = days[0];
    assert.strictEqual(d.isLegend, false);
    assert.strictEqual(d.attacksAllowed, null);
    assert.strictEqual(d.defensesAllowed, null);
  });

  test("a defence-only day still reports null attack averages", () => {
    const d = days[0];
    assert.strictEqual(d.attackCount, 0);
    assert.strictEqual(d.avgAttack, null);
  });
}

console.log("empty and broken input");
{
  test("no battlelog is an empty list, not a throw", () => {
    assert.deepStrictEqual(legendDays(null), []);
    assert.deepStrictEqual(legendDays({ items: [] }), []);
  });

  test("non-ranked battles alone produce no days", () =>
    assert.deepStrictEqual(
      legendDays({ items: [{ battleType: "homeVillage", attack: true, stars: 3,
                            destructionPercentage: 100, battleTimestamp: "20260815T120000.000Z" }] }),
      []));

  test("a battle with an unreadable timestamp is skipped", () =>
    assert.deepStrictEqual(
      legendDays({ items: [{ battleType: "legend", attack: true, stars: 3,
                            destructionPercentage: 100, battleTimestamp: "nonsense" }] }),
      []));

  test("an unknown day key finds nothing", () =>
    assert.strictEqual(findDay(legendDays({ items: [] }), "2026-08-14"), null));
}

console.log(failures ? `\n${failures} test(s) failed` : "\nAll tests passed");
process.exit(failures ? 1 : 0);
