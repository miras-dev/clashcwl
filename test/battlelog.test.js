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

console.log(failures ? `\n${failures} test(s) failed` : "\nAll tests passed");
process.exit(failures ? 1 : 0);
