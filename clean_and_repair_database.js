import { createClient } from '@supabase/supabase-js';
import { Connection, PublicKey } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';

// 1. Parse .env
const envPath = path.resolve('.env');
const env = {};
if (fs.existsSync(envPath)) {
  const envConfig = fs.readFileSync(envPath, 'utf8');
  envConfig.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) env[match[1]] = (match[2] || '').trim().replace(/^["']|["']$/g, '');
  });
}

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
const connection = new Connection(env.VITE_RPC_URL || 'https://api.mainnet-beta.solana.com');

// Cache for token symbol/decimals from Jupiter API
const tokenCache = {};
async function getTokenInfo(mint) {
  if (tokenCache[mint]) return tokenCache[mint];
  try {
    const res = await fetch(`https://tokens.jup.ag/token/${mint}`);
    if (res.ok) {
      const data = await res.json();
      if (data && data.symbol) {
        tokenCache[mint] = { symbol: data.symbol, decimals: data.decimals || 9 };
        return tokenCache[mint];
      }
    }
  } catch (e) {
    // console.warn(`Failed to fetch token metadata for ${mint}`);
  }
  return null;
}

// Cache for token price from Jupiter Price API
const priceCache = {};
async function getTokenPrice(mint) {
  if (priceCache[mint]) return priceCache[mint];
  try {
    const res = await fetch(`https://api.jup.ag/price/v2?ids=${mint}`);
    if (res.ok) {
      const json = await res.json();
      const price = parseFloat(json?.data?.[mint]?.price);
      if (price > 0) {
        priceCache[mint] = price;
        return price;
      }
    }
  } catch (e) {
    // console.warn(`Failed to fetch price for ${mint}`);
  }
  return 0;
}

async function main() {
  console.log('--- STARTING DATABASE REPAIR AND PURGE ---');
  const { data: rows, error } = await supabase.from('transactions').select('*');

  if (error) {
    console.error('Failed to fetch transactions:', error.message);
    return;
  }

  console.log(`Analyzing ${rows.length} total rows...`);

  let deletedCount = 0;
  let enrichedCount = 0;

  for (const row of rows) {
    try {
      // 1. Delete test mock signatures
      if (row.signature.startsWith('test_sig_') || row.signature.includes('1Z1Z')) {
        console.log(`  [DELETE] Removing test/mock transaction: ${row.signature}`);
        await supabase.from('transactions').delete().eq('signature', row.signature);
        deletedCount++;
        continue;
      }

      // Fetch transaction from Solana
      const tx = await connection.getParsedTransaction(row.signature, { maxSupportedTransactionVersion: 0 });
      if (!tx || !tx.meta) {
        // If not found on-chain, it might be an invalid test log; delete it
        console.log(`  [DELETE] Transaction not found on-chain: ${row.signature}`);
        await supabase.from('transactions').delete().eq('signature', row.signature);
        deletedCount++;
        continue;
      }

      // Extract memo
      let memoText = '';
      const checkMemo = (ix) => {
        if (ix.programId.toBase58() === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr') {
          memoText = ix.parsed || String(ix.data || '');
        }
      };
      tx.transaction.message.instructions.forEach(checkMemo);
      if (tx.meta.innerInstructions) {
        tx.meta.innerInstructions.forEach(inner => inner.instructions.forEach(checkMemo));
      }

      // 2. EXCLUDE DEFI: If it does not contain a 'fiatwallet:' or 'pajcash:' memo, it was NOT made on your app!
      // We will delete it to filter out external DeFi activities (liquidity provision on Meteora, external swaps, etc.)
      const isAppTx = memoText.includes('fiatwallet:') || memoText.includes('pajcash:');
      
      if (!isAppTx) {
        console.log(`  [DELETE] External DeFi / Non-app transaction: ${row.signature.slice(0, 10)}... | Type: ${row.transaction_type}`);
        await supabase.from('transactions').delete().eq('signature', row.signature);
        deletedCount++;
        continue;
      }

      // 3. ENRICH SWAP DETAILS: If it's a swap, ensure token symbol and USD value are correct
      if (row.transaction_type === 'swap') {
        const parts = memoText.split(':');
        // fiatwallet:swap:MINT_OR_SYMBOL:AMOUNT
        const tokenPart = parts[2];
        const amountPart = parseFloat(parts[3]) || 0;

        let verifiedSymbol = tokenPart || 'SOL';
        let verifiedPrice = 0;

        // If the tokenPart is a mint address, fetch verified metadata
        if (tokenPart && tokenPart.length > 10) {
          const info = await getTokenInfo(tokenPart);
          if (info) verifiedSymbol = info.symbol;
          verifiedPrice = await getTokenPrice(tokenPart);
        } else {
          // Resolve standard symbols to mints to get price
          const standardMints = {
            'USDC': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
            'USDT': 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
            'SOL': 'So11111111111111111111111111111111111111112',
            'JUP': 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
            'BONK': 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
          };
          const mint = standardMints[verifiedSymbol];
          if (mint) verifiedPrice = await getTokenPrice(mint);
        }

        // If price is still 0, try resolving price of output token
        if (verifiedPrice === 0 && tx.meta.postTokenBalances) {
          const userBals = tx.meta.postTokenBalances.filter(b => b.owner === row.user_address);
          for (const bal of userBals) {
            const price = await getTokenPrice(bal.mint);
            if (price > 0) {
              const info = await getTokenInfo(bal.mint);
              verifiedSymbol = info?.symbol || verifiedSymbol;
              verifiedPrice = price;
              break;
            }
          }
        }

        // Calculate USD value
        const calculatedUsd = amountPart * (verifiedPrice || 148.50);

        if (row.token_symbol !== verifiedSymbol || row.usd_value === 0 || row.usd_value !== calculatedUsd) {
          console.log(`  [UPDATE SWAP] ${row.signature.slice(0, 10)}... | Symbol: ${verifiedSymbol} | Quantity: ${amountPart} | USD: $${calculatedUsd.toFixed(2)}`);
          await supabase.from('transactions').update({
            token_symbol: verifiedSymbol,
            token_amount: amountPart,
            usd_value: parseFloat(calculatedUsd.toFixed(2))
          }).eq('signature', row.signature);
          enrichedCount++;
        }
      }

    } catch (e) {
      console.warn(`  Failed to process signature ${row.signature.slice(0, 10)}:`, e.message);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n--- DATABASE REPAIR & CLEANUP FINISHED ---`);
  console.log(`- Deleted (External DeFi / Mock): ${deletedCount} rows`);
  console.log(`- Updated (Swap Symbols & USD Value): ${enrichedCount} rows`);
}

main().catch(console.error);
