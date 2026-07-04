import { createClient } from '@supabase/supabase-js';
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

async function main() {
  console.log('Testing P2P update in Supabase...');
  const orderId = '6a48b5948d3e1d72f2fd6ebb';
  
  const patch = { status: 'COMPLETED', updated_at: new Date().toISOString() };
  
  const { data, error } = await supabase
    .from('p2p_transactions')
    .update(patch)
    .eq('order_id', orderId)
    .select();

  if (error) {
    console.error('❌ Update failed:', error.message);
  } else {
    console.log('✅ Update successful! Returned data:', data);
  }
}

main().catch(console.error);
