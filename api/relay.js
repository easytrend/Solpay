/**
 * api/relay.js — Vercel Serverless Function
 *
 * Receives a user-signed Solana transaction (serialized, base64),
 * validates it, adds the relayer's signature as feePayer, and broadcasts it.
 *
 * Required server-side env vars (NO VITE_ prefix — never sent to browser):
 *   RELAYER_SECRET_KEY  — JSON array of 64 bytes, e.g. [12, 34, ...] OR Base58 private key string
 *   VITE_RPC_URL        — Optional custom RPC endpoint (reused from frontend env)
 */

import {
  Connection,
  Transaction,
  Keypair,
  clusterApiUrl,
  PublicKey,
} from '@solana/web3.js';

// ── Programs that could drain the relayer's SOL/tokens if misused ────────────
// SystemProgram (SOL transfers) and Token programs (SPL transfers) are the only
// programs that can move funds. We don't block them — we inspect their instructions
// to ensure the relayer is never the SOURCE of a transfer.
const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
const TOKEN_PROGRAMS = new Set([
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', // Token-2022
]);

const MEMO_PREFIX = 'fiatwallet:pajcash:offramp:';

// Zero-dependency Base58 Decoder
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALPHABET_MAP = {};
for (let i = 0; i < ALPHABET.length; i++) {
  ALPHABET_MAP[ALPHABET.charAt(i)] = i;
}

function decodeBase58(string) {
  if (string.length === 0) return new Uint8Array(0);
  const bytes = [0];
  for (let i = 0; i < string.length; i++) {
    const c = string.charAt(i);
    if (!(c in ALPHABET_MAP)) throw new Error('Non-base58 character');
    let carry = ALPHABET_MAP[c];
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let k = 0; string.charAt(k) === '1' && k < string.length - 1; k++) {
    bytes.push(0);
  }
  return new Uint8Array(bytes.reverse());
}

// Robust Keypair loader supporting both JSON array and Base58 string
function loadKeypair(secretEnv) {
  if (!secretEnv) throw new Error('RELAYER_SECRET_KEY env var is empty');
  let clean = secretEnv.trim();

  // Strip wrapping double quotes if present
  if (clean.startsWith('"') && clean.endsWith('"')) {
    clean = clean.slice(1, -1);
  }
  // Strip wrapping single quotes if present
  if (clean.startsWith("'") && clean.endsWith("'")) {
    clean = clean.slice(1, -1);
  }

  if (clean.startsWith('[')) {
    try {
      const arr = JSON.parse(clean);
      return Keypair.fromSecretKey(new Uint8Array(arr));
    } catch (e) {
      throw new Error(`Invalid JSON array format in RELAYER_SECRET_KEY: ${e.message}`);
    }
  }

  // Fallback to base58 decoding
  try {
    const bytes = decodeBase58(clean);
    return Keypair.fromSecretKey(bytes);
  } catch (e) {
    throw new Error('RELAYER_SECRET_KEY is neither a valid JSON array nor a valid Base58 string');
  }
}

/**
 * Checks that the relayer's public key is never used as the SOURCE of any
 * fund transfer. This prevents a malicious user from crafting a transaction
 * that drains the relayer's SOL or tokens while using it as the fee payer.
 *
 * The relayer IS expected to appear as:
 *   - feePayer (pays gas)
 *   - payer for ATA creation (pays rent for new token accounts)
 *
 * The relayer must NEVER appear as:
 *   - fromPubkey in SystemProgram.transfer (would drain SOL)
 *   - source in SPL Token transfer/transferChecked (would drain tokens)
 */
function validateRelayerNotDrained(transaction, relayerPubkey) {
  for (const ix of transaction.instructions) {
    const progId = ix.programId.toBase58();

    // SystemProgram: instruction discriminator is first 4 bytes (little-endian uint32)
    // Transfer = 2, TransferWithSeed = 11, AdvanceNonceAccount = 4
    if (progId === SYSTEM_PROGRAM_ID && ix.data.length >= 4) {
      const ixType = ix.data.readUInt32LE(0);
      // Transfer (2): accounts[0] = from (writable, signer)
      // TransferWithSeed (11): accounts[0] = from
      if ((ixType === 2 || ixType === 11) && ix.keys.length > 0) {
        if (ix.keys[0].pubkey.equals(relayerPubkey)) {
          return 'Blocked: relayer cannot be the source of a SOL transfer';
        }
      }
    }

    // SPL Token / Token-2022: instruction discriminator is first byte
    // Transfer = 3, TransferChecked = 12
    if (TOKEN_PROGRAMS.has(progId) && ix.data.length >= 1) {
      const ixType = ix.data[0];
      // Transfer (3): accounts[0] = source
      // TransferChecked (12): accounts[0] = source
      if ((ixType === 3 || ixType === 12) && ix.keys.length > 0) {
        if (ix.keys[0].pubkey.equals(relayerPubkey)) {
          return 'Blocked: relayer cannot be the source of a token transfer';
        }
      }
    }
  }
  return null; // Safe — no drain detected
}

export default async function handler(req, res) {
  // CORS headers for browser fetch
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // ── Load and parse relayer keypair ──────────────────────────────────────
    const relayerSecret = process.env.RELAYER_SECRET_KEY;
    if (!relayerSecret) {
      return res.status(503).json({ error: 'RELAYER_SECRET_KEY environment variable is not configured on Vercel' });
    }

    const relayerKp = loadKeypair(relayerSecret);

    // ── Parse request body robustly ─────────────────────────────────────────
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        return res.status(400).json({ error: 'Malformed JSON payload string' });
      }
    } else if (Buffer.isBuffer(body)) {
      try {
        body = JSON.parse(body.toString('utf-8'));
      } catch (e) {
        return res.status(400).json({ error: 'Malformed JSON payload from Buffer' });
      }
    }

    const { serializedTransaction } = body || {};
    if (!serializedTransaction || typeof serializedTransaction !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid serializedTransaction parameter' });
    }

    // ── Deserialize transaction ───────────────────────────────────────────────
    let transaction;
    try {
      const txBuffer = Buffer.from(serializedTransaction, 'base64');
      transaction = Transaction.from(txBuffer);
    } catch (e) {
      return res.status(400).json({ error: 'Could not deserialize transaction: ' + e.message });
    }

    // ── Security validation ───────────────────────────────────────────────────
    // Instead of whitelisting specific programs (which breaks when wallets inject
    // utility programs like ComputeBudget, Lighthouse, etc.), we directly verify
    // that the relayer's funds cannot be drained. This is both more secure and
    // compatible with all wallets.

    // 1. feePayer must be the relayer
    if (!transaction.feePayer || !transaction.feePayer.equals(relayerKp.publicKey)) {
      return res.status(400).json({ error: 'Transaction feePayer does not match the relayer\'s public key' });
    }

    // 2. Ensure no instruction can drain the relayer's SOL or tokens
    const drainCheck = validateRelayerNotDrained(transaction, relayerKp.publicKey);
    if (drainCheck) {
      return res.status(400).json({ error: drainCheck });
    }

    // 3. Must have our memo to confirm it's a genuine offramp tx
    const decoder = new TextDecoder();
    const hasMemo = transaction.instructions.some(ix => {
      const progId = ix.programId.toBase58();
      const isMemo =
        progId === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' ||
        progId === 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo';
      if (!isMemo) return false;
      try {
        return decoder.decode(ix.data).startsWith(MEMO_PREFIX);
      } catch {
        return false;
      }
    });
    if (!hasMemo) {
      return res.status(400).json({ error: 'Transaction is missing required offramp memo' });
    }

    // ── Connect and check relayer SOL balance ─────────────────────────────────
    const rpcUrl = process.env.VITE_RPC_URL || 'https://rpc.ankr.com/solana';
    const connection = new Connection(rpcUrl, 'confirmed');

    let relayerBalance;
    try {
      relayerBalance = await connection.getBalance(relayerKp.publicKey);
    } catch (e) {
      return res.status(503).json({ error: 'Could not fetch relayer wallet balance from Solana: ' + e.message });
    }

    if (relayerBalance < 10_000) {
      return res.status(503).json({ error: `Relayer wallet has insufficient SOL (${(relayerBalance / 1e9).toFixed(5)} SOL). Please fund it.` });
    }

    // ── Sign as feePayer and broadcast ───────────────────────────────────────
    try {
      transaction.partialSign(relayerKp);

      const sig = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });

      console.log(`[relay] Broadcasted tx: ${sig}`);
      return res.status(200).json({ signature: sig });
    } catch (e) {
      console.error('[relay] Broadcast failed:', e.message);
      return res.status(500).json({ error: 'Transaction broadcast failed: ' + e.message });
    }
  } catch (error) {
    console.error('[relay] Unhandled runtime crash:', error);
    return res.status(500).json({
      error: error.message || 'Internal Server Error',
      stack: error.stack
    });
  }
}
