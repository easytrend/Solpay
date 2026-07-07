import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function main() {
  console.log('Querying all tables in public schema...');
  const tables = ['transactions', 'p2p_transactions', 'paj_sessions', 'sessions', 'users'];
  for (const table of tables) {
    const { data: testData, error: testErr } = await supabase.from(table).select('*').limit(1);
    if (testErr) {
      console.log(`- Table '${table}': does NOT exist or error (${testErr.message})`);
    } else {
      console.log(`- Table '${table}': EXISTS!`);
    }
  }
}

main().catch(console.error);
