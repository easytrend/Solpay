/**
 * api/relay_onramp_fee.js — Vercel Serverless Function
 *
 * Verifies a completed PajCash onramp order, retrieves the user's actual Solana address
 * from Supabase, deducts the $0.10 platform fee, and forwards the net USDC.
 */

import {
  Connection,
  Transaction,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from '@solana/spl-token';
import { createClient } from '@supabase/supabase-js';

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // 1. Load keys and check configuration
    const relayerSecret = process.env.RELAYER_SECRET_KEY;
    if (!relayerSecret) {
      return res.status(503).json({ error: 'RELAYER_SECRET_KEY missing' });
    }
    const relayerKp = loadKeypair(relayerSecret);

    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      return res.status(503).json({ error: 'Supabase credentials missing' });
    }
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // 2. Parse request body
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'Malformed JSON payload string' }); }
    } else if (Buffer.isBuffer(body)) {
      try { body = JSON.parse(body.toString('utf-8')); } catch (e) { return res.status(400).json({ error: 'Malformed JSON payload from Buffer' }); }
    }

    const { orderId, sessionToken } = body || {};
    if (!orderId) {
      return res.status(400).json({ error: 'Missing orderId' });
    }
    if (!sessionToken) {
      return res.status(400).json({ error: 'Missing sessionToken' });
    }

    // 3. Query PajCash to verify order details & status
    let pajTx = null;
    let pajError = null;
    const baseUrls = ['https://api.paj.cash', 'https://api-staging.paj.cash'];
    for (const baseUrl of baseUrls) {
      try {
        const response = await fetch(`${baseUrl}/pub/transactions/${orderId}`, {
          headers: { 'Authorization': `Bearer ${sessionToken}` }
        });
        if (response.ok) {
          pajTx = await response.json();
          break;
        }
      } catch (err) {
        pajError = err;
      }
    }

    if (!pajTx) {
      return res.status(400).json({ error: `Could not verify transaction with PajCash API: ${pajError?.message || 'Unauthorized or Not Found'}` });
    }

    // Verify order completion and recipient
    const status = (pajTx.status || '').toUpperCase();
    const isCompleted = status === 'COMPLETED' || status === 'SUCCESSFUL' || status === 'CONFIRMED' || status === 'SUCCESS';
    if (!isCompleted) {
      return res.status(400).json({ error: `PajCash order status is ${status}, not completed.` });
    }

    const recipient = pajTx.recipient || '';
    if (recipient !== relayerKp.publicKey.toBase58()) {
      return res.status(400).json({ error: 'Unauthorized: Relayer was not the recipient of this PajCash order.' });
    }

    // 4. Resolve actual user wallet from Supabase
    const { data: dbTx, error: dbError } = await supabase
      .from('p2p_transactions')
      .select('*')
      .eq('order_id', String(orderId))
      .single();

    if (dbError || !dbTx) {
      return res.status(400).json({ error: `Could not find transaction mapping in database: ${dbError?.message || 'Record not found'}` });
    }

    const userAddressStr = dbTx.user_address;
    if (!userAddressStr) {
      return res.status(400).json({ error: 'Database record is missing user Solana address' });
    }
    const userPublicKey = new PublicKey(userAddressStr);

    // Double forwarding prevention check
    const currentDbStatus = (dbTx.status || '').toUpperCase();
    if (currentDbStatus === 'FORWARDED_SUCCESS') {
      return res.status(400).json({ error: 'This order has already been successfully forwarded.' });
    }

    // 5. Build forwarding transaction
    const rpcUrl = process.env.VITE_RPC_URL || 'https://rpc.ankr.com/solana';
    const connection = new Connection(rpcUrl, 'confirmed');

    // Platform fee math
    const grossAmount = Number(pajTx.amount ?? pajTx.usdcAmount ?? dbTx.crypto_amount ?? 0);
    const PLATFORM_FEE_USD = 0.10;
    const netAmount = Math.max(0, grossAmount - PLATFORM_FEE_USD);
    const units = BigInt(Math.round(netAmount * 1_000_000)); // USDC has 6 decimals

    if (units <= 0n) {
      return res.status(400).json({ error: `USDC transfer units is too small: ${netAmount}` });
    }

    const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    const relayerATA = getAssociatedTokenAddressSync(USDC_MINT, relayerKp.publicKey);
    const userATA = getAssociatedTokenAddressSync(USDC_MINT, userPublicKey);

    // Build standard Transaction
    const transaction = new Transaction();
    
    // Rent-funded ATA creation for User if not exists
    transaction.add(
      createAssociatedTokenAccountIdempotentInstruction(
        relayerKp.publicKey, // rent payer
        userATA,             // ATA
        userPublicKey,       // owner
        USDC_MINT            // mint
      )
    );

    // USDC Transfer
    transaction.add(
      createTransferCheckedInstruction(
        relayerATA,          // source
        USDC_MINT,           // mint
        userATA,             // destination
        relayerKp.publicKey, // source authority
        units,               // amount in units
        6                    // decimals
      )
    );

    // On-chain log memo
    const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
    transaction.add(
      new TransactionInstruction({
        keys: [],
        programId: MEMO_PROGRAM_ID,
        data: Buffer.from(`fiatwallet:pajcash:onramp-forward:${orderId}`, 'utf-8')
      })
    );

    // Broadcast
    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = relayerKp.publicKey;
    
    transaction.sign(relayerKp);

    const sig = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed'
    });

    console.log(`[relay_onramp_fee] Forwarded ${netAmount} USDC to ${userAddressStr}. Tx: ${sig}`);

    // 6. Update database status to FORWARDED_SUCCESS
    const { error: updateError } = await supabase
      .from('p2p_transactions')
      .update({
        status: 'FORWARDED_SUCCESS',
        signature: sig,
        updated_at: new Date().toISOString()
      })
      .eq('order_id', String(orderId));

    if (updateError) {
      console.warn(`[relay_onramp_fee] Failed to update database status: ${updateError.message}`);
    }

    return res.status(200).json({ signature: sig, netAmount });
  } catch (error) {
    console.error('[relay_onramp_fee] Unhandled crash:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
