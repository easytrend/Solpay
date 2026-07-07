import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function main() {
  const orderId = '6a4cd8ab8192b2468538fa61';
  const { data, error } = await supabase
    .from('p2p_transactions')
    .select('*')
    .eq('order_id', orderId);

  if (error) {
    console.error('Error:', error);
  } else {
    console.log('Record details:', JSON.stringify(data, null, 2));
  }
}
main();
