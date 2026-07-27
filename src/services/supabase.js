import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = (supabaseUrl && supabaseAnonKey)
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

/**
 * Log a general on-chain transaction (send, swap, bulk_send, claims).
 */
export async function logTransaction({ signature, userAddress, type, symbol, tokenAmount, usdValue }) {
  if (!supabase || !signature) return;

  try {
    const { error } = await supabase
      .from('transactions')
      .upsert(
        {
          signature,
          user_address: userAddress,
          transaction_type: type,
          token_symbol: symbol,
          token_amount: parseFloat(tokenAmount) || 0,
          usd_value: parseFloat(usdValue) || 0,
        },
        { onConflict: 'signature' }
      );

    if (error) console.warn('[Supabase] logTransaction failed:', error.message);
  } catch (err) {
    console.warn('[Supabase] logTransaction error:', err.message);
  }
}

/**
 * Log a live P2P transaction (onramp or offramp) with full metadata.
 */
export async function logP2PTransaction({
  signature,
  userAddress,
  orderId,
  tokenSymbol,
  cryptoAmount,
  fiatCurrency,
  fiatAmount,
  usdValue,
  bankName,
  accountNumber,
  accountName,
  status = 'INIT',
  userEmail,
  depositAddress,
  type = 'p2p_offramp',
}) {
  if (!supabase || !orderId) return;

  const actualSignature = signature || `pending_${type}_${orderId}`;

  const payload = {
    signature: actualSignature,
    user_address: userAddress,
    order_id: String(orderId),
    transaction_type: type,
    token_symbol: tokenSymbol,
    crypto_amount: parseFloat(cryptoAmount) || 0,
    fiat_currency: fiatCurrency,
    fiat_amount: parseFloat(fiatAmount) || 0,
    usd_value: parseFloat(usdValue) || 0,
    bank_name: bankName || null,
    account_number: accountNumber || null,
    account_name: accountName || null,
    status: status || 'INIT',
    user_email: userEmail || null,
    deposit_address: depositAddress || null,
    updated_at: new Date().toISOString(),
  };

  try {
    const [{ error: p2pError }, { error: txError }] = await Promise.all([
      supabase.from('p2p_transactions').upsert(payload, { onConflict: 'signature' }),
      supabase.from('transactions').upsert(
        {
          signature: actualSignature,
          user_address: userAddress,
          transaction_type: type,
          token_symbol: tokenSymbol,
          token_amount: parseFloat(cryptoAmount) || 0,
          usd_value: parseFloat(usdValue) || 0,
        },
        { onConflict: 'signature' }
      ),
    ]);

    if (p2pError) console.warn('[Supabase] logP2PTransaction failed:', p2pError.message);
    if (txError) console.warn('[Supabase] logP2PTransaction (transactions) failed:', txError.message);
  } catch (err) {
    console.warn('[Supabase] logP2PTransaction error:', err.message);
  }
}

/**
 * Update P2P transaction status (and optional actual signature) in Supabase.
 */
export async function updateP2PTransactionStatus(orderId, status, signature = null) {
  if (!supabase || !orderId) return;
  try {
    // Guard against overwriting terminal forwarded status
    const { data: current } = await supabase
      .from('p2p_transactions')
      .select('status')
      .eq('order_id', String(orderId))
      .maybeSingle();
      
    if (current?.status === 'FORWARDED_SUCCESS') {
      return; // Do not overwrite relayer forward status
    }

    const patch = { status: status.toUpperCase(), updated_at: new Date().toISOString() };
    if (signature) {
      patch.signature = signature;
    }
    const { error } = await supabase
      .from('p2p_transactions')
      .update(patch)
      .eq('order_id', String(orderId));

    if (error) console.warn('[Supabase] updateP2PTransactionStatus failed:', error.message);
  } catch (err) {
    console.warn('[Supabase] updateP2PTransactionStatus error:', err.message);
  }
}

/**
 * Sync PajCash API status back to Supabase for tracked P2P orders.
 */
export async function syncP2PTransactionStatuses(orders = []) {
  if (!supabase || !Array.isArray(orders) || orders.length === 0) return;

  const updates = orders
    .map((order) => {
      const orderId = order.id || order._id || order.orderId;
      const rawStatus = order.status || order.state;
      const status = rawStatus ? String(rawStatus).toUpperCase() : null;
      const signature = order.signature || order.txSignature || order.tx_hash;
      if (!orderId || !status) return null;
      return { order_id: String(orderId), status, signature: signature || null };
    })
    .filter(Boolean);

  if (updates.length === 0) return;

  try {
    await Promise.all(
      updates.map(({ order_id, status, signature }) => {
        const patch = { status, updated_at: new Date().toISOString() };
        const byOrder = supabase.from('p2p_transactions').update(patch).eq('order_id', order_id);
        if (signature) {
          return Promise.all([
            byOrder,
            supabase.from('p2p_transactions').update(patch).eq('signature', signature),
          ]);
        }
        return byOrder;
      })
    );
  } catch (err) {
    console.warn('[Supabase] syncP2PTransactionStatuses error:', err.message);
  }
}

// ── Cross-device PajCash session helpers ─────────────────────────────────────

/**
 * Save (upsert) a PajCash session to Supabase after successful OTP verification.
 * Called once per verification so any other device the user connects to can
 * restore the session automatically without re-verifying.
 *
 * @param {string} walletAddress - User's Solana public key (base58)
 * @param {string} email         - Verified email address
 * @param {string} token         - PajCash JWT session token
 * @param {number} expiryMs      - Expiry timestamp in milliseconds (Date.now() based)
 */
export async function saveSession(walletAddress, email, token, expiryMs) {
  if (!supabase || !walletAddress || !token) return;
  const row = {
    wallet_address: walletAddress,
    email,
    session_token: token,
    expires_at: new Date(expiryMs).toISOString(),
    updated_at: new Date().toISOString(),
  };
  try {
    // Strategy 1: upsert (works if wallet_address has a UNIQUE constraint)
    const { error: upsertErr } = await supabase
      .from('paj_sessions')
      .upsert(row, { onConflict: 'wallet_address' });

    if (!upsertErr) {
      console.log('[Supabase] saveSession: upsert OK for', walletAddress.slice(0, 8));
      return;
    }
    console.warn('[Supabase] saveSession: upsert failed, trying delete+insert:', upsertErr.message);

    // Strategy 2: delete all old rows then insert fresh (works if NO unique constraint)
    await supabase.from('paj_sessions').delete().eq('wallet_address', walletAddress);
    const { error: insertErr } = await supabase.from('paj_sessions').insert(row);
    if (insertErr) {
      console.warn('[Supabase] saveSession: insert also failed:', insertErr.message);
    } else {
      console.log('[Supabase] saveSession: delete+insert OK for', walletAddress.slice(0, 8));
    }
  } catch (err) {
    console.warn('[Supabase] saveSession error:', err.message);
  }
}

/**
 * Load a PajCash session from Supabase for a given wallet address.
 * Returns the row object or null if not found / expired.
 * Works regardless of whether 0, 1, or multiple rows exist for this wallet.
 *
 * @param {string} walletAddress - User's Solana public key (base58)
 * @returns {{ email: string, session_token: string, expires_at: string } | null}
 */
export async function loadSession(walletAddress) {
  if (!supabase || !walletAddress) return null;
  try {
    // Use array query with limit(1) — never throws on 0 or multiple rows
    const { data, error } = await supabase
      .from('paj_sessions')
      .select('email, session_token, expires_at')
      .eq('wallet_address', walletAddress)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (error) {
      console.warn('[Supabase] loadSession query error:', error.message);
      return null;
    }

    if (!data || data.length === 0) {
      console.log('[Supabase] loadSession: no session found for', walletAddress.slice(0, 8));
      return null;
    }

    const session = data[0];

    // Check if token has expired
    if (session.expires_at && new Date(session.expires_at).getTime() < Date.now()) {
      console.log('[Supabase] loadSession: session expired for', walletAddress.slice(0, 8));
      return null;
    }

    console.log('[Supabase] loadSession: session found for', walletAddress.slice(0, 8), '- auto-authenticating');
    return session;
  } catch (err) {
    console.warn('[Supabase] loadSession error:', err.message);
    return null;
  }
}

/**
 * Delete a PajCash session from Supabase on logout.
 *
 * @param {string} walletAddress - User's Solana public key (base58)
 */
export async function deleteSession(walletAddress) {
  if (!supabase || !walletAddress) return;
  try {
    const { error } = await supabase
      .from('paj_sessions')
      .delete()
      .eq('wallet_address', walletAddress);
    if (error) console.warn('[Supabase] deleteSession failed:', error.message);
  } catch (err) {
    console.warn('[Supabase] deleteSession error:', err.message);
  }
}

/**
 * Get all order IDs and signatures associated with a specific user's wallet address.
 */
export async function getP2PTransactionIdsByUser(walletAddress) {
  if (!supabase || !walletAddress) return { orderIds: new Set(), signatures: new Set() };
  try {
    const { data, error } = await supabase
      .from('p2p_transactions')
      .select('order_id, signature')
      .eq('user_address', walletAddress);

    if (error) {
      console.warn('[Supabase] getP2PTransactionIdsByUser failed:', error.message);
      return { orderIds: new Set(), signatures: new Set() };
    }

    const orderIds = new Set(data.map(r => String(r.order_id)));
    const signatures = new Set(data.map(r => String(r.signature)).filter(s => s && s !== 'null'));
    return { orderIds, signatures };
  } catch (err) {
    console.warn('[Supabase] getP2PTransactionIdsByUser error:', err.message);
    return { orderIds: new Set(), signatures: new Set() };
  }
}

