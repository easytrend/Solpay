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

  let globalOrderId = null;
  let supabase = null;

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

    // SECURITY: Use service-role key for server-side DB operations.
    // The anon key is the PUBLIC client-side key — if RLS is misconfigured,
    // an attacker can directly UPDATE p2p_transactions via the Supabase REST API
    // to change user_address to their own wallet before calling this endpoint.
    // The service-role key bypasses RLS and is meant for trusted server-side use only.
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseServiceKey) {
      console.warn('[relay_onramp_fee] WARNING: SUPABASE_SERVICE_ROLE_KEY not set. Falling back to anon key. Set the service-role key in production to prevent RLS bypass attacks.');
    }
    supabase = createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey);

    // 2. Parse request body
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'Malformed JSON payload string' }); }
    } else if (Buffer.isBuffer(body)) {
      try { body = JSON.parse(body.toString('utf-8')); } catch (e) { return res.status(400).json({ error: 'Malformed JSON payload from Buffer' }); }
    }

    const { orderId, sessionToken } = body || {};
    globalOrderId = orderId;

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
        } else {
          const text = await response.text();
          pajError = new Error(`PajCash returned status ${response.status}: ${text}`);
        }
      } catch (err) {
        pajError = err;
      }
    }

    if (!pajTx) {
      const errMsg = `Could not verify transaction with PajCash API: ${pajError?.message || 'Unauthorized or Not Found'}`;
      throw new Error(errMsg);
    }

    // Verify order completion
    const status = (pajTx.status || '').toUpperCase();
    const isCompleted = status === 'COMPLETED' || status === 'SUCCESSFUL' || status === 'CONFIRMED' || status === 'SUCCESS';
    if (!isCompleted) {
      throw new Error(`PajCash order status is ${status}, not completed.`);
    }

    // Verify recipient matches relayer
    const recipient = pajTx.recipient || pajTx.wallet || pajTx.address || '';
    if (recipient !== relayerKp.publicKey.toBase58()) {
      throw new Error(`Unauthorized: Relayer (${relayerKp.publicKey.toBase58()}) was not the recipient of this PajCash order. Got recipient: "${recipient}". Details: ${JSON.stringify(pajTx)}`);
    }

    // 4. Resolve actual user wallet from Supabase
    const { data: dbTx, error: dbError } = await supabase
      .from('p2p_transactions')
      .select('*')
      .eq('order_id', String(orderId))
      .single();

    if (dbError || !dbTx) {
      throw new Error(`Could not find transaction mapping in database: ${dbError?.message || 'Record not found'}`);
    }

    const userAddressStr = dbTx.user_address;
    if (!userAddressStr) {
      throw new Error('Database record is missing user Solana address');
    }
    const userPublicKey = new PublicKey(userAddressStr);

    // ──────────────────────────────────────────────────────────────────────────
    // SECURITY: Atomic double-forward prevention.
    //
    // The previous check was: read status → if FORWARDED_SUCCESS, return early.
    // This is a classic TOCTOU race: two concurrent requests both read the status
    // BEFORE either updates it, and both proceed to forward USDC — doubling the payout.
    //
    // Fix: Use a conditional UPDATE as a lock. Only the first request that
    // successfully transitions status from non-forwarded → FORWARDING will proceed.
    // If the row was already FORWARDED_SUCCESS or FORWARDING, the update affects
    // 0 rows and we return early.
    // ──────────────────────────────────────────────────────────────────────────
    const currentDbStatus = (dbTx.status || '').toUpperCase();
    if (currentDbStatus === 'FORWARDED_SUCCESS') {
      return res.status(200).json({ signature: dbTx.signature, netAmount: dbTx.crypto_amount - 0.10, alreadyForwarded: true });
    }

    // Atomically claim this order for forwarding — only succeeds if status is NOT already FORWARDING or FORWARDED_SUCCESS
    const { data: claimResult, error: claimError } = await supabase
      .from('p2p_transactions')
      .update({
        status: 'FORWARDING',
        updated_at: new Date().toISOString()
      })
      .eq('order_id', String(orderId))
      .neq('status', 'FORWARDING')
      .neq('status', 'FORWARDED_SUCCESS')
      .select('id');

    if (claimError) {
      throw new Error(`Failed to claim order for forwarding: ${claimError.message}`);
    }
    if (!claimResult || claimResult.length === 0) {
      // Another concurrent request already claimed this order
      return res.status(200).json({ error: 'Order is already being forwarded or was already forwarded.', alreadyForwarded: true });
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
      throw new Error(`USDC transfer units is too small: ${netAmount}`);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // SECURITY: Verify on-chain USDC deposit before forwarding.
    //
    // Even if PajCash says the order is "COMPLETED", we verify that the relayer's
    // USDC ATA actually has sufficient balance to cover this forward. This prevents
    // an attacker from triggering a forward for funds that were never deposited
    // (e.g. via a stolen/guessed sessionToken or a manipulated DB record).
    // ──────────────────────────────────────────────────────────────────────────
    const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    const relayerATA = getAssociatedTokenAddressSync(USDC_MINT, relayerKp.publicKey);
    const userATA = getAssociatedTokenAddressSync(USDC_MINT, userPublicKey);

    let relayerUsdcBalance = 0n;
    try {
      const balResp = await connection.getTokenAccountBalance(relayerATA, 'confirmed');
      relayerUsdcBalance = BigInt(balResp.value.amount || '0');
    } catch (e) {
      throw new Error(`Failed to check relayer USDC balance: ${e.message}`);
    }

    if (relayerUsdcBalance < units) {
      throw new Error(
        `Relayer USDC balance (${relayerUsdcBalance} base units) is insufficient ` +
        `to forward ${units} base units (${netAmount} USDC). ` +
        `The on-chain deposit may not have arrived yet.`
      );
    }

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
    await supabase
      .from('p2p_transactions')
      .update({
        status: 'FORWARDED_SUCCESS',
        signature: sig,
        deposit_address: null, // Clear error logs if any
        updated_at: new Date().toISOString()
      })
      .eq('order_id', String(orderId));

    return res.status(200).json({ signature: sig, netAmount });
  } catch (error) {
    console.error('[relay_onramp_fee] Unhandled crash:', error);
    
    // Remote logging to Supabase so we can query it using query_failed_order.js
    if (supabase && globalOrderId) {
      try {
        await supabase
          .from('p2p_transactions')
          .update({
            status: 'FORWARD_FAILED',
            deposit_address: `Error: ${error.message || String(error)}`
          })
          .eq('order_id', String(globalOrderId));
      } catch (dbErr) {
        console.error('Failed to log error to Supabase:', dbErr.message);
      }
    }

    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
}
