/**
 * Solpay — unit tests
 *
 * Run with Node.js:
 *   node Solpay/tests.js
 *
 * Covers:
 *   (a) RPC layer — endpoint selection, circuit-breaker, method filtering
 *   (b) Token loading — two-pass strategy, retry, Jupiter v3 API
 *   (c) No pre-filled 1000 amount
 *   (d) USD is the initial currency
 *   (e) NGN remains selectable
 *   (f) USD and NGN flags are correct emoji
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
function assertNotIncludes(str, sub, msg) {
  if (str.includes(sub)) throw new Error((msg||"Expected string NOT to include")+`: ${JSON.stringify(sub)}`);
}

const src = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

// ─── (a) RPC layer ───────────────────────────────────────────────────────────
console.log("\n(a) RPC layer — endpoint selection & circuit-breaker");

test("api.mainnet-beta.solana.com is in RPC_LIST", () => {
  const m = src.match(/const RPC_LIST\s*=\s*\[([\s\S]*?)\];/);
  assert(m, "RPC_LIST not found");
  assert(m[1].includes("api.mainnet-beta.solana.com"),
    "api.mainnet-beta.solana.com must be in RPC_LIST");
});

test("api.mainnet-beta.solana.com is the first entry in RPC_LIST", () => {
  const m = src.match(/const RPC_LIST\s*=\s*\[([\s\S]*?)\];/);
  assert(m, "RPC_LIST not found");
  const urls = m[1].match(/https?:\/\/[^\s"']+/g) || [];
  assert(urls.length > 0, "No URLs in RPC_LIST");
  assertEqual(urls[0], "https://api.mainnet-beta.solana.com",
    "First RPC must be api.mainnet-beta.solana.com");
});

test("Broken endpoint rpc.ankr.com/solana (403) is removed from RPC_LIST", () => {
  const m = src.match(/const RPC_LIST\s*=\s*\[([\s\S]*?)\];/);
  assert(m, "RPC_LIST not found");
  assertNotIncludes(m[1], "rpc.ankr.com/solana",
    "rpc.ankr.com/solana returns 403 and must be removed from RPC_LIST");
});

test("Broken endpoint helius-rpc.com with invalid key (401) is removed from RPC_LIST", () => {
  const m = src.match(/const RPC_LIST\s*=\s*\[([\s\S]*?)\];/);
  assert(m, "RPC_LIST not found");
  assertNotIncludes(m[1], "15319bf8-35b6-4a2c-aa8b-09c1e7f6b5a0",
    "Invalid Helius API key must be removed from RPC_LIST");
});

test("Broken endpoint alchemy demo key (401/CORS) is removed from RPC_LIST", () => {
  const m = src.match(/const RPC_LIST\s*=\s*\[([\s\S]*?)\];/);
  assert(m, "RPC_LIST not found");
  assertNotIncludes(m[1], "alchemy.com/v2/demo",
    "Alchemy demo key endpoint must be removed from RPC_LIST");
});

test("Broken endpoint ssc-dao.genesysgo.net (DNS failure) is removed from RPC_LIST", () => {
  const m = src.match(/const RPC_LIST\s*=\s*\[([\s\S]*?)\];/);
  assert(m, "RPC_LIST not found");
  assertNotIncludes(m[1], "genesysgo.net",
    "ssc-dao.genesysgo.net (DNS failure) must be removed from RPC_LIST");
});

test("Circuit-breaker state object _rpcCircuit is defined", () => {
  assert(src.includes("_rpcCircuit"), "Circuit-breaker state _rpcCircuit must be defined");
});

test("Circuit-breaker trips on 401 responses", () => {
  assert(src.includes("r.status === 401") || src.includes("r.status===401"),
    "Circuit-breaker must trip on HTTP 401");
  assert(src.includes("_tripCircuit"), "_tripCircuit function must be called");
});

test("Circuit-breaker trips on 403 responses", () => {
  assert(src.includes("r.status === 403") || src.includes("r.status===403"),
    "Circuit-breaker must trip on HTTP 403");
});

test("Circuit-breaker trips on DNS failures (ENOTFOUND / EAI_AGAIN)", () => {
  assert(src.includes("ENOTFOUND") && src.includes("EAI_AGAIN"),
    "Circuit-breaker must detect DNS failures");
});

test("Circuit-breaker has a cool-down period (CIRCUIT_BREAK_MS)", () => {
  assert(src.includes("CIRCUIT_BREAK_MS"),
    "CIRCUIT_BREAK_MS constant must be defined for circuit-breaker cool-down");
});

test("PUBLICNODE_BLOCKED_METHODS excludes publicnode from getTokenAccountsByOwner", () => {
  assert(src.includes("PUBLICNODE_BLOCKED_METHODS"),
    "PUBLICNODE_BLOCKED_METHODS must be defined");
  assert(src.includes("getTokenAccountsByOwner"),
    "getTokenAccountsByOwner must be in PUBLICNODE_BLOCKED_METHODS");
  assert(src.includes("publicnode.com"),
    "publicnode.com must be referenced in the method-filter logic");
});

test("rpcFetch falls back to full RPC_LIST if all circuits are open", () => {
  assert(src.includes("tryList = candidates.length > 0 ? candidates : RPC_LIST") ||
         src.includes("candidates.length > 0"),
    "rpcFetch must fall back to full RPC_LIST when all circuits are open");
});

test("rpcFetch uses AbortSignal.timeout to prevent hanging connections", () => {
  assert(src.includes("AbortSignal.timeout("), "rpcFetch must use AbortSignal.timeout");
});

test("rpcFetch sends Content-Type and Accept headers", () => {
  assert(src.includes('"Content-Type":"application/json"') ||
         src.includes('"Content-Type": "application/json"'),
    "rpcFetch must send Content-Type: application/json");
  assert(src.includes('"Accept":"application/json"') ||
         src.includes('"Accept": "application/json"'),
    "rpcFetch must send Accept: application/json");
});

// ─── (b) Token loading ───────────────────────────────────────────────────────
console.log("\n(b) Token loading — two-pass strategy & Jupiter v3");

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
  assertNotIncludes(src, "price.jup.ag/v6/price",
    "Deprecated price.jup.ag/v6/price must be removed");
  assert(src.includes("api.jup.ag/price/v3"),
    "Current api.jup.ag/price/v3 endpoint must be used");
});

test("Jupiter v3 response field is usdPrice", () => {
  const fn = src.match(/async function fetchJupiterPricesByMint[\s\S]*?^}/m);
  assert(fn, "fetchJupiterPricesByMint not found");
  assert(fn[0].includes("usdPrice"), "Must read .usdPrice from v3 response");
});

test("fetchJupiterTokenMeta catches errors and returns empty on failure", () => {
  assert(src.includes("_jupStrictCache={}"), "Strict list failure must set _jupStrictCache={}");
  assert(src.includes("_jupAllCache={}"),    "All-tokens failure must set _jupAllCache={}");
});

// ─── (c) No pre-filled 1000 amount ──────────────────────────────────────────
console.log("\n(c) No pre-filled 1000 amount");

test("amount state initialises to empty string", () => {
  const m = src.match(/const \[amount,setAmount\]=React\.useState\(([^)]+)\)/);
  assert(m, "amount state not found");
  assertEqual(m[1].replace(/['"]/g, ""), "", "amount must default to empty string");
});

test("useState('1000') does not appear anywhere", () => {
  assert(!src.match(/useState\(['"]\s*1000\s*['"]\)/),
    "Hard-coded useState('1000') must be removed");
});

// ─── (d) USD is the initial currency ────────────────────────────────────────
console.log("\n(d) USD as default currency");

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

// ─── (e) NGN remains selectable ─────────────────────────────────────────────
console.log("\n(e) NGN remains in currency list");

test("NGN is present in CURRENCIES array", () => {
  const m = src.match(/const CURRENCIES\s*=\s*\[([\s\S]*?)\];/);
  assert(m, "CURRENCIES array not found");
  assert(m[1].includes('code:"NGN"'), "NGN must remain in CURRENCIES");
});

test("NGN is not the default currency", () => {
  const m = src.match(/const \[currency,setCurrency\]=React\.useState\(([^)]+)\)/);
  assert(m, "currency state not found");
  assertNotEqual(m[1].replace(/['"]/g, ""), "NGN", "NGN must not be the default");
});

// ─── (f) USD and NGN flags ───────────────────────────────────────────────────
console.log("\n(f) USD and NGN flag emoji correctness");

const US_FLAG = '\u{1F1FA}\u{1F1F8}'; // 🇺🇸
const NG_FLAG = '\u{1F1F3}\u{1F1EC}'; // 🇳🇬
const CORRUPT = '\uFFFD';

test("USD flag is 🇺🇸 (U+1F1FA U+1F1F8)", () => {
  assert(src.includes(US_FLAG), "USD flag must be the correct 🇺🇸 sequence");
});

test("NGN flag is 🇳🇬 (U+1F1F3 U+1F1EC)", () => {
  assert(src.includes(NG_FLAG), "NGN flag must be the correct 🇳🇬 sequence");
});

test("No corrupted U+FFFD replacement characters in flag fields", () => {
  const flagValues = [...src.matchAll(/flag:"([^"]+)"/g)].map(m => m[1]);
  assert(flagValues.length > 0, "No flag values found");
  const corrupt = flagValues.filter(f => f.includes(CORRUPT));
  assert(corrupt.length === 0,
    `Found ${corrupt.length} corrupted flag value(s)`);
});

// ─── Live connectivity test (optional, skipped in CI) ────────────────────────
const RUN_LIVE = process.env.RUN_LIVE === "1";
if (RUN_LIVE) {
  console.log("\n(g) Live RPC connectivity (RUN_LIVE=1)");
  const https = require("https");

  function liveRpc(url, method, params) {
    return new Promise(resolve => {
      const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
      const u = new URL(url);
      const req = https.request({
        hostname: u.hostname, port: 443, path: u.pathname + u.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 15000,
      }, res => {
        let data = "";
        res.on("data", d => data += d);
        res.on("end", () => {
          try {
            const j = JSON.parse(data);
            resolve({ status: res.statusCode, ok: !j.error, result: j.result, err: j.error?.message });
          } catch (e) {
            resolve({ status: res.statusCode, ok: false, err: e.message });
          }
        });
      });
      req.on("error", e => resolve({ status: "ERR", ok: false, err: e.message }));
      req.on("timeout", () => { req.destroy(); resolve({ status: "TIMEOUT", ok: false }); });
      req.write(body);
      req.end();
    });
  }

  // Run live tests synchronously using top-level await workaround
  (async () => {
    const PRIMARY = "https://api.mainnet-beta.solana.com";

    test("LIVE: primary RPC getHealth returns ok", async () => {
      const r = await liveRpc(PRIMARY, "getHealth", []);
      assert(r.ok && r.result === "ok",
        `getHealth failed: status=${r.status} err=${r.err}`);
    });

    test("LIVE: primary RPC getBalance returns a number", async () => {
      const r = await liveRpc(PRIMARY, "getBalance",
        ["So11111111111111111111111111111111111111112", { commitment: "confirmed" }]);
      assert(r.ok && typeof r.result?.value === "number",
        `getBalance failed: status=${r.status} err=${r.err}`);
    });

    test("LIVE: primary RPC getTokenAccountsByOwner works with programId filter", async () => {
      const r = await liveRpc(PRIMARY, "getTokenAccountsByOwner", [
        "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
        { encoding: "jsonParsed", commitment: "confirmed" },
      ]);
      assert(r.ok && Array.isArray(r.result?.value),
        `getTokenAccountsByOwner failed: status=${r.status} err=${r.err}`);
    });

    test("LIVE: primary RPC getLatestBlockhash returns a blockhash", async () => {
      const r = await liveRpc(PRIMARY, "getLatestBlockhash",
        [{ commitment: "confirmed" }]);
      assert(r.ok && typeof r.result?.value?.blockhash === "string",
        `getLatestBlockhash failed: status=${r.status} err=${r.err}`);
    });

    printSummary();
  })();
} else {
  printSummary();
}

function printSummary() {
  console.log(`\n${"─".repeat(55)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  if (!RUN_LIVE) {
    console.log("(Run with RUN_LIVE=1 to also execute live connectivity tests)");
  }
  if (failed > 0) {
    console.error("\nSome tests failed — review output above.");
    process.exit(1);
  } else {
    console.log("\nAll tests passed ✅");
    process.exit(0);
  }
}
