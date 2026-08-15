/* Regression test for js/battlelog.js.
 *
 * The fixtures are real GET /players/{tag}/battlelog responses. The expected
 * numbers were read off ClashPerk's /legend days output for the same player at
 * the same moment, so a pass means our derived trophy values agree with a bot
 * that has been doing this for years — the only external check available, since
 * the API itself returns trophyChange: null.
 *
 * Run: node test/battlelog.test.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { summariseRanked, calculateTrophies } = require("../js/battlelog.js");

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

console.log("battleType 'ranked' (Legend II/III)");
{
  const s = summariseRanked(fixture("battlelog-ranked.json"));

  // ClashPerk reported: 213 trophies gained, 0/24 attacks, 16/24 defenses.
  test("net trophies match ClashPerk", () => assert.strictEqual(s.netTrophies, 213));
  test("attack count match", () => assert.strictEqual(s.attackCount, 0));
  test("defense count match", () => assert.strictEqual(s.defenseCount, 16));

  // Every individual row, newest first, as displayed by ClashPerk.
  const expected = [9, 0, 0, 25, 12, 25, 16, 0, 11, 26, 13, 29, 0, 14, 8, 25];
  test("per-battle trophy deltas match", () =>
    assert.deepStrictEqual(s.battles.map((b) => b.trophyChange), expected));

  test("no attacks means null averages, not zero", () => {
    assert.strictEqual(s.avgAttackGain, null);
    assert.strictEqual(s.tripleRate, null);
  });
}

console.log("battleType 'legend' (Legend I)");
{
  const s = summariseRanked(fixture("battlelog-legend.json"));

  // Legend I returns battleType "legend" rather than "ranked". Filtering on
  // "ranked" alone would silently return nothing for every Legend I player.
  test("legend battles are not dropped", () => assert.strictEqual(s.hasData, true));
  test("has both attacks and defenses", () => {
    assert.ok(s.attackCount > 0, "expected attacks");
    assert.ok(s.defenseCount > 0, "expected defenses");
  });
  test("legend defenses are negative or zero", () => {
    const bad = s.battles.filter((b) => !b.isAttack && b.trophyChange > 0);
    assert.strictEqual(bad.length, 0, `${bad.length} legend defenses gained trophies`);
  });
}

console.log("trophy formula");
{
  test("3-star attack takes the full pool", () =>
    assert.strictEqual(calculateTrophies(3, 100, { isAttack: true, isLegendLeague: false }), 40));
  test("3-star defense in Ranked leaves nothing", () =>
    assert.strictEqual(calculateTrophies(3, 100, { isAttack: false, isLegendLeague: false }), 0));
  test("0-star defense in Ranked takes the full pool", () =>
    assert.strictEqual(calculateTrophies(0, 0, { isAttack: false, isLegendLeague: false }), 40));
  test("0-star defense in Legend costs nothing", () =>
    assert.strictEqual(calculateTrophies(0, 0, { isAttack: false, isLegendLeague: true }), 0));
  test("Legend defense loses what the attacker gained", () =>
    assert.strictEqual(calculateTrophies(2, 80, { isAttack: false, isLegendLeague: true }),
      -calculateTrophies(2, 80, { isAttack: true, isLegendLeague: false })));
  test("gain is capped at the 40 pool", () =>
    assert.strictEqual(calculateTrophies(1, 100, { isAttack: true, isLegendLeague: false }) <= 40, true));
}

console.log("missing or malformed input");
{
  // GET /players/{tag}/battlelog returns HTTP 500 for some players (observed on
  // an Unranked, zero-trophy member), so callers pass null on failure.
  test("null input is inert", () => {
    const s = summariseRanked(null);
    assert.strictEqual(s.hasData, false);
    assert.strictEqual(s.netTrophies, 0);
    assert.strictEqual(s.attacksPerDay, null);
  });
  test("a log with no ranked battles is inert", () => {
    const s = summariseRanked({ items: [{ battleType: "homeVillage", stars: 3 }] });
    assert.strictEqual(s.hasData, false);
  });
  test("unparseable timestamps do not throw", () => {
    const s = summariseRanked({
      items: [{ battleType: "ranked", attack: true, stars: 2, destructionPercentage: 80, battleTimestamp: "nonsense" }],
    });
    assert.strictEqual(s.attackCount, 1);
    assert.strictEqual(s.windowStart, null);
  });
}

console.log("server-side trim");
{
  // Both server.js and lambda/index.mjs strip battle logs down to ranked/legend
  // rows and the fields below, to stay under API Gateway's 6MB response limit.
  // If summariseRanked ever reads a field this trim drops, production silently
  // scores differently from a raw log. This test is what catches that.
  const KEPT = ["battleType", "attack", "stars", "destructionPercentage",
    "battleTimestamp", "opponentName", "opponentPlayerTag", "opponentTownHallLevel"];

  const trim = (json) => ({
    items: (json.items || [])
      .filter((b) => b.battleType === "ranked" || b.battleType === "legend")
      .map((b) => Object.fromEntries(KEPT.map((k) => [k, b[k]]))),
  });

  test("trimming does not change the summary", () => {
    const full = summariseRanked(fixture("battlelog-ranked.json"));
    const lean = summariseRanked(trim(fixture("battlelog-ranked.json")));
    assert.deepStrictEqual(
      { net: lean.netTrophies, atk: lean.attackCount, def: lean.defenseCount },
      { net: full.netTrophies, atk: full.attackCount, def: full.defenseCount });
    assert.deepStrictEqual(lean.battles.map((b) => b.trophyChange),
      full.battles.map((b) => b.trophyChange));
  });

  test("trimming preserves the legend-type summary too", () => {
    const full = summariseRanked(fixture("battlelog-legend.json"));
    const lean = summariseRanked(trim(fixture("battlelog-legend.json")));
    assert.strictEqual(lean.netTrophies, full.netTrophies);
    assert.strictEqual(lean.attackCount, full.attackCount);
  });
}

console.log("stored history round-trip");
{
  // scripts/collect-battles.mjs writes terse rows; fromStoredRows expands them
  // back so summariseRanked cannot tell stored history from a live API response.
  // If the two ever disagree, a clan with collected history would score
  // differently from one without — the bug this test exists to catch.
  const { fromStoredRows, groupStoredByPlayer } = require("../js/battlelog.js");

  const live = fixture("battlelog-ranked.json");
  const asRows = live.items
    .filter((b) => b.battleType === "ranked" || b.battleType === "legend")
    .map((b) => ({
      t: "#P9UQVUJJ0",
      d: b.battleTimestamp,
      k: b.battleType === "legend" ? "l" : "r",
      a: b.attack ? 1 : 0,
      s: b.stars,
      p: b.destructionPercentage,
    }));

  test("stored rows summarise identically to the live response", () => {
    const fromLive = summariseRanked(live);
    const fromStored = summariseRanked(fromStoredRows(asRows));
    assert.strictEqual(fromStored.netTrophies, fromLive.netTrophies);
    assert.strictEqual(fromStored.attackCount, fromLive.attackCount);
    assert.strictEqual(fromStored.defenseCount, fromLive.defenseCount);
    assert.deepStrictEqual(fromStored.battles.map((b) => b.trophyChange),
      fromLive.battles.map((b) => b.trophyChange));
  });

  test("legend rows survive the round-trip as legend", () => {
    const s = summariseRanked(fromStoredRows([
      { t: "#X", d: "20260815T120000.000Z", k: "l", a: 0, s: 0, p: 0 },
    ]));
    // A 0-star defense costs nothing in Legend but gives the defender the full
    // pool in Ranked — so a mislabelled type would show up as +40 here.
    assert.strictEqual(s.battles[0].trophyChange, 0);
    assert.strictEqual(s.battles[0].isLegendLeague, true);
  });

  test("grouping splits rows by player tag", () => {
    const g = groupStoredByPlayer({ battles: [
      { t: "#A", d: "20260815T120000.000Z", k: "r", a: 1, s: 3, p: 100 },
      { t: "#B", d: "20260815T130000.000Z", k: "r", a: 1, s: 1, p: 40 },
      { t: "#A", d: "20260815T140000.000Z", k: "r", a: 1, s: 2, p: 80 },
    ]});
    assert.strictEqual(g.get("#A").items.length, 2);
    assert.strictEqual(g.get("#B").items.length, 1);
  });

  test("missing or empty history is inert", () => {
    assert.deepStrictEqual(fromStoredRows(null), { items: [] });
    assert.strictEqual(groupStoredByPlayer(null).size, 0);
    assert.strictEqual(groupStoredByPlayer({ battles: [] }).size, 0);
  });
}

console.log(failures ? `\n${failures} test(s) failed` : "\nAll tests passed");
process.exit(failures ? 1 : 0);
