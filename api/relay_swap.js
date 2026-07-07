/**
 * api/relay_swap.js — Vercel Serverless Function
 *
 * Receives a user-signed Jupiter swap VersionedTransaction (V0),
 * validates that the relayer is ONLY paying the fee and not being drained,
 * adds the relayer's signature, and broadcasts it.
 */

import {
  Connection,
  VersionedTransaction,
  Keypair,
} from '@solana/web3.js';

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

function loadKeypair(secretEnv) {
  if (!secretEnv) throw new Error('RELAYER_SECRET_KEY env var is empty');
  let clean = secretEnv.trim();
  if (clean.startsWith('"') && clean.endsWith('"')) clean = clean.slice(1, -1);
  if (clean.startsWith("'") && clean.endsWith("'")) clean = clean.slice(1, -1);

  if (clean.startsWith('[')) {
    try {
      const arr = JSON.parse(clean);
      return Keypair.fromSecretKey(new Uint8Array(arr));
    } catch (e) {
      throw new Error(`Invalid JSON array format: ${e.message}`);
    }
  }
  try {
    const bytes = decodeBase58(clean);
    return Keypair.fromSecretKey(bytes);
  } catch (e) {
    throw new Error('RELAYER_SECRET_KEY is neither a valid JSON array nor a valid Base58 string');
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const relayerSecret = process.env.RELAYER_SECRET_KEY;
    if (!relayerSecret) {
      return res.status(503).json({ error: 'RELAYER_SECRET_KEY missing' });
    }
    const relayerKp = loadKeypair(relayerSecret);

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'Malformed JSON payload string' }); }
    } else if (Buffer.isBuffer(body)) {
      try { body = JSON.parse(body.toString('utf-8')); } catch (e) { return res.status(400).json({ error: 'Malformed JSON payload from Buffer' }); }
    }

    const { serializedTransaction } = body || {};
    if (!serializedTransaction || typeof serializedTransaction !== 'string') {
      return res.status(400).json({ error: 'Missing serializedTransaction' });
    }

    // Deserialize V0 transaction
    let transaction;
    try {
      const txBuffer = Buffer.from(serializedTransaction, 'base64');
      transaction = VersionedTransaction.deserialize(txBuffer);
    } catch (e) {
      return res.status(400).json({ error: 'Could not deserialize V0 transaction: ' + e.message });
    }

    // 1. Fee Payer Check
    // In a VersionedTransaction, staticAccountKeys[0] is strictly the fee payer.
    const feePayer = transaction.message.staticAccountKeys[0];
    if (!feePayer.equals(relayerKp.publicKey)) {
      return res.status(400).json({ error: 'Transaction feePayer does not match relayer' });
    }

    // 2. Drain Check
    // If the relayer is ONLY the fee payer, its index (0) should NEVER be referenced
    // by ANY compiled instruction. If an instruction references it, it might be transferring SOL/tokens.
    const isRelayerReferenced = transaction.message.compiledInstructions.some(ix => {
      // accountKeyIndexes is an array of indices into the address tables mapping
      for (let i = 0; i < ix.accountKeyIndexes.length; i++) {
        if (ix.accountKeyIndexes[i] === 0) return true;
      }
      return false;
    });

    if (isRelayerReferenced) {
      return res.status(400).json({ error: 'Blocked: Relayer public key is referenced inside an instruction. Relayer can only be used as feePayer.' });
    }

    // 3. Balance Check
    const rpcUrl = process.env.VITE_RPC_URL || 'https://rpc.ankr.com/solana';
    const connection = new Connection(rpcUrl, 'confirmed');

    const relayerBalance = await connection.getBalance(relayerKp.publicKey).catch(() => 0);
    if (relayerBalance < 10_000) {
      return res.status(503).json({ error: `Relayer wallet has insufficient SOL (${(relayerBalance / 1e9).toFixed(5)} SOL). Please fund it.` });
    }

    // 4. Sign and Broadcast
    try {
      transaction.sign([relayerKp]);
      const sig = await connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
      console.log(`[relay_swap] Broadcasted tx: ${sig}`);
      return res.status(200).json({ signature: sig });
    } catch (e) {
      console.error('[relay_swap] Broadcast failed:', e.message);
      return res.status(500).json({ error: 'Transaction broadcast failed: ' + e.message });
    }
  } catch (error) {
    console.error('[relay_swap] Unhandled crash:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
