/* Ranked League tiers — the game's own ladder from GET /leaguetiers.
 *
 * 37 rungs, Unranked (105000000) to Legend I (105000036), and the id encodes the
 * position: `id - 105000000` is the rank. That makes cross-player comparison
 * ordinal and exact — Legend III outranks Electro 33 by id alone, no thresholds
 * needed.
 *
 * What the endpoint does NOT give is trophy cutoffs per tier, so trophies and
 * placement are only comparable BETWEEN players when the tier matches. Rank on
 * the tier first; use trophies to break ties inside one tier.
 *
 * The table is inlined rather than fetched because the pages load as plain
 * scripts with no build step, and a badge that pops in after a round-trip is
 * worse than one that is simply there. data/leaguetiers.json holds the verbatim
 * API response this was generated from — re-fetch that endpoint and regenerate
 * if Supercell ever changes the ladder.
 *
 * Icons are hosted by Supercell on api-assets.clashofclans.com; only the hash
 * varies per tier, so rows carry the hash and the URLs are rebuilt from it.
 */
(function (root) {
"use strict";

const BASE_ID = 105000000;
const ICON_BASE = "https://api-assets.clashofclans.com/leaguetiers";

/* [id, name, icon hash] in ladder order. */
const TIERS = [
  [105000000, "Unranked", "yyYo5DUFeFBZvmMEQh0ZxvG-1sUOZ_S3kDMB7RllXX0"],
  [105000001, "Skeleton League 1", "CiSJYHyhMuloCpIIJ3n5-xCnRWrEd9vcq_zu6Ahkl3o"],
  [105000002, "Skeleton League 2", "CmM-Tihn6ojPGJstmTK_HC-QairrpYLyRhdKhQjkacQ"],
  [105000003, "Skeleton League 3", "YMnWU25Xs2SvtAkVS2WDDbcUQY-PTfCK9OSvCKJnwJU"],
  [105000004, "Barbarian League 4", "CoTrW7nhyiNIDCI4WHUK-0BuhOxibwd_tfASdtmMWFE"],
  [105000005, "Barbarian League 5", "7Alm6gwA1lYoRn5m8vrXAfbTKIK2fFU7OxfYhYwWJYM"],
  [105000006, "Barbarian League 6", "pQHVG1p0IboE8Ggp0U1YR7U8dWhVn4YSS1zSPH61F0I"],
  [105000007, "Archer League 7", "x1c7byHQmOHQVKGxAn1sqOW2XOCzTYW-e6OKjq-FBco"],
  [105000008, "Archer League 8", "lzneKpnJ_ADL1Xb1rceH7-svqRN1UaLnI7ldd8BbyxI"],
  [105000009, "Archer League 9", "ieEdz9Mqbo7g9iJfXwTnIh7Iwz-37aPEmWma1ENEwXE"],
  [105000010, "Wizard League 10", "3kJYaYpDwKF8AEkwRLkm-947_t2mAhpEQcZJYulPPIA"],
  [105000011, "Wizard League 11", "XazuJHG2wjBq39KEA4g4hh1nKJQwVO0fRoVDPHvWwAY"],
  [105000012, "Wizard League 12", "A_ZoGbh1g8wYRWygsQ_wMgbVz8GXvvfavKwlSx8C8PQ"],
  [105000013, "Valkyrie League 13", "6BwmbzkNm6p2unZonTauFQ_683uNl4NYtoOXJmEs78c"],
  [105000014, "Valkyrie League 14", "7AbbZbiV6whmfa6CZtqt6Ml4NgFH1B-UqCxc59ziqfk"],
  [105000015, "Valkyrie League 15", "vT-0ssHYx5zJbBbbjB5NHPXnlHk76MDxJmG7iKmghc4"],
  [105000016, "Witch League 16", "a3zg3PSqri2WrWD8tGzKs0hJ5OrND1Rx1SJ45f5O0gE"],
  [105000017, "Witch League 17", "3mEMvpajLceJ3EKu7u_JIh_cOEsT7wyh701zum9hqCY"],
  [105000018, "Witch League 18", "GeLamlTvRYNnZp5lEW64pyaORN30rCdrxTjU7oJoTN8"],
  [105000019, "Golem League 19", "yS8XBv_a_SNtCpcofsWMFaojRNwO504Py7HyDCBCjYU"],
  [105000020, "Golem League 20", "uizNRh8glQZuAbLdCa-EQSf3oJnge3nqoXHjtQ6O8pw"],
  [105000021, "Golem League 21", "WkqDvnK0CXI-Nc0TNTKG_fSuzRYoLRC54HFOdMCxVTI"],
  [105000022, "P.E.K.K.A League 22", "iTWXPUUFQy0uEb7NDpMTyzGMFOJvlC4SLAqlHYgC8do"],
  [105000023, "P.E.K.K.A League 23", "0eDMQmsiZ0gs8xzViGfVETnYjwzgELTKwYhH3izevT4"],
  [105000024, "P.E.K.K.A League 24", "vxV7LI0votsz0_n-8lW-Lag96D5HwKsEgEk_7247zC4"],
  [105000025, "Titan League 25", "JLqVXdNkAGjD_yqMRDgu9KK-hDrulNPjsKU4EugHqX8"],
  [105000026, "Titan League 26", "yIfqSgrhiYRcuMbAPCoeCj1FTmfylCLxnrAljEZc8K0"],
  [105000027, "Titan League 27", "1AhObOl55grQIWnGmn1J9qMWq5pmRA3aBObfYkQEjko"],
  [105000028, "Dragon League 28", "YCZ7O_3_c8eCBYvX-92qiWeLc6Md6eNJ5A8O-2vUg7I"],
  [105000029, "Dragon League 29", "DIMeRH3N4lrNObA3zAmk_eUin8nvNeLR89qYznnA--s"],
  [105000030, "Dragon League 30", "g7m9aF8YoYj9b0olPsyT4eUIxyYEmkqr53wYxWmzpE4"],
  [105000031, "Electro League 31", "qVORiRguZ-xMq8L0g7rE1-rZuiA-lKlI8VKuMndRy4w"],
  [105000032, "Electro League 32", "iX8uNhG6jBcQATWFS8a0gtidGy9O1PRYtXZZMTtUK3U"],
  [105000033, "Electro League 33", "VFqkaQimExWtSmIf9PC8WEpj4Vd58oLjPWyZqfVb5VE"],
  [105000034, "Legend III", "BvEu_UE53UzADvTRiU9AdyOrlvb1RqvBmMau_uX6xm0"],
  [105000035, "Legend II", "2fQPjjBJCXzHdYY8Eul4DQUBB232Bhiw5KPv6TOLMgQ"],
  [105000036, "Legend I", "s5Y12RDRg7tgznd2RwU9kgLbedC5Not4peiHfOaWfJo"],
];

const byId = new Map();
const byName = new Map();
const LIST = TIERS.map(([id, name, hash], rank) => {
  const tier = {
    id, name, rank,
    iconUrls: {
      small: `${ICON_BASE}/125/${hash}.png`,
      large: `${ICON_BASE}/326/${hash}.png`,
    },
  };
  byId.set(id, tier);
  byName.set(name.toLowerCase(), tier);
  return tier;
});

/* Resolve whatever a caller has — the numeric id, the tier name, a rank 0-36, or
   the API's `{ id, name }` object — to the tier record, or null.

   Accepting all four matters because the shapes genuinely differ by source:
   /players/{tag} returns an object, clan-deep flattens it to a name string, and
   leaguehistory carries a bare `leagueTierId`. */
function resolve(tier) {
  if (tier == null) return null;
  if (typeof tier === "object") {
    if (typeof tier.id === "number" && byId.has(tier.id)) return byId.get(tier.id);
    tier = tier.name;
  }
  if (typeof tier === "number") {
    if (byId.has(tier)) return byId.get(tier);
    return LIST[tier] || null;              // already a rank
  }
  const found = byName.get(String(tier).toLowerCase().trim());
  return found || null;
}

/* Ladder position 0-36, or null when the tier is unknown. */
function rankOf(tier) {
  const t = resolve(tier);
  return t ? t.rank : null;
}

function nameOf(tier) {
  const t = resolve(tier);
  return t ? t.name : null;
}

function iconOf(tier, size) {
  const t = resolve(tier);
  return t ? (size === "large" ? t.iconUrls.large : t.iconUrls.small) : null;
}

const api = { BASE_ID, LIST, resolve, rankOf, nameOf, iconOf };

root.LeagueTiers = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;

})(typeof globalThis !== "undefined" ? globalThis : this);
