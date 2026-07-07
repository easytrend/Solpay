import { Connection } from '@solana/web3.js';
import dotenv from 'dotenv';
dotenv.config();

const rpcUrl = process.env.VITE_RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(rpcUrl, 'confirmed');

async function main() {
  const sig = 'SZCbexZufaWjEFvkmo4qdBev475CZ6UN92cfyyCDqCPKdqfxtNz7Yov3YFprJRJNtb8eZH4QpfaRioSw8JoeJ3c';
  try {
    const tx = await connection.getParsedTransaction(sig, {
      maxSupportedTransactionVersion: 0
    });
    if (!tx) {
      console.log('Transaction not found on chain');
      return;
    }
    console.log(JSON.stringify(tx, null, 2));
  } catch (err) {
    console.error('Error:', err);
  }
}
main();
