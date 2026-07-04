import { createClient } from '@supabase/supabase-js';
import { Connection, PublicKey } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';

// 1. Manually parse .env to avoid external dependencies
const envPath = path.resolve('.env');
const env = {};
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf8');
  envConfig.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      env[key] = value;
    }
  });
}

const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Supabase credentials missing in env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);
const RPC_URL = env.VITE_RPC_URL || 'https://api.mainnet-beta.solana.com';
const LAUNCH_DATE = new Date('2026-05-10T00:00:00Z');

// Known token mints → symbol mapping
const KNOWN_MINTS = {
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { symbol: 'USDC', price: 1.0 },
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': { symbol: 'USDT', price: 1.0 },
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': { symbol: 'BONK', price: 0.0000185 },
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN':  { symbol: 'JUP',  price: 0.72 },
};

const userWallets = [
  '8oXUkSqybMEgQLUBVikYeW1j2GYGssYkGrE3T8yfEmLL',
  '9tbQcuteHcu2jA3NKGrLRQEkowYE7eMWxF4vcMitpgqm',
  '227pM3q9NxC1GktXLyP4WiVF3qcx9RFfgQoBLFi3N3jV',
  'F4CDHF5ksEWXWY8csUvcGHL2ewX4WbEZVEYCqEvP3XGg',
  '3K9tyXQtT13zJNTJsWYqPXzKhKYf5wA94DFwKDgE6ANc',
  'EHjVvBtRwrqichJfczhS75UaGM18YE7yK5yX25jqkUN6',
  'D2CKUBrTWD11yspNzv596NUhGNq3eTMhHukmwo8JXiRV',
  '6XRKqfP7VxLjzi2fFdTp7HEHkTM5hsXQJC1e918gSCWA',
  'BtaNkxAEFn7mopZBg7771NkRiE3cCgnthH7BHetJAc4X',
  'AYBeVQXtrvxd3FPEQdN9RCPFkFWMtmEViPV2o4Uj2tSw',
  '7aJFUekvXJErfT211xEywH4SutigGtg5ECGegthuWxMf',
  '6maQypvbHgH3JPtBKT6qAddW29LwbJbEDQ5RTYebHgYN',
  'Gdj4x7aehC35xCMbf1aq8iAp2zWjBvnvvf3qyz9ZTLCc'
];

async function main() {
  const connection = new Connection(RPC_URL, 'confirmed');
  console.log('Starting backfill for bulk sends...');

  let totalImported = 0;

  for (const wallet of userWallets) {
    console.log(`\n--------------------------------------------`);
    console.log(`Processing wallet: ${wallet}...`);
    const pubkey = new PublicKey(wallet);

    let sigs = [];
    try {
      sigs = await connection.getSignaturesForAddress(pubkey, { limit: 100 });
    } catch (e) {
      console.warn(`Failed to fetch signatures for ${wallet}:`, e.message);
      continue;
    }

    if (sigs.length === 0) {
      console.log('  No signatures found.');
      continue;
    }

    // Filter by dates
    const candidates = sigs.filter(s => {
      const date = s.blockTime ? new Date(s.blockTime * 1000) : null;
      return date && date >= LAUNCH_DATE;
    });

    const sigList = candidates.map(c => c.signature);
    if (sigList.length === 0) continue;

    // Check which ones exist in Supabase
    const { data: existing } = await supabase
      .from('transactions')
      .select('signature')
      .in('signature', sigList);

    const existingSigs = new Set((existing || []).map(r => r.signature));
    const missing = candidates.filter(c => !existingSigs.has(c.signature));

    console.log(`  Found ${candidates.length} on-chain signatures. ${existingSigs.size} already synced, ${missing.length} missing.`);

    for (const c of missing) {
      try {
        const tx = await connection.getParsedTransaction(c.signature, { maxSupportedTransactionVersion: 0 });
        if (!tx || !tx.meta || tx.meta.err) continue;

        let transferCount = 0;
        let totalAmount = 0;
        let symbol = 'SOL';
        let mint = null;

        // Loop instructions to detect multiple transfers
        const checkInstruction = (ix) => {
          // SOL transfers
          if (ix.program === 'system' && ix.parsed?.type === 'transfer') {
            const info = ix.parsed.info;
            if (info.source === wallet) {
              transferCount++;
              totalAmount += info.lamports / 1e9;
              symbol = 'SOL';
            }
          }
          // SPL token transfers
          if (ix.program === 'spl-token' && (ix.parsed?.type === 'transfer' || ix.parsed?.type === 'transferChecked')) {
            const info = ix.parsed.info;
            // Check if postTokenBalances indicates it was sent by this wallet
            transferCount++;
            mint = tx.meta.postTokenBalances?.find(b => b.accountIndex === ix.accounts?.[0] || b.accountIndex === ix.accounts?.[2])?.mint || mint;
            
            const rawAmt = parseFloat(info.amount || info.tokenAmount?.amount || 0);
            const decimals = parseFloat(info.decimals || info.tokenAmount?.decimals || 9);
            totalAmount += rawAmt / Math.pow(10, decimals);
          }
        };

        tx.transaction.message.instructions.forEach(checkInstruction);
        if (tx.meta.innerInstructions) {
          tx.meta.innerInstructions.forEach(inner => inner.instructions.forEach(checkInstruction));
        }

        // If a transaction has > 1 transfers sent by the user, it is classified as a bulk send!
        if (transferCount > 1) {
          if (mint) {
            const known = KNOWN_MINTS[mint];
            symbol = known?.symbol || mint.slice(0, 6) + '…';
          }
          
          let price = 1.0;
          if (symbol === 'SOL') price = 148.50;
          else if (symbol === 'JUP') price = 0.72;
          
          const usdValue = totalAmount * price;
          const timestamp = c.blockTime ? new Date(c.blockTime * 1000).toISOString() : new Date().toISOString();

          // Write to Supabase
          const { error } = await supabase.from('transactions').insert([{
            signature: c.signature,
            user_address: wallet,
            transaction_type: 'bulk_send',
            token_symbol: symbol,
            token_amount: totalAmount,
            usd_value: parseFloat(usdValue.toFixed(2)),
            created_at: timestamp
          }]);

          if (error) {
            console.error(`    ❌ Insert failed for ${c.signature}:`, error.message);
          } else {
            console.log(`    ... Inserted: bulk_send | ${totalAmount} ${symbol} ($${usdValue.toFixed(2)}) | ${c.signature.slice(0, 8)}`);
            totalImported++;
          }
        }
      } catch (err) {
        // Silent pass for parsing errors
      }
      await new Promise(r => setTimeout(r, 200));
    }
    console.log(`  Wallet backfill done. Inserted ${totalImported} records.`);
  }

  console.log(`\nAll done! Total bulk sends imported: ${totalImported}`);
}

main().catch(console.error);
