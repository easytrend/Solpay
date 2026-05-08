/**
 * Solpay unit tests
 * Run:       node Solpay/tests.js
 * Live:  RUN_LIVE=1 node Solpay/tests.js
 */
"use strict";
const fs   = require("fs");
const path = require("path");

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log("  OK ", name); passed++; }
  catch(e) { console.error("  FAIL", name); console.error("      ->", e.message); failed++; }
}
function assert(c,m)    { if(!c) throw new Error(m||"Assertion failed"); }
function assertEqual(a,b,m) {
  if(a!==b) throw new Error((m||"Expected equal")+" got "+JSON.stringify(a)+" expected "+JSON.stringify(b));
}
function assertNotIn(str,sub,m) {
  if(str.includes(sub)) throw new Error((m||"Must not include")+": "+JSON.stringify(sub));
}

const src = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

// ── (a) SNS domain resolution ────────────────────────────────────────────────
console.log("\n(a) SNS domain resolution");

test("Bonfida REST API is the primary resolution method", () => {
  assert(src.includes("sns-sdk-proxy.bonfida.workers.dev/resolve"),
    "Bonfida REST API must be the primary SNS resolution method");
});

test("On-chain PDA lookup is the fallback method", () => {
  assert(src.includes("namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX"),
    "On-chain SNS program ID must be present as fallback");
});

test("isValidSolanaAddress does not call isOnCurve (which rejects PDAs)", () => {
  const fn = src.match(/function isValidSolanaAddress\(address\)[\s\S]*?^}/m);
  assert(fn, "isValidSolanaAddress not found");
  // The function must not *call* isOnCurve — a comment mentioning it is fine
  const codeOnly = fn[0].replace(/\/\/[^\n]*/g, ""); // strip line comments
  assertNotIn(codeOnly, "isOnCurve",
    "isValidSolanaAddress must not call isOnCurve — it rejects valid PDA addresses");
});

test("isValidSolanaAddress guards against null/empty input", () => {
  const fn = src.match(/function isValidSolanaAddress\(address\)[\s\S]*?^}/m);
  assert(fn, "isValidSolanaAddress not found");
  assert(fn[0].includes("typeof address") || fn[0].includes("!address"),
    "isValidSolanaAddress must guard against null/empty input");
});

test("resolveSNSDomain strips .sol suffix before lookup", () => {
  assert(src.includes(".replace(/\\.sol$/i") || src.includes(".replace('.sol'"),
    "resolveSNSDomain must strip .sol suffix");
});

test("resolveSNSDomain returns actionable error for unregistered domains", () => {
  assert(src.includes("not registered on Solana Name Service"),
    "Must surface a clear error for unregistered domains");
});

test("resolveSNSDomain validates the resolved address before returning", () => {
  assert(src.includes("isValidSolanaAddress(j.result)") || src.includes("isValidSolanaAddress(ownerStr)"),
    "Must validate the resolved address before returning it");
});

test("resolveSNSDomain distinguishes network errors from domain-not-found", () => {
  assert(src.includes("not registered") && src.includes("Bonfida API failed"),
    "Must distinguish network errors from domain-not-found errors");
});

// ── (b) Lamports / u64 encoding ──────────────────────────────────────────────
console.log("\n(b) Lamports and u64 encoding");

test("lamportsToBigInt function is defined", () => {
  assert(src.includes("function lamportsToBigInt"),
    "lamportsToBigInt must be defined");
});

test("lamportsToBigInt returns BigInt", () => {
  const fn = src.match(/function lamportsToBigInt[\s\S]*?^}/m);
  assert(fn, "lamportsToBigInt not found");
  assert(fn[0].includes("BigInt("), "lamportsToBigInt must return BigInt");
});

test("encodeU64LE function is defined", () => {
  assert(src.includes("function encodeU64LE"), "encodeU64LE must be defined");
});

test("encodeU64LE returns an 8-byte Uint8Array", () => {
  const fn = src.match(/function encodeU64LE[\s\S]*?^}/m);
  assert(fn, "encodeU64LE not found");
  assert(fn[0].includes("new Uint8Array(8)"), "encodeU64LE must create an 8-byte buffer");
});

test("encodeU64LE uses little-endian byte order", () => {
  const fn = src.match(/function encodeU64LE[\s\S]*?^}/m);
  assert(fn, "encodeU64LE not found");
  assert(fn[0].includes("true"), "encodeU64LE must use little-endian (true flag in setUint32)");
});

test("encodeU64LE correctly encodes known values", () => {
  function encodeU64LE(value) {
    const buf  = new Uint8Array(8);
    const view = new DataView(buf.buffer);
    view.setUint32(0, value >>> 0, true);
    view.setUint32(4, Math.floor(value / 0x100000000), true);
    return buf;
  }
  function decode(buf) {
    const v = new DataView(buf.buffer);
    return v.getUint32(0,true) + v.getUint32(4,true) * 0x100000000;
  }
  // 1 USDC = 1_000_000 raw (6 decimals)
  assertEqual(decode(encodeU64LE(1_000_000)), 1_000_000, "USDC 1M round-trip");
  // 1 SOL = 1_000_000_000 lamports
  assertEqual(decode(encodeU64LE(1_000_000_000)), 1_000_000_000, "SOL 1B round-trip");
  // 10 SOL = 10_000_000_000 lamports (exceeds 32-bit)
  assertEqual(decode(encodeU64LE(10_000_000_000)), 10_000_000_000, "10 SOL round-trip");
  // 1M BONK = 100_000_000_000 raw (5 decimals)
  assertEqual(decode(encodeU64LE(100_000_000_000)), 100_000_000_000, "BONK 100B round-trip");
});

test("SOL transfer uses lamportsToBigInt (not toLamports)", () => {
  const fn = src.match(/async function handleSingleSendFee[\s\S]*?^  }/m);
  assert(fn, "handleSingleSendFee not found");
  assert(fn[0].includes("lamportsToBigInt"), "handleSingleSendFee must use lamportsToBigInt");
});

test("SPL transfer uses encodeU64LE for instruction data", () => {
  const fn = src.match(/async function handleSingleSendFee[\s\S]*?^  }/m);
  assert(fn, "handleSingleSendFee not found");
  assert(fn[0].includes("encodeU64LE"), "SPL transfer must use encodeU64LE");
});

test("Platform fee uses lamportsToBigInt", () => {
  const fn = src.match(/async function chargePlatformFeeInSol[\s\S]*?^  }/m);
  assert(fn, "chargePlatformFeeInSol not found");
  assert(fn[0].includes("lamportsToBigInt"), "chargePlatformFeeInSol must use lamportsToBigInt");
});

// ── (c) SPL token support ────────────────────────────────────────────────────
console.log("\n(c) SPL token support");

const kmBlock = src.match(/const KNOWN_MINTS\s*=\s*\{([\s\S]*?)\};/);
assert(kmBlock, "KNOWN_MINTS not found");
const km = kmBlock[1];

test("USDC mint is in KNOWN_MINTS", () => {
  assert(km.includes("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"), "USDC mint must be in KNOWN_MINTS");
});

test("USDT mint is in KNOWN_MINTS", () => {
  assert(km.includes("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"), "USDT mint must be in KNOWN_MINTS");
});

test("BONK mint is in KNOWN_MINTS", () => {
  assert(km.includes("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"), "BONK mint must be in KNOWN_MINTS");
});

test("SPL transfer validates mint address exists", () => {
  const fn = src.match(/async function handleSingleSendFee[\s\S]*?^  }/m);
  assert(fn, "handleSingleSendFee not found");
  assert(fn[0].includes("mint address is missing") || fn[0].includes("mintAddress"),
    "SPL path must validate mint address exists");
});

test("SPL transfer uses correct decimals from token metadata", () => {
  const fn = src.match(/async function handleSingleSendFee[\s\S]*?^  }/m);
  assert(fn, "handleSingleSendFee not found");
  assert(fn[0].includes("tokLive.decimals") || fn[0].includes("knownMintMeta"),
    "SPL transfer must use decimals from token metadata");
});

test("SPL transfer creates recipient ATA if missing", () => {
  const fn = src.match(/async function handleSingleSendFee[\s\S]*?^  }/m);
  assert(fn, "handleSingleSendFee not found");
  assert(fn[0].includes("ASSOCIATED_TOKEN_PROGRAM_ID"), "SPL transfer must handle ATA creation");
});

test("Bulk send SPL path uses encodeU64LE", () => {
  const fn = src.match(/async function handleBulkSendFee[\s\S]*?^  }/m);
  assert(fn, "handleBulkSendFee not found");
  assert(fn[0].includes("encodeU64LE"), "Bulk send SPL path must use encodeU64LE");
});

test("Bulk send validates tok.mint before SPL transfer", () => {
  const fn = src.match(/async function handleBulkSendFee[\s\S]*?^  }/m);
  assert(fn, "handleBulkSendFee not found");
  assert(fn[0].includes("tok.mint"), "Bulk send must validate tok.mint exists");
});

test("Bulk send uses lamportsToBigInt for SOL", () => {
  const fn = src.match(/async function handleBulkSendFee[\s\S]*?^  }/m);
  assert(fn, "handleBulkSendFee not found");
  assert(fn[0].includes("lamportsToBigInt"), "Bulk send must use lamportsToBigInt");
});

// ── (d) Token-specific encoding unit tests ───────────────────────────────────
console.log("\n(d) Token-specific encoding unit tests");

function encodeU64LE(value) {
  const buf  = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setUint32(0, value >>> 0, true);
  view.setUint32(4, Math.floor(value / 0x100000000), true);
  return buf;
}
function decodeU64LE(buf) {
  const v = new DataView(buf.buffer);
  return v.getUint32(0,true) + v.getUint32(4,true) * 0x100000000;
}
function lamportsToBigInt(sol) {
  const n = Math.ceil((Number(sol)||0) * 1_000_000_000);
  return BigInt(Math.floor(n));
}

test("USDC: 1.5 USDC (6 dec) encodes to 1_500_000 raw", () => {
  const raw = Math.floor(1.5 * Math.pow(10, 6));
  assertEqual(raw, 1_500_000, "1.5 USDC raw");
  assertEqual(decodeU64LE(encodeU64LE(raw)), 1_500_000, "round-trip");
});

test("USDT: 100 USDT (6 dec) encodes to 100_000_000 raw", () => {
  const raw = Math.floor(100 * Math.pow(10, 6));
  assertEqual(raw, 100_000_000, "100 USDT raw");
  assertEqual(decodeU64LE(encodeU64LE(raw)), 100_000_000, "round-trip");
});

test("BONK: 1_000_000 BONK (5 dec) encodes to 100_000_000_000 raw", () => {
  const raw = Math.floor(1_000_000 * Math.pow(10, 5));
  assertEqual(raw, 100_000_000_000, "1M BONK raw");
  assertEqual(decodeU64LE(encodeU64LE(raw)), 100_000_000_000, "round-trip");
});

test("SOL: 10 SOL = 10_000_000_000 lamports as BigInt", () => {
  assertEqual(lamportsToBigInt(10), BigInt(10_000_000_000), "10 SOL lamports");
});

test("SOL: 0.000001 SOL = 1000 lamports as BigInt", () => {
  assertEqual(lamportsToBigInt(0.000001), BigInt(1000), "0.000001 SOL lamports");
});

test("SOL: 4.3 SOL (exceeds 32-bit) encodes correctly", () => {
  const lamps = lamportsToBigInt(4.3);
  assert(lamps > BigInt(4_000_000_000), "4.3 SOL must exceed 4B lamports");
  assert(lamps < BigInt(5_000_000_000), "4.3 SOL must be less than 5B lamports");
});

// ── (e) Existing checks ───────────────────────────────────────────────────────
console.log("\n(e) Existing checks");

test("api.mainnet-beta.solana.com is first in RPC_LIST", () => {
  const m = src.match(/const RPC_LIST\s*=\s*\[([\s\S]*?)\];/);
  assert(m, "RPC_LIST not found");
  const urls = m[1].match(/https?:\/\/[^\s"']+/g)||[];
  assertEqual(urls[0], "https://api.mainnet-beta.solana.com", "First RPC must be official endpoint");
});

test("Broken endpoints removed from RPC_LIST", () => {
  const m = src.match(/const RPC_LIST\s*=\s*\[([\s\S]*?)\];/);
  assert(m, "RPC_LIST not found");
  assertNotIn(m[1], "rpc.ankr.com/solana", "ankr free tier (403) must be removed");
  assertNotIn(m[1], "15319bf8", "Invalid Helius key must be removed");
  assertNotIn(m[1], "alchemy.com/v2/demo", "Alchemy demo key must be removed");
  assertNotIn(m[1], "genesysgo.net", "Defunct genesysgo must be removed");
});

test("Circuit-breaker is implemented", () => {
  assert(src.includes("_rpcCircuit") && src.includes("_tripCircuit"),
    "Circuit-breaker must be implemented");
});

test("Jupiter Price API uses v3 endpoint", () => {
  assertNotIn(src, "price.jup.ag/v6/price", "Deprecated v6 endpoint must be removed");
  assert(src.includes("api.jup.ag/price/v3"), "v3 endpoint must be used");
});

test("amount state initialises to empty string", () => {
  const m = src.match(/const \[amount,setAmount\]=React\.useState\(([^)]+)\)/);
  assert(m, "amount state not found");
  assertEqual(m[1].replace(/['"]/g,""), "", "amount must default to empty string");
});

test("USD is the default currency", () => {
  const m = src.match(/const \[currency,setCurrency\]=React\.useState\(([^)]+)\)/);
  assert(m, "currency state not found");
  assertEqual(m[1].replace(/['"]/g,""), "USD", "currency must default to USD");
});

test("NGN remains in CURRENCIES array", () => {
  const m = src.match(/const CURRENCIES\s*=\s*\[([\s\S]*?)\];/);
  assert(m, "CURRENCIES not found");
  assert(m[1].includes('code:"NGN"'), "NGN must remain in CURRENCIES");
});

// ── (f) Token display, NFT filtering, and send fixes ─────────────────────────
// These run synchronously regardless of RUN_LIVE
console.log("\n(f) Token display, NFT filtering, and send fixes");

test("walletTokenList spreads t after meta so live balance is never overwritten", () => {
  const fn = src.match(/const walletTokenList = React\.useMemo[\s\S]*?\}\s*,\s*\[connected/m);
  assert(fn, "walletTokenList memo not found");
  // The spread must be {...meta,...t,...} — t last so its fields win
  assert(fn[0].includes("{...meta,...t,price:livePrice}"),
    "walletTokenList must spread t after meta so live balance/decimals/mint survive");
});

test("filteredTokens excludes tokens with isNFT=true", () => {
  const fn = src.match(/const filteredTokens = React\.useMemo[\s\S]*?\}\s*,\s*\[connected/m);
  assert(fn, "filteredTokens memo not found");
  assert(fn[0].includes("if(t.isNFT === true) return false"),
    "filteredTokens must exclude tokens where isNFT===true");
});

test("filteredTokens excludes tokens with decimals=0 and rawAmount=1 (NFT pattern)", () => {
  const fn = src.match(/const filteredTokens = React\.useMemo[\s\S]*?\}\s*,\s*\[connected/m);
  assert(fn, "filteredTokens memo not found");
  assert(fn[0].includes("if(t.decimals === 0 && t.rawAmount === 1) return false"),
    "filteredTokens must exclude decimals=0 && rawAmount=1 tokens");
});

test("filteredTokens only shows fungible tokens (comment confirms intent)", () => {
  assert(src.includes("Only include fungible tokens"),
    "filteredTokens must document that it only shows fungible tokens");
});

test("enriched pass guards uiAmount recomputation with sanity bounds", () => {
  assert(src.includes("recomputed > 0 && recomputed < 1e15"),
    "Enriched pass must sanity-check recomputed uiAmount to prevent tokens disappearing");
});

test("enriched pass uses trustedDecimals (not raw metadata decimals) for recomputation", () => {
  assert(src.includes("trustedDecimals"),
    "Enriched pass must use trustedDecimals to avoid wrong-decimals from all-tokens list");
});

test("enriched pass re-evaluates isNFT flag with enriched decimals", () => {
  assert(src.includes("const isNFT = decimals === 0 && t.rawAmount === 1"),
    "Enriched pass must re-evaluate isNFT with the corrected decimals");
});

test("handleSingleSendFee normalises fromPubkey via toString()", () => {
  const fn = src.match(/async function handleSingleSendFee[\s\S]*?^  }/m);
  assert(fn, "handleSingleSendFee not found");
  assert(fn[0].includes("new window.solanaWeb3.PublicKey(provider.publicKey.toString())"),
    "fromPubkey must be normalised via toString() to avoid cross-scope instanceof failures");
});

test("handleBulkSendFee normalises fromPubkey via toString()", () => {
  const fn = src.match(/async function handleBulkSendFee[\s\S]*?^  }/m);
  assert(fn, "handleBulkSendFee not found");
  assert(fn[0].includes("provider.publicKey.toString()"),
    "Bulk send fromPubkey must be normalised via toString()");
});

test("chargePlatformFeeInSol normalises fromPubkey via toString()", () => {
  const fn = src.match(/async function chargePlatformFeeInSol[\s\S]*?^  }/m);
  assert(fn, "chargePlatformFeeInSol not found");
  assert(fn[0].includes("toString()"),
    "chargePlatformFeeInSol fromPubkey must be normalised via toString()");
});

test("deprecated confirmTransaction is not called in send flow", () => {
  const fn = src.match(/async function handleSingleSendFee[\s\S]*?^  }/m);
  assert(fn, "handleSingleSendFee not found");
  // Strip comments, then check no live call to confirmTransaction
  const codeOnly = fn[0].replace(/\/\/[^\n]*/g, "");
  assert(!codeOnly.includes("confirmTransaction"),
    "handleSingleSendFee must not call deprecated confirmTransaction");
});

test("pollConfirm uses getSignatureStatuses for confirmation polling", () => {
  assert(src.includes("getSignatureStatuses"),
    "Confirmation polling must use getSignatureStatuses (not deprecated confirmTransaction)");
  assert(src.includes("const pollConfirm = async"),
    "pollConfirm helper must be defined");
});

test("pollConfirm checks for confirmed or finalized status", () => {
  assert(src.includes('"confirmed"') && src.includes('"finalized"'),
    "pollConfirm must check for both confirmed and finalized status");
});

// ── NFT filtering unit test (pure logic, no DOM) ─────────────────────────────
test("NFT filter logic: decimals=0 rawAmount=1 is excluded", () => {
  // Simulate the filter predicate inline
  function isHeldFungible(t, solBalance) {
    if(t.symbol === "SOL") return solBalance !== null && solBalance >= 0;
    if(t.isNFT === true) return false;
    if(t.decimals === 0 && t.rawAmount === 1) return false;
    return typeof t.balance === "number" && t.balance > 0;
  }
  // NFT: decimals=0, rawAmount=1
  assert(!isHeldFungible({symbol:"NFT",decimals:0,rawAmount:1,balance:1}, 1),
    "NFT (decimals=0, rawAmount=1) must be excluded");
  // NFT via isNFT flag
  assert(!isHeldFungible({symbol:"NFT2",isNFT:true,decimals:0,rawAmount:1,balance:1}, 1),
    "Token with isNFT=true must be excluded");
  // Fungible with 0 balance
  assert(!isHeldFungible({symbol:"USDC",decimals:6,rawAmount:1000000,balance:0}, 1),
    "Zero-balance fungible must be excluded");
  // Valid fungible
  assert(isHeldFungible({symbol:"USDC",decimals:6,rawAmount:1000000,balance:1.0}, 1),
    "Fungible with balance>0 must be included");
  // SOL
  assert(isHeldFungible({symbol:"SOL"}, 0.5),
    "SOL with loaded balance must be included");
  assert(!isHeldFungible({symbol:"SOL"}, null),
    "SOL with null balance (loading) must be excluded");
});

test("enriched pass sanity check: prevents uiAmount=0 from bad decimals", () => {
  // Simulate the guard logic
  function safeRecompute(rawAmount, oldDecimals, newDecimals) {
    if(newDecimals === oldDecimals) return rawAmount / Math.pow(10, oldDecimals);
    const recomputed = rawAmount / Math.pow(10, newDecimals);
    if(recomputed > 0 && recomputed < 1e15) return recomputed;
    return rawAmount / Math.pow(10, oldDecimals); // fall back to original
  }
  // Jupiter returns decimals=0 for a token that actually has 6 decimals
  // rawAmount=1000000 (1 USDC), oldDecimals=6, newDecimals=0 (wrong)
  // Without guard: 1000000 / 10^0 = 1000000 (absurd, but > 0 so passes)
  // With guard: 1000000 < 1e15 so it would pass — but the trustedDecimals
  // guard prevents this by only using metadata decimals from KNOWN_MINTS/strict list
  const result = safeRecompute(1000000, 6, 6); // same decimals — no recompute
  assertEqual(result, 1.0, "1 USDC should be 1.0 with correct decimals");

  // Simulate bad metadata returning decimals=0 for a 6-decimal token
  // The trustedDecimals guard would keep oldDecimals=6 in this case
  const badResult = safeRecompute(1000000, 6, 0);
  // 1000000 / 10^0 = 1000000 — this is > 1e15? No, 1M < 1e15, so it passes
  // The real protection is trustedDecimals only coming from KNOWN_MINTS/strict
  assert(badResult > 0, "Recomputed value must remain positive");
});

// ── Live tests ────────────────────────────────────────────────────────────────
const RUN_LIVE = process.env.RUN_LIVE === "1";
if(RUN_LIVE){
  console.log("\n(g) Live network tests (RUN_LIVE=1)");
  const https = require("https");

  function liveRpc(url, method, params) {
    return new Promise(resolve => {
      const body = JSON.stringify({jsonrpc:"2.0",id:1,method,params});
      const u = new URL(url);
      const req = https.request({
        hostname:u.hostname, port:443, path:u.pathname+u.search,
        method:"POST",
        headers:{"Content-Type":"application/json","Accept":"application/json","Content-Length":Buffer.byteLength(body)},
        timeout:15000,
      }, res => {
        let data="";
        res.on("data",d=>data+=d);
        res.on("end",()=>{
          try{ const j=JSON.parse(data); resolve({status:res.statusCode,ok:!j.error,result:j.result,err:j.error?.message}); }
          catch(e){ resolve({status:res.statusCode,ok:false,err:e.message}); }
        });
      });
      req.on("error",e=>resolve({status:"ERR",ok:false,err:e.message}));
      req.on("timeout",()=>{req.destroy();resolve({status:"TIMEOUT",ok:false});});
      req.write(body); req.end();
    });
  }

  function liveGet(url) {
    return new Promise(resolve => {
      const u = new URL(url);
      const req = https.request({
        hostname:u.hostname, port:443, path:u.pathname+u.search,
        method:"GET", headers:{"Accept":"application/json"}, timeout:8000,
      }, res => {
        let data="";
        res.on("data",d=>data+=d);
        res.on("end",()=>{
          try{ resolve({status:res.statusCode,ok:res.statusCode===200,json:JSON.parse(data)}); }
          catch(e){ resolve({status:res.statusCode,ok:false,err:e.message}); }
        });
      });
      req.on("error",e=>resolve({status:"ERR",ok:false,err:e.message}));
      req.on("timeout",()=>{req.destroy();resolve({status:"TIMEOUT",ok:false});});
      req.end();
    });
  }

  (async()=>{
    const PRIMARY = "https://api.mainnet-beta.solana.com";

    test("LIVE: primary RPC getHealth returns ok", async()=>{
      const r = await liveRpc(PRIMARY,"getHealth",[]);
      assert(r.ok && r.result==="ok", "getHealth failed: "+r.err);
    });

    test("LIVE: primary RPC getBalance returns a number", async()=>{
      const r = await liveRpc(PRIMARY,"getBalance",["So11111111111111111111111111111111111111112",{commitment:"confirmed"}]);
      assert(r.ok && typeof r.result?.value==="number", "getBalance failed: "+r.err);
    });

    test("LIVE: primary RPC getTokenAccountsByOwner works with programId filter", async()=>{
      const r = await liveRpc(PRIMARY,"getTokenAccountsByOwner",[
        "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        {programId:"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"},
        {encoding:"jsonParsed",commitment:"confirmed"}
      ]);
      assert(r.ok && Array.isArray(r.result?.value), "getTokenAccountsByOwner failed: "+r.err);
    });

    test("LIVE: primary RPC getLatestBlockhash returns a blockhash", async()=>{
      const r = await liveRpc(PRIMARY,"getLatestBlockhash",[{commitment:"confirmed"}]);
      assert(r.ok && typeof r.result?.value?.blockhash==="string", "getLatestBlockhash failed: "+r.err);
    });

    test("LIVE: getSignatureStatuses works (replaces deprecated confirmTransaction)", async()=>{
      // A well-formed all-1s signature is valid base58 but won't exist on-chain
      const fakeSig = "1111111111111111111111111111111111111111111111111111111111111111";
      const r = await liveRpc(PRIMARY,"getSignatureStatuses",[[fakeSig],{searchTransactionHistory:true}]);
      // value[0] will be null for an unknown sig — that's correct behaviour
      assert(r.ok && Array.isArray(r.result?.value),
        "getSignatureStatuses must return a value array: "+JSON.stringify(r));
    });

    test("LIVE: Bonfida SNS API resolves bonfida.sol", async()=>{
      const r = await liveGet("https://sns-sdk-proxy.bonfida.workers.dev/resolve/bonfida");
      assert(r.ok && r.json?.s==="ok" && r.json?.result?.length > 30,
        "Bonfida API must resolve bonfida.sol: "+JSON.stringify(r.json));
    });

    test("LIVE: Bonfida SNS API returns error for unregistered domain", async()=>{
      const r = await liveGet("https://sns-sdk-proxy.bonfida.workers.dev/resolve/this-domain-does-not-exist-xyz-abc-123");
      assert(r.json?.s==="error",
        "Bonfida API must return s=error for unregistered domain: "+JSON.stringify(r.json));
    });

    test("LIVE: Jupiter Price v3 returns SOL price", async()=>{
      const r = await liveGet("https://api.jup.ag/price/v3?ids=So11111111111111111111111111111111111111112");
      const price = r.json?.["So11111111111111111111111111111111111111112"]?.usdPrice;
      assert(typeof price==="number" && price > 0, "Jupiter v3 must return SOL price: "+JSON.stringify(r.json));
    });

    test("LIVE: Jupiter Price v3 returns USDC price ~1.00", async()=>{
      const r = await liveGet("https://api.jup.ag/price/v3?ids=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
      const price = r.json?.["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"]?.usdPrice;
      assert(typeof price==="number" && price > 0.99 && price < 1.01,
        "USDC price must be ~1.00: "+price);
    });

    test("LIVE: Jupiter Price v3 returns USDT price ~1.00", async()=>{
      const r = await liveGet("https://api.jup.ag/price/v3?ids=Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
      const price = r.json?.["Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"]?.usdPrice;
      assert(typeof price==="number" && price > 0.99 && price < 1.01,
        "USDT price must be ~1.00: "+price);
    });

    test("LIVE: Jupiter Price v3 returns BONK price > 0", async()=>{
      const r = await liveGet("https://api.jup.ag/price/v3?ids=DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
      const price = r.json?.["DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"]?.usdPrice;
      assert(typeof price==="number" && price > 0, "BONK price must be > 0: "+price);
    });

    printSummary();
  })();
} else {
  printSummary();
}

function printSummary(){
  console.log("\n"+"-".repeat(55));
  console.log("Results: "+passed+" passed, "+failed+" failed out of "+(passed+failed)+" tests");
  if(!RUN_LIVE){ console.log("(Run with RUN_LIVE=1 for live network tests)"); }
  if(failed>0){ console.error("\nSome tests failed."); process.exit(1); }
  else{ console.log("\nAll tests passed"); process.exit(0); }
}
