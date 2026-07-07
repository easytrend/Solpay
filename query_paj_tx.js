import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function main() {
  const walletAddress = 'D2CKUBrTWD11yspNzv596NUhGNq3eTMhHukmwo8JXiRV';
  const { data: session, error: sessionError } = await supabase
    .from('paj_sessions')
    .select('*')
    .eq('wallet_address', walletAddress)
    .maybeSingle();

  if (sessionError) {
    console.error('Session Error:', sessionError);
    return;
  }
  if (!session) {
    console.log('No active session found in paj_sessions for this wallet');
    return;
  }

  console.log('Found session token:', session.session_token);

  const orderId = '6a4cd8ab8192b2468538fa61';
  let pajTx = null;
  let fetchError = null;
  
  const baseUrls = ['https://api.paj.cash', 'https://api-staging.paj.cash'];
  for (const baseUrl of baseUrls) {
    try {
      const url = `${baseUrl}/pub/transactions/${orderId}`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${session.session_token}` }
      });
      console.log(`Fetch ${url} status:`, response.status);
      if (response.ok) {
        pajTx = await response.json();
        break;
      } else {
        const text = await response.text();
        console.log(`Response: ${text}`);
      }
    } catch (err) {
      fetchError = err;
    }
  }

  if (pajTx) {
    console.log('PajCash transaction detail:', JSON.stringify(pajTx, null, 2));
  } else {
    console.log('Failed to fetch from both URLs. Error:', fetchError);
  }
}
main();
