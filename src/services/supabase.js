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
      const status = order.status || order.state;
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
  try {
    const { error } = await supabase
      .from('paj_sessions')
      .upsert(
        {
          wallet_address: walletAddress,
          email,
          session_token: token,
          expires_at: new Date(expiryMs).toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'wallet_address' }
      );
    if (error) console.warn('[Supabase] saveSession failed:', error.message);
  } catch (err) {
    console.warn('[Supabase] saveSession error:', err.message);
  }
}

/**
 * Load a PajCash session from Supabase for a given wallet address.
 * Returns the row object or null if not found / expired.
 *
 * @param {string} walletAddress - User's Solana public key (base58)
 * @returns {{ email: string, session_token: string, expires_at: string } | null}
 */
export async function loadSession(walletAddress) {
  if (!supabase || !walletAddress) return null;
  try {
    const { data, error } = await supabase
      .from('paj_sessions')
      .select('email, session_token, expires_at')
      .eq('wallet_address', walletAddress)
      .single();

    if (error || !data) return null;

    // Check if token has expired
    if (new Date(data.expires_at).getTime() < Date.now()) {
      // Clean up expired row silently
      await supabase.from('paj_sessions').delete().eq('wallet_address', walletAddress);
      return null;
    }

    return data;
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

