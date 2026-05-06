// Token Logo URLs
// Using Jupiter token list and Solana token registry for logos

const TOKEN_LOGOS = {
  SOL:   "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
  USDC:  "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png",
  USDT:  "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png",
  BONK:  "https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I",
  JUP:   "https://static.jup.ag/jup/icon.png",
  RAY:   "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R/logo.png",
  PYTH:  "https://pyth.network/token.svg",
  RNDR:  "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof/logo.png",
  WIF:   "https://bafkreibk3covs5ltyqxa272uodhculbgn2dxpwgp35cxpo3sky7r7hyvt4.ipfs.nftstorage.link",
  JITO:  "https://storage.googleapis.com/token-metadata/JitoSOL-256.png",
  DRIFT: "https://drift-public.s3.eu-central-1.amazonaws.com/assets/icons/markets/drift.svg",
  ORCA:  "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE/logo.png",
  MSOL:  "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So/logo.png",
  STSOL: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj/logo.png",
  GMT:   "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/7i5KKsX2weiTkry7jA4ZwSuXGhs5eJBEjY8vVxR4pfRx/logo.png",
  GST:   "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/AFbX8oGjGpmVFywabs9DVznLDkmsnXKB46Z8ryyFngBx/logo.png",
  FIDA:  "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EchesyfXePKdLtoiZSL8pBe8Myagyy8ZRqsACNCFGnvp/logo.png",
  SLND:  "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/SLNDpmoWTVADgEdndyvWzroNL7zSi1dF9PC3xHGtPwp/logo.png",
  STEP:  "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/StepAscQoEioFxxWGnh2sLBDFp9d8rvKz2Yp39iDpyT/logo.png",
  ATLAS: "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/ATLASXmbPQxBUYbxPsV97usA3fPQYEqzQBUHgiFCUsXx/logo.png",
  SAMO:  "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU/logo.png",
  MNGO:  "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/MangoCzJ36AjZyKwVj3VnYU4GTonjfVEnJmvvWaxLac/logo.png",
  SRM:   "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/SRMuApVNdxXokk5GT7XD5cUUgXMBCoAz2LHeuAoKWRt/logo.png",
};

// Mint address to logo mapping
const MINT_LOGOS = {
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v": TOKEN_LOGOS.USDC,
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB": TOKEN_LOGOS.USDT,
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263": TOKEN_LOGOS.BONK,
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN":  TOKEN_LOGOS.JUP,
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R": TOKEN_LOGOS.RAY,
  "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3": TOKEN_LOGOS.PYTH,
  "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm": TOKEN_LOGOS.WIF,
  "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE":  TOKEN_LOGOS.ORCA,
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So":  TOKEN_LOGOS.MSOL,
};

/**
 * Get logo URL for a token by symbol or mint address
 */
function getTokenLogo(symbolOrMint) {
  if (!symbolOrMint) return null;
  // Try symbol first
  const bySymbol = TOKEN_LOGOS[symbolOrMint.toUpperCase()];
  if (bySymbol) return bySymbol;
  // Try mint address
  const byMint = MINT_LOGOS[symbolOrMint];
  if (byMint) return byMint;
  // Try Jupiter token list API
  return `https://img.jup.ag/tokens/${symbolOrMint}`;
}

/**
 * Fetch token metadata from Jupiter token list
 */
async function fetchJupiterTokenList() {
  try {
    const r = await fetch('https://token.jup.ag/strict');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const tokens = await r.json();
    const map = {};
    tokens.forEach(t => {
      map[t.address] = {
        symbol: t.symbol,
        name: t.name,
        logo: t.logoURI,
        decimals: t.decimals
      };
    });
    return map;
  } catch (e) {
    console.warn('Jupiter token list failed:', e.message);
    return {};
  }
}

window.TokenLogos = {
  TOKEN_LOGOS,
  MINT_LOGOS,
  getTokenLogo,
  fetchJupiterTokenList
};
