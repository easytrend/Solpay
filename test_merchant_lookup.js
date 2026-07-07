import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const apiKey = process.env.VITE_PAJCASH_API_KEY;
  if (!apiKey) {
    console.error('VITE_PAJCASH_API_KEY is not defined in env');
    return;
  }

  const orderId = '6a4cd8ab8192b2468538fa61';
  const baseUrls = ['https://api.paj.cash', 'https://api-staging.paj.cash'];
  
  for (const baseUrl of baseUrls) {
    try {
      const url = `${baseUrl}/pub/transactions/${orderId}`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      console.log(`Fetch ${url} status:`, response.status);
      if (response.ok) {
        const data = await response.json();
        console.log('Success with Merchant API Key! Data:', JSON.stringify(data, null, 2));
        return;
      } else {
        const text = await response.text();
        console.log(`Response: ${text}`);
      }
    } catch (err) {
      console.error('Error fetching:', err);
    }
  }
}
main();
