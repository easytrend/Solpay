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

    // ──────────────────────────────────────────────────────────────────────────
    // 2. FULL Drain Check — resolves ALTs so every account key is visible.
    //
    // Previous check only inspected staticAccountKeys. V0 transactions can
    // reference accounts through Address Lookup Tables (loadedAddresses), which
    // were completely invisible. An attacker could put the relayer's pubkey in
    // an ALT and drain it through ALT-resolved account indices.
    //
    // Additionally, the old check only blocked SystemProgram.transfer (SOL).
    // Token Program instructions were not checked at all, allowing an attacker
    // to drain the relayer's USDC/SPL token accounts.
    // ──────────────────────────────────────────────────────────────────────────

    const rpcUrl = process.env.VITE_RPC_URL || 'https://rpc.ankr.com/solana';
    const connection = new Connection(rpcUrl, 'confirmed');

    // 2a. Resolve ALL Address Lookup Tables referenced by the transaction
    const altLookups = transaction.message.addressTableLookups || [];
    const resolvedAltKeys = []; // flat array of all ALT-resolved pubkeys in order
    for (const lookup of altLookups) {
      let altAccountInfo;
      try {
        altAccountInfo = await connection.getAddressLookupTable(lookup.accountKey);
      } catch (e) {
        return res.status(400).json({ error: `Failed to fetch Address Lookup Table ${lookup.accountKey.toBase58()}: ${e.message}` });
      }
      if (!altAccountInfo?.value) {
        return res.status(400).json({ error: `Address Lookup Table ${lookup.accountKey.toBase58()} not found on chain.` });
      }
      // V0 messages index into ALT entries via writableIndexes and readonlyIndexes.
      // The combined resolved key list is: staticKeys + ALT writable entries + ALT readonly entries
      // (in the order they appear in addressTableLookups).
      for (const idx of lookup.writableIndexes) {
        resolvedAltKeys.push(altAccountInfo.value.state.addresses[idx]);
      }
      for (const idx of lookup.readonlyIndexes) {
        resolvedAltKeys.push(altAccountInfo.value.state.addresses[idx]);
      }
    }

    // Build the COMPLETE account key list (same order the runtime uses)
    const staticKeys = transaction.message.staticAccountKeys;
    const allKeys = [...staticKeys, ...resolvedAltKeys];

    // Identify all indices where the relayer's pubkey appears
    const relayerBase58 = relayerKp.publicKey.toBase58();
    const relayerIndices = new Set();
    for (let i = 0; i < allKeys.length; i++) {
      if (allKeys[i].toBase58() === relayerBase58) {
        relayerIndices.add(i);
      }
    }

    // Program IDs to inspect
    const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
    const TOKEN_PROGRAM_IDS = new Set([
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',  // SPL Token
      'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',  // Token-2022
    ]);

    // Dangerous token opcodes that should NEVER appear in a relayer-signed tx:
    //   3  = Transfer (legacy)      — moves tokens from source
    //   4  = Approve                — grants delegate spend authority
    //   6  = SetAuthority           — transfers account ownership
    //   12 = TransferChecked        — moves tokens from source (with mint/decimals)
    //   25 = ApproveChecked         — grants delegate spend authority (with decimals)
    const DANGEROUS_TOKEN_OPCODES = new Map([
      [3,  'Transfer'],
      [4,  'Approve'],
      [6,  'SetAuthority'],
      [12, 'TransferChecked'],
      [25, 'ApproveChecked'],
    ]);

    for (const ix of transaction.message.compiledInstructions) {
      const programKey = allKeys[ix.programIdIndex];
      if (!programKey) continue;
      const programId = programKey.toBase58();

      // 2b. SystemProgram: block if relayer is the 'from' (source) in a transfer.
      //     SystemProgram.transfer discriminator = 2 (u32 LE), from = accountKeyIndexes[0].
      if (programId === SYSTEM_PROGRAM_ID) {
        if (ix.data && ix.data.length >= 4) {
          const discriminator = ix.data[0] | (ix.data[1] << 8) | (ix.data[2] << 16) | (ix.data[3] << 24);
          if (discriminator === 2) { // SystemProgram::transfer
            const fromIndex = ix.accountKeyIndexes[0];
            if (relayerIndices.has(fromIndex)) {
              return res.status(400).json({
                error: 'Blocked: Transaction attempts to transfer SOL from relayer wallet (detected via full account key resolution).'
              });
            }
          }
        }
      }

      // 2c. Token Programs: block any instruction where the relayer is the source
      //     authority for a transfer, or where Approve/SetAuthority targets the relayer.
      //
      //     For Transfer (3):        accountKeyIndexes[2] = owner/authority
      //     For Approve (4):         accountKeyIndexes[2] = owner
      //     For SetAuthority (6):    accountKeyIndexes[0] = account, [1] = current authority
      //     For TransferChecked (12): accountKeyIndexes[3] = owner/authority
      //     For ApproveChecked (25): accountKeyIndexes[2] = owner
      if (TOKEN_PROGRAM_IDS.has(programId) && ix.data && ix.data.length > 0) {
        const opcode = ix.data[0];
        if (DANGEROUS_TOKEN_OPCODES.has(opcode)) {
          let authorityIndex = -1;

          if (opcode === 3) {         // Transfer — authority at index 2
            authorityIndex = ix.accountKeyIndexes[2];
          } else if (opcode === 4) {  // Approve — owner at index 2
            authorityIndex = ix.accountKeyIndexes[2];
          } else if (opcode === 6) {  // SetAuthority — current authority at index 1
            authorityIndex = ix.accountKeyIndexes[1];
          } else if (opcode === 12) { // TransferChecked — owner/authority at index 3
            authorityIndex = ix.accountKeyIndexes[3];
          } else if (opcode === 25) { // ApproveChecked — owner at index 2
            authorityIndex = ix.accountKeyIndexes[2];
          }

          if (authorityIndex >= 0 && relayerIndices.has(authorityIndex)) {
            const opName = DANGEROUS_TOKEN_OPCODES.get(opcode);
            return res.status(400).json({
              error: `Blocked: Transaction contains a Token ${opName} (opcode ${opcode}) with relayer as source authority. This would drain relayer token accounts.`
            });
          }
        }
      }
    }

    // 3. Balance Check
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
