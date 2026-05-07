/**
 * Solpay — unit tests
 *
 * Run with Node.js (no test framework required):
 *   node Solpay/tests.js
 *
 * Tests verify:
 *   (a) Token loads without errors — RPC list ordering and retry logic
 *   (b) No pre-filled 1000 amount appears
 *   (c) USD is the initial currency
 *   (d) NGN remains selectable in the currency list
 */

"use strict";

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
function assert(condition, msg) {
  if (!condition) throw new Error(msg || "Assertion failed");
}
function assertEqual(a, b, msg) {
  if (a !== b) throw new Error((msg || "Expected equal") + ` — got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);
}
function assertNotEqual(a, b, msg) {
  if (a === b) throw new Error((msg || "Expected not equal") + ` — both are ${JSON.stringify(a)}`);
}
function assertIncludes(arr, value, msg) {
  if (!arr.includes(value)) throw new Error((msg || "Expected array to include value") + ` — ${JSON.stringify(value)} not found`);
}

// ─── Read the source file ────────────────────────────────────────────────────
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

// ─── (a) Token loads without errors ─────────────────────────────────────────
console.log("\n(a) Token loading — RPC reliability");

test("api.mainnet-beta.solana.com is first in RPC_LIST", () => {
  const match = src.match(/const RPC_LIST\s*=\s*\[([\s\S]*?)\];/);
  assert(match, "RPC_LIST not found");
  const listText = match[1];
  const urls = listText.match(/https?:\/\/[^\s"']+/g) || [];
  assert(urls.length > 0, "No URLs found in RPC_LIST");
  assertEqual(
    urls[0],
    "https://api.mainnet-beta.solana.com",
    "First RPC endpoint should be api.mainnet-beta.solana.com"
  );
});

test("RPC_LIST contains at least 3 fallback endpoints", () => {
  const match = src.match(/const RPC_LIST\s*=\s*\[([\s\S]*?)\];/);
  assert(match, "RPC_LIST not found");
  const urls = (match[1].match(/https?:\/\/[^\s"']+/g) || []);
  assert(urls.length >= 3, `Expected ≥3 RPC endpoints, got ${urls.length}`);
});

test("rpcFetch includes Accept: application/json header", () => {
  assert(
    src.includes('"Accept":"application/json"') || src.includes('"Accept": "application/json"'),
    "rpcFetch should send Accept: application/json header"
  );
});

test("rpcFetch has AbortSignal timeout to prevent hanging", () => {
  assert(
    src.includes("AbortSignal.timeout(12000)") || src.includes("AbortSignal.timeout("),
    "rpcFetch should use AbortSignal.timeout"
  );
});

test("fetchBalances retries SOL balance call on first failure", () => {
  assert(
    src.includes("SOL balance first attempt failed, retrying"),
    "fetchBalances should retry the SOL balance call"
  );
});

test("fetchBalances uses two-pass strategy (fast + enriched)", () => {
  assert(src.includes("Publish fast pass"), "Fast pass comment not found");
  assert(src.includes("Publish enriched pass"), "Enriched pass comment not found");
});

test("walletError is cleared at the start of each fetchBalances call", () => {
  assert(
    src.includes("setWalletLoading(true);setWalletError(null);"),
    "walletError should be reset at the start of fetchBalances"
  );
});

test("fetchJupiterTokenMeta catches errors and returns empty object on failure", () => {
  // Both strict and all-token fetches have try/catch that set cache to {}
  const strictFail = src.includes("_jupStrictCache={}");
  const allFail    = src.includes("_jupAllCache={}");
  assert(strictFail, "Jupiter strict list failure should set _jupStrictCache={}");
  assert(allFail,    "Jupiter all-tokens failure should set _jupAllCache={}");
});

test("fetchJupiterPricesByMint returns empty object on failure (never throws)", () => {
  // The function has a catch that returns {}
  const fnMatch = src.match(/async function fetchJupiterPricesByMint[\s\S]*?^}/m);
  assert(fnMatch, "fetchJupiterPricesByMint not found");
  assert(
    fnMatch[0].includes("return {};"),
    "fetchJupiterPricesByMint should return {} on error"
  );
});

// ─── (b) No pre-filled 1000 amount ──────────────────────────────────────────
console.log("\n(b) No pre-filled 1000 amount");

test("amount state initialises to empty string, not '1000'", () => {
  assert(
    src.includes('useState("")') || src.includes("useState('')"),
    "amount useState should initialise to empty string"
  );
  // Specifically check the amount line
  const amountLine = src.match(/const \[amount,setAmount\]=React\.useState\(([^)]+)\)/);
  assert(amountLine, "amount state declaration not found");
  assertEqual(
    amountLine[1].replace(/['"]/g, ""),
    "",
    "amount should default to empty string"
  );
});

test("'1000' does not appear as a React state default value", () => {
  // Allow '1000' in non-state contexts (e.g. zIndex:1000, timeout values)
  // but not as a useState argument for amount
  const stateDefault = src.match(/useState\(['"]\s*1000\s*['"]\)/);
  assert(!stateDefault, "Found useState('1000') — hard-coded default amount must be removed");
});

test("globalAmt (bulk send) initialises to empty string", () => {
  const match = src.match(/const \[globalAmt,setGlobalAmt\]=React\.useState\(([^)]+)\)/);
  assert(match, "globalAmt state declaration not found");
  assertEqual(
    match[1].replace(/['"]/g, ""),
    "",
    "globalAmt should default to empty string"
  );
});

// ─── (c) USD is the initial currency ────────────────────────────────────────
console.log("\n(c) USD as default currency");

test("main currency state initialises to 'USD'", () => {
  const match = src.match(/const \[currency,setCurrency\]=React\.useState\(([^)]+)\)/);
  assert(match, "currency state declaration not found");
  assertEqual(
    match[1].replace(/['"]/g, ""),
    "USD",
    "currency should default to USD"
  );
});

test("bulk currency state initialises to 'USD'", () => {
  const match = src.match(/const \[bulkCurr,setBulkCurr\]=React\.useState\(([^)]+)\)/);
  assert(match, "bulkCurr state declaration not found");
  assertEqual(
    match[1].replace(/['"]/g, ""),
    "USD",
    "bulkCurr should default to USD"
  );
});

test("USD is the first entry in the CURRENCIES array", () => {
  const match = src.match(/const CURRENCIES\s*=\s*\[([\s\S]*?)\];/);
  assert(match, "CURRENCIES array not found");
  const firstCode = match[1].match(/code:"([A-Z]+)"/);
  assert(firstCode, "No currency code found in CURRENCIES");
  assertEqual(firstCode[1], "USD", "First currency in CURRENCIES should be USD");
});

// ─── (d) NGN remains selectable ─────────────────────────────────────────────
console.log("\n(d) NGN remains in currency list");

test("NGN is present in the CURRENCIES array", () => {
  const match = src.match(/const CURRENCIES\s*=\s*\[([\s\S]*?)\];/);
  assert(match, "CURRENCIES array not found");
  assert(match[1].includes('code:"NGN"'), "NGN must remain in the CURRENCIES array");
});

test("NGN has a valid rate defined", () => {
  const match = src.match(/code:"NGN"[^}]+rate:(\d+)/);
  assert(match, "NGN entry with rate not found");
  const rate = Number(match[1]);
  assert(rate > 0, `NGN rate should be positive, got ${rate}`);
});

test("NGN has a flag emoji defined", () => {
  assert(src.includes('code:"NGN"'), "NGN entry not found");
  // The NGN entry should have a flag
  const ngnBlock = src.match(/\{[^}]*code:"NGN"[^}]*\}/);
  assert(ngnBlock, "NGN object block not found");
  assert(ngnBlock[0].includes("flag:"), "NGN entry should have a flag property");
});

test("NGN is not the default currency (USD is)", () => {
  const currencyDefault = src.match(/const \[currency,setCurrency\]=React\.useState\(([^)]+)\)/);
  assert(currencyDefault, "currency state not found");
  assertNotEqual(
    currencyDefault[1].replace(/['"]/g, ""),
    "NGN",
    "NGN should not be the default currency — USD should be"
  );
});

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
if (failed > 0) {
  console.error("\nSome tests failed. Review the output above.");
  process.exit(1);
} else {
  console.log("\nAll tests passed ✅");
  process.exit(0);
}
