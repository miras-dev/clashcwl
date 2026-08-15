/* Tests for js/leaguetiers.js.
 *
 * The module inlines the ladder for the browser's sake, so the point of most of
 * these is that the inlined copy still matches data/leaguetiers.json — the
 * verbatim API response it was generated from. If Supercell changes the ladder,
 * the JSON gets re-fetched and these fail until the module is regenerated.
 *
 * Run: node test/leaguetiers.test.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const LT = require("../js/leaguetiers.js");

const raw = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "leaguetiers.json"), "utf8"));

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

console.log("the inlined ladder matches the stored API response");
{
  test("same number of tiers", () => {
    assert.strictEqual(LT.LIST.length, raw.items.length);
    assert.strictEqual(LT.LIST.length, 37);
  });

  test("ids, names and icons match item for item", () => {
    raw.items.forEach((item, i) => {
      assert.strictEqual(LT.LIST[i].id, item.id, `id at ${i}`);
      assert.strictEqual(LT.LIST[i].name, item.name, `name at ${i}`);
      assert.strictEqual(LT.LIST[i].iconUrls.small, item.iconUrls.small, `small icon at ${i}`);
      assert.strictEqual(LT.LIST[i].iconUrls.large, item.iconUrls.large, `large icon at ${i}`);
    });
  });

  // The whole ordinal scheme rests on this: the id IS the rank. If Supercell
  // ever inserts a tier mid-ladder without renumbering, `id - BASE_ID` stops
  // being the ladder position and every league comparison silently skews.
  test("id encodes the ladder position", () => {
    LT.LIST.forEach((t, i) => {
      assert.strictEqual(t.id - LT.BASE_ID, i, `${t.name} should be rank ${i}`);
      assert.strictEqual(t.rank, i);
    });
  });

  test("the ladder runs Unranked to Legend I", () => {
    assert.strictEqual(LT.LIST[0].name, "Unranked");
    assert.strictEqual(LT.LIST[36].name, "Legend I");
    // Legend counts DOWN — III is the entry rung, I is the top.
    assert.ok(LT.rankOf("Legend I") > LT.rankOf("Legend II"));
    assert.ok(LT.rankOf("Legend II") > LT.rankOf("Legend III"));
    assert.ok(LT.rankOf("Legend III") > LT.rankOf("Electro League 33"));
  });
}

// The four shapes are not hypothetical: /players/{tag} returns an object,
// clan-deep flattens it to a name, leaguehistory carries a bare id, and the
// scoring code passes ranks around internally.
console.log("resolve accepts every shape the API hands us");
{
  test("numeric id", () => {
    assert.strictEqual(LT.rankOf(105000034), 34);
    assert.strictEqual(LT.nameOf(105000034), "Legend III");
  });

  test("tier name, case and whitespace insensitive", () => {
    assert.strictEqual(LT.rankOf("Legend III"), 34);
    assert.strictEqual(LT.rankOf("  legend iii  "), 34);
    assert.strictEqual(LT.rankOf("ELECTRO LEAGUE 33"), 33);
  });

  test("the API's { id, name } object", () => {
    assert.strictEqual(LT.rankOf({ id: 105000031, name: "Electro League 31" }), 31);
    // The id wins when both are present, since it is the authoritative field.
    assert.strictEqual(LT.nameOf({ id: 105000036, name: "stale name" }), "Legend I");
  });

  test("a bare rank passes through", () => {
    assert.strictEqual(LT.rankOf(0), 0);
    assert.strictEqual(LT.rankOf(36), 36);
    assert.strictEqual(LT.nameOf(34), "Legend III");
  });

  // An unknown league is a real state — clan-deep returns null for players the
  // API has no league for — so it must resolve to null, not throw and not 0.
  // Unranked is a genuine tier and must never be the fallback for "unknown".
  test("unknown input is null, never a bogus rank", () => {
    assert.strictEqual(LT.rankOf(null), null);
    assert.strictEqual(LT.rankOf(undefined), null);
    assert.strictEqual(LT.rankOf(""), null);
    assert.strictEqual(LT.rankOf("Nonsense League 99"), null);
    assert.strictEqual(LT.rankOf(999999999), null);
    assert.strictEqual(LT.nameOf(null), null);
    assert.strictEqual(LT.iconOf(null), null);
    assert.strictEqual(LT.resolve({}), null);
  });

  test("Unranked resolves as a real tier at rank 0", () => {
    assert.strictEqual(LT.rankOf("Unranked"), 0);
    assert.notStrictEqual(LT.resolve("Unranked"), null);
  });
}

console.log("icons");
{
  test("both sizes resolve and differ", () => {
    const small = LT.iconOf("Legend I");
    const large = LT.iconOf("Legend I", "large");
    assert.ok(/^https:\/\/api-assets\.clashofclans\.com\/leaguetiers\/125\/.+\.png$/.test(small), small);
    assert.ok(/^https:\/\/api-assets\.clashofclans\.com\/leaguetiers\/326\/.+\.png$/.test(large), large);
  });

  test("every tier has a distinct icon", () => {
    const seen = new Set(LT.LIST.map(t => t.iconUrls.small));
    assert.strictEqual(seen.size, LT.LIST.length, "icon hashes must be unique per tier");
  });
}

console.log(failures ? `\n${failures} failing` : "\nAll tests passed");
process.exit(failures ? 1 : 0);
