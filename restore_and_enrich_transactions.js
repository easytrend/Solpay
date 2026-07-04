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
// Use mainnet-beta for getTransaction stability
const connection = new Connection('https://api.mainnet-beta.solana.com');

const DELETED_SIGNATURES = [
  '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',
  
  // 13 rows flagged as external DeFi
  'bFQEhHsHeis8v7EZ5VwFJ5JDJEU7AsiJJmW9iUjx94ftTTzquDWdMnprr2e1gqcNWmMEQn7CpDBLe2PPMQaiieF',
  '2MkALv9SnHxY7AYWy41DZqCeifFao3wmZT7n7RbjVekJsLSVsUuCmvbLx7GBMVuSmwnenHCafadKEPA95tof5Ft2',
  '3XJuaooYFKG3cRYqFNpgggrrRi573hRFFfHHcmHHfjSzmSBxoTdCG93zwxKdm8ioE72J7gMLUtPr2Z9HvigBPgLL',
  'ZzxMKcHYQ2nDboCLEgA4RsbvTxmsVkKzVzV4jtqshGPyZDS62D8yCva6vGH1FmjyX1ah4PpYHUDSSzFbR5qmQZh',
  '2G2jY1yd2YyvBrvYnZR3d5BuXrQoDMDVZYtJM9CfM78QCSMUHBmgyR5jDL4yHKD49EArNHfqjwM2gaDtgcvGBnXG',
  '2Ny8vQJ4ASPVr6RNNaEbopEP592yxGJ4pWruNnJorbdJyF4PE4EMZwAC12XeKFTmHD4A3UqkyDYZFx4YXfjkmDm9',
  '2Xo4saLps6WxbuVug8cj497Mtv8E9p61mwRro9suh1gWa1kfzXXQPRj8UiLrqFTAka335Ye4We97FpadYZHvwrT3',
  '37ytDm3op2f3ePT8tG9fYFmJr1cyPqhX5yeqLZzUvTrP4Hr4TKtRkgud2Ci9wT4j5uZf5Wd7gpaJUZq9vkEvYZTR',
  '2GcfvPuyTxBkn8XahMWpqy2v7NrjH9koX4x2WZoxLb75QjF6G31JvCnx7YF9V825YYBNBuV6hLf1nRx5u9DYW7FK',
  '2CXdvjWWMDQJwPYVdQ3bcwBcbucP6ZuscVHYeBgz1PDMgBKm33arAfWYX6snPpWFyfgCaYe4yYT7o3RVFhX3q8ta',
  '446wgRf5TfNg832tjJz1SUnK5udhUJSpNVMGSYvG2eZiQ5NPHgMApGEvgSzbRBYDiEDSkVa841AZ2g2oove4VzA9',
  '3zdHjNCV7n4swbBGw5NDCFchHFs1ejz75jDN1vEKiSt4iDMZ2j1riVd4fBKm7vsPKuvtoSE6KpgoSN77twpQ3iAK',
  '5fMfL9EVpP834x18qQ4tvUxGWwYjTK1DDWhdckdYx22ZZ1aoZYYAHcDGCupwqtwm1bwitFsDuvYDahjivggCtKhb'
];

// Clean deduplicated signatures list
const SIGNATURES = Array.from(new Set(DELETED_SIGNATURES));

const DEX_PROGRAMS = new Set([
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo'
]);

// Meteora programs to block completely
const BLOCKED_DEFI_PROGRAMS = new Set([
  'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', // Meteora DLMM (liquidity provision etc)
  'Eo7WjKq67rjJQSZxS6z3YkapzY3eMj6Xy8X5EQVn5UaB'  // Meteora Dynamic AMM
]);

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
  } catch (e) {}
  return null;
}

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
  } catch (e) {}
  return 0;
}

async function main() {
  console.log(`Analyzing ${SIGNATURES.length} deleted signatures for recovery...`);

  let restoredCount = 0;

  for (const sig of SIGNATURES) {
    try {
      const tx = await connection.getTransaction(sig, { maxSupportedTransactionVersion: 0 });
      if (!tx || !tx.meta) continue;

      const accountKeys = tx.transaction.message.staticAccountKeys 
        ? tx.transaction.message.staticAccountKeys.map(k => k.toBase58()) 
        : tx.transaction.message.accountKeys.map(k => k.toBase58() || k.toString());

      const feePayer = accountKeys[0];

      // 1. Check if the transaction invokes Meteora DLMM / yield programs. If so, skip/ignore.
      let hasBlockedProgram = false;
      const checkBlocked = (ix) => {
        const prog = accountKeys[ix.programIdIndex];
        if (BLOCKED_DEFI_PROGRAMS.has(prog)) hasBlockedProgram = true;
      };
      tx.transaction.message.instructions.forEach(checkBlocked);

      // We only skip if it's liquidity provision, but if it's a swap, we keep it!
      // Let's check: if there is a Jupiter program invocation, it's a swap, so we keep it!
      let isSwap = false;
      tx.transaction.message.instructions.forEach(ix => {
        const prog = accountKeys[ix.programIdIndex];
        if (DEX_PROGRAMS.has(prog)) isSwap = true;
      });

      if (hasBlockedProgram && !isSwap) {
        console.log(`  [SKIP DEFI] Signature ${sig.slice(0, 10)}... invokes Meteora/Defi yield.`);
        continue;
      }

      // Check for memo
      let memoText = '';
      const checkMemo = (ix) => {
        const prog = accountKeys[ix.programIdIndex];
        if (prog === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr') {
          memoText = String(ix.data || '');
        }
      };
      tx.transaction.message.instructions.forEach(checkMemo);

      let type = isSwap ? 'swap' : 'send';
      let symbol = 'SOL';
      let amount = 0;
      let mint = null;

      // Extract transaction timestamp
      const fullTimestamp = tx.blockTime
        ? new Date(tx.blockTime * 1000).toISOString()
        : new Date().toISOString();

      if (isSwap) {
        // Find swap amount and token details from balances
        const preToken = tx.meta.preTokenBalances || [];
        const postToken = tx.meta.postTokenBalances || [];
        
        // Find token that increased in balance for user (output token)
        for (const post of postToken) {
          if (post.owner === feePayer) {
            const pre = preToken.find(p => p.accountIndex === post.accountIndex);
            const preAmt = pre ? parseFloat(pre.uiTokenAmount?.uiAmount || 0) : 0;
            const postAmt = parseFloat(post.uiTokenAmount?.uiAmount || 0);
            if (postAmt > preAmt) {
              mint = post.mint;
              amount = postAmt - preAmt;
              break;
            }
          }
        }

        // If no token balances changed (e.g. it was SOL swap), check SOL balance change
        if (amount === 0) {
          const preBal = tx.meta.preBalances[0] || 0;
          const postBal = tx.meta.postBalances[0] || 0;
          if (postBal > preBal) {
            symbol = 'SOL';
            amount = (postBal - preBal) / 1e9;
          }
        }
      } else {
        // Send: Look for simple transfers
        let transfers = [];
        const preToken = tx.meta.preTokenBalances || [];
        
        for (const post of (tx.meta.postTokenBalances || [])) {
          if (post.owner !== feePayer) {
            const pre = preToken.find(p => p.accountIndex === post.accountIndex && p.owner === feePayer);
            if (pre) {
              const preAmt = parseFloat(pre.uiTokenAmount?.uiAmount || 0);
              const postAmt = parseFloat(post.uiTokenAmount?.uiAmount || 0);
              if (preAmt > postAmt) {
                transfers.push({
                  amount: preAmt - postAmt,
                  mint: post.mint
                });
              }
            }
          }
        }

        if (transfers.length > 0) {
          mint = transfers[0].mint;
          amount = transfers[0].amount;
        } else {
          // Sol transfer
          const preBal = tx.meta.preBalances[0] || 0;
          const postBal = tx.meta.postBalances[0] || 0;
          if (preBal > postBal) {
            amount = (preBal - postBal - tx.meta.fee) / 1e9;
          }
        }
      }

      if (mint) {
        const info = await getTokenInfo(mint);
        symbol = info?.symbol || 'USDC';
      }

      const price = mint ? await getTokenPrice(mint) : 148.50; // fallback SOL price
      const usdValue = amount * (price || 1.0);

      // Upsert back to Supabase
      const { error } = await supabase
        .from('transactions')
        .upsert({
          signature: sig,
          user_address: feePayer,
          transaction_type: type,
          token_symbol: symbol,
          token_amount: parseFloat(amount.toFixed(6)),
          usd_value: parseFloat(usdValue.toFixed(2)),
          created_at: fullTimestamp
        }, { onConflict: 'signature' });

      if (error) {
        console.error(`    ❌ Failed to restore ${sig.slice(0, 10)}:`, error.message);
      } else {
        console.log(`    [RESTORED] ${type} | ${amount.toFixed(4)} ${symbol} ($${usdValue.toFixed(2)}) | ${sig.slice(0, 8)}...`);
        restoredCount++;
      }

    } catch (e) {
      console.warn(`  Failed to restore ${sig.slice(0, 10)}...:`, e.message);
    }
    await new Promise(r => setTimeout(r, 250));
  }

  console.log(`\n✅ Recovery finished. Restored ${restoredCount} transaction logs successfully.`);
}

main().catch(console.error);
