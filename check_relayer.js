import { Connection, PublicKey } from '@solana/web3.js';
import dotenv from 'dotenv';
dotenv.config();

const rpcUrl = process.env.VITE_RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(rpcUrl, 'confirmed');

async function main() {
  const relayerPubkey = new PublicKey('5xh9BFXqCgpUxGbf3QzADNze945aNSiVG9EFNa8vvb3u');
  const balance = await connection.getBalance(relayerPubkey);
  console.log('Relayer SOL Balance:', balance / 1e9, 'SOL');

  const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  try {
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(relayerPubkey, {
      mint: USDC_MINT
    });
    if (tokenAccounts.value.length === 0) {
      console.log('No USDC account found for Relayer');
      return;
    }
    const tokenAccount = tokenAccounts.value[0].account.data.parsed.info;
    console.log('Relayer USDC Account Address:', tokenAccounts.value[0].pubkey.toBase58());
    console.log('Relayer USDC Balance:', tokenAccount.tokenAmount.uiAmount, 'USDC');
  } catch (err) {
    console.error('Error fetching token accounts:', err);
  }
}
main();
