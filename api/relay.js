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

// ── Allowed Solana programs ─────────────────────────────────────────────────
const ALLOWED_PROGRAMS = new Set([
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated Token Program
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', // Token-2022
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', // Memo Program v1
  'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo',  // Memo Program v2
  '11111111111111111111111111111111',               // System Program
  'ComputeBudget111111111111111111111111111111',  // Compute Budget Program
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

    // 1. feePayer must be the relayer
    if (!transaction.feePayer || !transaction.feePayer.equals(relayerKp.publicKey)) {
      return res.status(400).json({ error: 'Transaction feePayer does not match the relayer\'s public key' });
    }

    // 2. All instructions must use allowed programs only
    for (const ix of transaction.instructions) {
      const progId = ix.programId.toBase58();
      if (!ALLOWED_PROGRAMS.has(progId)) {
        return res.status(400).json({ error: `Disallowed program in transaction: ${progId}` });
      }
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
