const https = require('https');
const data = JSON.stringify({
  quoteResponse: {
    inputMint: "So11111111111111111111111111111111111111112",
    inAmount: "10000",
    outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    outAmount: "10000",
    otherAmountThreshold: "10000",
    swapMode: "ExactIn",
    slippageBps: 50,
    platformFee: null,
    priceImpactPct: "0",
    routePlan: [
      {
        swapInfo: {
          ammKey: "4BmsEAnC1u8DofTusW6Tofbto7h2o5aP5qL89K6L1c6A",
          label: "Whirlpool",
          inputMint: "So11111111111111111111111111111111111111112",
          outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          inAmount: "10000",
          outAmount: "10000",
          feeAmount: "1",
          feeMint: "So11111111111111111111111111111111111111112"
        },
        percent: 100
      }
    ],
    contextSlot: 1000
  },
  userPublicKey: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  //feeAccount: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  feePayer: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN"
});

const req = https.request('https://api.jup.ag/swap/v1/swap', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
}, (res) => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => console.log(body));
});
req.write(data);
req.end();
