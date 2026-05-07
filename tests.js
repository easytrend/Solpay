/**
 * Solpay — unit tests
 *
 * Run with Node.js:
 *   node Solpay/tests.js
 *
 * Covers:
 *   (a) Token loads without errors — RPC ordering, retry, Jupiter v3 API
 *   (b) No pre-filled 1000 amount
 *   (c) USD is the initial currency
 *   (d) NGN remains selectable
 *   (e) USD and NGN flags are correct emoji (not corrupted replacement chars)
 */

"use strict";

const fs   = require("fs");
const path = require("path");

// ─── Minimal test harness ────────────────────────────────────────────────────
let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log("  ✅ PASS:", name);
    passed++;
  } catch (e) {
    console.error("  ❌ FAIL:", name);
    console.error("       →", e.message);
    failed++;
  }
}
function assert(cond, msg)    { if (!cond) throw new Error(msg || "Assertion failed"); }
function assertEqual(a, b, m) { if (a !== b) throw new Error((m||"Expected equal")+` — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`); }
function assertNotEqual(a, b, m) { if (a === b) throw new Error((m||"Expected not equal")+` — both are ${JSON.stringify(a)}`); }

const src = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

// ─── (a) Token loading ───────────────────────────────────────────────────────
console.log("\n(a) Token loading — RPC reliability & Jupiter v3 API");

test("api.mainnet-beta.solana.com is first in RPC_LIST", () => {
  const m = src.match(/const RPC_LIST\s*=\s*\[([\s\S]*?)\];/);
  assert(m, "RPC_LIST not found");
  const urls = m[1].match(/https?:\/\/[^\s"']+/g) || [];
  assert(urls.length > 0, "No URLs in RPC_LIST");
  assertEqual(urls[0], "https://api.mainnet-beta.solana.com",
    "First RPC should be api.mainnet-beta.solana.com");
});

test("RPC_LIST has at least 3 fallback endpoints", () => {
  const m = src.match(/const RPC_LIST\s*=\s*\[([\s\S]*?)\];/);
  assert(m, "RPC_LIST not found");
  const urls = m[1].match(/https?:\/\/[^\s"']+/g) || [];
  assert(urls.length >= 3, `Expected ≥3 endpoints, got ${urls.length}`);
});

test("rpcFetch sends Accept: application/json header", () => {
  assert(src.includes('"Accept":"application/json"') || src.includes('"Accept": "application/json"'),
    "rpcFetch must send Accept: application/json");
});

test("rpcFetch uses AbortSignal.timeout to prevent hanging", () => {
  assert(src.includes("AbortSignal.timeout("), "rpcFetch must use AbortSignal.timeout");
});

test("fetchBalances retries SOL balance on first failure", () => {
  assert(src.includes("SOL balance first attempt failed, retrying"),
    "fetchBalances must retry the SOL balance call");
});

test("fetchBalances uses two-pass strategy (fast + enriched)", () => {
  assert(src.includes("Publish fast pass"),     "Fast pass comment not found");
  assert(src.includes("Publish enriched pass"), "Enriched pass comment not found");
});

test("walletError is cleared at start of fetchBalances", () => {
  assert(src.includes("setWalletLoading(true);setWalletError(null);"),
    "walletError must be reset at start of fetchBalances");
});

test("Jupiter Price API uses v3 endpoint (not deprecated v6)", () => {
  // v6 endpoint must not appear anywhere
  assert(!src.includes("price.jup.ag/v6/price"),
    "Deprecated price.jup.ag/v6/price endpoint must be removed");
  // v3 endpoint must be present
  assert(src.includes("api.jup.ag/price/v3"),
    "Current api.jup.ag/price/v3 endpoint must be used");
});

test("Jupiter v3 response field is usdPrice (not .price)", () => {
  // The fetchJupiterPricesByMint function must read .usdPrice
  const fnMatch = src.match(/async function fetchJupiterPricesByMint[\s\S]*?^}/m);
  assert(fnMatch, "fetchJupiterPricesByMint not found");
  assert(fnMatch[0].includes("usdPrice"),
    "fetchJupiterPricesByMint must read .usdPrice from v3 response");
  assert(!fnMatch[0].includes("?.data?.["),
    "fetchJupiterPricesByMint must not use v6 .data[] response shape");
});

test("fetchJupiterPricesByMint batches requests at 50 ids", () => {
  const fnMatch = src.match(/async function fetchJupiterPricesByMint[\s\S]*?^}/m);
  assert(fnMatch, "fetchJupiterPricesByMint not found");
  assert(fnMatch[0].includes("BATCH") || fnMatch[0].includes("50"),
    "fetchJupiterPricesByMint must batch at 50 ids per request");
});

test("fetchJupiterPricesByMint has CoinGecko fallback on Jupiter failure", () => {
  const fnMatch = src.match(/async function fetchJupiterPricesByMint[\s\S]*?^}/m);
  assert(fnMatch, "fetchJupiterPricesByMint not found");
  assert(fnMatch[0].includes("coingecko.com"),
    "fetchJupiterPricesByMint must fall back to CoinGecko on Jupiter failure");
});

test("fetchJupiterPricesByMint returns {} on total failure (never throws)", () => {
  const fnMatch = src.match(/async function fetchJupiterPricesByMint[\s\S]*?^}/m);
  assert(fnMatch, "fetchJupiterPricesByMint not found");
  assert(fnMatch[0].includes("return out;") || fnMatch[0].includes("return {};"),
    "fetchJupiterPricesByMint must return an object, never throw");
});

test("fetchLiveRates Jupiter fallback also uses v3 endpoint", () => {
  assert(src.includes("api.jup.ag/price/v3"),
    "fetchLiveRates Jupiter fallback must use v3 endpoint");
  // The old v6 fallback in fetchLiveRates must be gone
  const liveRatesFn = src.match(/async function fetchLiveRates[\s\S]*?_priceCache\.ts = now;/);
  assert(liveRatesFn, "fetchLiveRates function not found");
  assert(!liveRatesFn[0].includes("price.jup.ag/v6"),
    "fetchLiveRates must not use deprecated v6 endpoint");
});

test("fetchLiveRates Jupiter fallback reads usdPrice field", () => {
  const liveRatesFn = src.match(/async function fetchLiveRates[\s\S]*?_priceCache\.ts = now;/);
  assert(liveRatesFn, "fetchLiveRates function not found");
  assert(liveRatesFn[0].includes("usdPrice"),
    "fetchLiveRates Jupiter fallback must read .usdPrice from v3 response");
});

test("fetchJupiterTokenMeta catches errors and returns empty on failure", () => {
  assert(src.includes("_jupStrictCache={}"), "Strict list failure must set _jupStrictCache={}");
  assert(src.includes("_jupAllCache={}"),    "All-tokens failure must set _jupAllCache={}");
});

// ─── (b) No pre-filled 1000 amount ──────────────────────────────────────────
console.log("\n(b) No pre-filled 1000 amount");

test("amount state initialises to empty string", () => {
  const m = src.match(/const \[amount,setAmount\]=React\.useState\(([^)]+)\)/);
  assert(m, "amount state not found");
  assertEqual(m[1].replace(/['"]/g, ""), "", "amount must default to empty string");
});

test("useState('1000') does not appear anywhere", () => {
  assert(!src.match(/useState\(['"]\s*1000\s*['"]\)/),
    "Hard-coded useState('1000') must be removed");
});

test("globalAmt (bulk send) initialises to empty string", () => {
  const m = src.match(/const \[globalAmt,setGlobalAmt\]=React\.useState\(([^)]+)\)/);
  assert(m, "globalAmt state not found");
  assertEqual(m[1].replace(/['"]/g, ""), "", "globalAmt must default to empty string");
});

// ─── (c) USD is the initial currency ────────────────────────────────────────
console.log("\n(c) USD as default currency");

test("main currency state initialises to 'USD'", () => {
  const m = src.match(/const \[currency,setCurrency\]=React\.useState\(([^)]+)\)/);
  assert(m, "currency state not found");
  assertEqual(m[1].replace(/['"]/g, ""), "USD", "currency must default to USD");
});

test("bulk currency state initialises to 'USD'", () => {
  const m = src.match(/const \[bulkCurr,setBulkCurr\]=React\.useState\(([^)]+)\)/);
  assert(m, "bulkCurr state not found");
  assertEqual(m[1].replace(/['"]/g, ""), "USD", "bulkCurr must default to USD");
});

test("USD is the first entry in CURRENCIES array", () => {
  const m = src.match(/const CURRENCIES\s*=\s*\[([\s\S]*?)\];/);
  assert(m, "CURRENCIES array not found");
  const first = m[1].match(/code:"([A-Z]+)"/);
  assert(first, "No currency code found");
  assertEqual(first[1], "USD", "First currency must be USD");
});

// ─── (d) NGN remains selectable ─────────────────────────────────────────────
console.log("\n(d) NGN remains in currency list");

test("NGN is present in CURRENCIES array", () => {
  const m = src.match(/const CURRENCIES\s*=\s*\[([\s\S]*?)\];/);
  assert(m, "CURRENCIES array not found");
  assert(m[1].includes('code:"NGN"'), "NGN must remain in CURRENCIES");
});

test("NGN has a positive rate", () => {
  const m = src.match(/code:"NGN"[^}]+rate:(\d+)/);
  assert(m, "NGN entry with rate not found");
  assert(Number(m[1]) > 0, `NGN rate must be positive, got ${m[1]}`);
});

test("NGN is not the default currency", () => {
  const m = src.match(/const \[currency,setCurrency\]=React\.useState\(([^)]+)\)/);
  assert(m, "currency state not found");
  assertNotEqual(m[1].replace(/['"]/g, ""), "NGN", "NGN must not be the default currency");
});

// ─── (e) USD and NGN flags are correct emoji ─────────────────────────────────
console.log("\n(e) USD and NGN flag emoji correctness");

// Correct regional indicator sequences
const US_FLAG = '\u{1F1FA}\u{1F1F8}'; // 🇺🇸
const NG_FLAG = '\u{1F1F3}\u{1F1EC}'; // 🇳🇬
const CORRUPT = '\uFFFD';             // replacement character (bad encoding)

test("USD flag is 🇺🇸 (U+1F1FA U+1F1F8)", () => {
  assert(src.includes(US_FLAG),
    "USD flag must be the correct 🇺🇸 regional indicator sequence");
});

test("NGN flag is 🇳🇬 (U+1F1F3 U+1F1EC)", () => {
  assert(src.includes(NG_FLAG),
    "NGN flag must be the correct 🇳🇬 regional indicator sequence");
});

test("No corrupted replacement characters (U+FFFD) in flag fields", () => {
  // Find all flag: "..." values and check none contain U+FFFD
  const flagValues = [...src.matchAll(/flag:"([^"]+)"/g)].map(m => m[1]);
  assert(flagValues.length > 0, "No flag values found in source");
  const corrupt = flagValues.filter(f => f.includes(CORRUPT));
  assert(corrupt.length === 0,
    `Found ${corrupt.length} corrupted flag value(s) — all flags must be valid emoji`);
});

test("USD flag value matches the same pattern as EUR flag (two regional indicators)", () => {
  // EUR = U+1F1EA U+1F1FA — both codepoints in range U+1F1E6..U+1F1FF
  const flagValues = [...src.matchAll(/code:"([A-Z]+)"[^}]+flag:"([^"]+)"/g)];
  const usdEntry = flagValues.find(m => m[1] === "USD");
  const eurEntry = flagValues.find(m => m[1] === "EUR");
  assert(usdEntry, "USD entry not found");
  assert(eurEntry, "EUR entry not found");
  // Both should have exactly 2 Unicode codepoints (regional indicator pairs)
  const usdCPs = [...usdEntry[2]];
  const eurCPs = [...eurEntry[2]];
  assertEqual(usdCPs.length, 2, `USD flag should have 2 codepoints, got ${usdCPs.length}`);
  assertEqual(eurCPs.length, 2, `EUR flag should have 2 codepoints, got ${eurCPs.length}`);
  // Each codepoint should be in the regional indicator range
  const isRI = cp => cp.codePointAt(0) >= 0x1F1E6 && cp.codePointAt(0) <= 0x1F1FF;
  assert(usdCPs.every(isRI), "USD flag codepoints must be regional indicators");
});

test("NGN flag value matches the same pattern as GBP flag", () => {
  const flagValues = [...src.matchAll(/code:"([A-Z]+)"[^}]+flag:"([^"]+)"/g)];
  const ngnEntry = flagValues.find(m => m[1] === "NGN");
  const gbpEntry = flagValues.find(m => m[1] === "GBP");
  assert(ngnEntry, "NGN entry not found");
  assert(gbpEntry, "GBP entry not found");
  const ngnCPs = [...ngnEntry[2]];
  const gbpCPs = [...gbpEntry[2]];
  assertEqual(ngnCPs.length, 2, `NGN flag should have 2 codepoints, got ${ngnCPs.length}`);
  assertEqual(gbpCPs.length, 2, `GBP flag should have 2 codepoints, got ${gbpCPs.length}`);
  const isRI = cp => cp.codePointAt(0) >= 0x1F1E6 && cp.codePointAt(0) <= 0x1F1FF;
  assert(ngnCPs.every(isRI), "NGN flag codepoints must be regional indicators");
});

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(55)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
if (failed > 0) {
  console.error("\nSome tests failed — review output above.");
  process.exit(1);
} else {
  console.log("\nAll tests passed ✅");
  process.exit(0);
}
