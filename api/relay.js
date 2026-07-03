/**
 * api/relay.js — Vercel Serverless Function
 *
 * Receives a user-signed Solana transaction (serialized, base64),
 * validates it, adds the relayer's signature as feePayer, and broadcasts it.
 *
 * Required server-side env vars (NO VITE_ prefix — never sent to browser):
 *   RELAYER_SECRET_KEY  — JSON array of 64 bytes, e.g. [12, 34, ...]
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
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bV', // Associated Token Program
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', // Token-2022
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', // Memo Program v1
  'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo',  // Memo Program v2
  '11111111111111111111111111111111',               // System Program
]);

const MEMO_PREFIX = 'fiatwallet:pajcash:offramp:';

export default async function handler(req, res) {
  // CORS headers for browser fetch
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Load relayer keypair ──────────────────────────────────────────────────
  const relayerSecret = process.env.RELAYER_SECRET_KEY;
  if (!relayerSecret) {
    console.error('[relay] RELAYER_SECRET_KEY env var not set');
    return res.status(503).json({ error: 'Relayer not configured' });
  }

  let relayerKp;
  try {
    const keyArray = JSON.parse(relayerSecret);
    relayerKp = Keypair.fromSecretKey(new Uint8Array(keyArray));
  } catch (e) {
    console.error('[relay] Failed to load relayer keypair:', e.message);
    return res.status(500).json({ error: 'Relayer key invalid' });
  }

  // ── Deserialize transaction ───────────────────────────────────────────────
  const { serializedTransaction } = req.body || {};
  if (!serializedTransaction || typeof serializedTransaction !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid serializedTransaction' });
  }

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
    return res.status(400).json({ error: 'Transaction feePayer must be the relayer' });
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
  const rpcUrl = process.env.VITE_RPC_URL || clusterApiUrl('mainnet-beta');
  const connection = new Connection(rpcUrl, 'confirmed');

  let relayerBalance;
  try {
    relayerBalance = await connection.getBalance(relayerKp.publicKey);
  } catch (e) {
    return res.status(503).json({ error: 'Could not check relayer balance: ' + e.message });
  }

  if (relayerBalance < 10_000) {
    console.warn(`[relay] Low relayer balance: ${relayerBalance} lamports`);
    return res.status(503).json({ error: 'Relayer has insufficient SOL to cover fees' });
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
    return res.status(500).json({ error: e.message || 'Broadcast failed' });
  }
}
