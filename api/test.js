export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const relayerSecretExists = !!process.env.RELAYER_SECRET_KEY;
  const relayerPublicKeyExists = !!process.env.VITE_RELAYER_PUBLIC_KEY;

  return res.status(200).json({
    status: 'ok',
    message: 'Test API endpoint is working successfully!',
    env: {
      relayerSecretExists,
      relayerPublicKeyExists,
      nodeVersion: process.version,
    }
  });
}
