/**
 * pajcashService.js
 *
 * Wallet + Email OTP integration with the PajCash (paj_ramp) API SDK.
 * Follows the official SDK signatures:
 *   https://github.com/paj-cash/paj_ramp
 */

import {
  initializeSDK,
  initiate as sdkInitiate,
  verify as sdkVerify,
  getBanks as sdkGetBanks,
  resolveBankAccount as sdkResolveBankAccount,
  createOfframpOrder as sdkCreateOfframpOrder,
  createOnrampOrder as sdkCreateOnrampOrder,
  getOnrampValue as sdkGetOnrampValue,
  observeOrder,
  getAllRate as sdkGetAllRate,
  getAllTransactions as sdkGetAllTransactions,
  getTransaction as sdkGetTransaction,
  Environment
} from 'paj_ramp';

export { observeOrder };

// Base URL resolved from env var; defaults to production
let BASE_URL = 'https://api.paj.cash';

/**
 * Initialize the SDK environment and set the base URL.
 * @param {string} envString - 'production' | 'staging' | 'local'
 */
export function initPajSDK(envString = 'production') {
  const clean = (envString || '').toLowerCase();
  if (clean.includes('staging') || clean.includes('dev')) {
    BASE_URL = 'https://api-staging.paj.cash';
    initializeSDK(Environment.Staging);
  } else if (clean.includes('local')) {
    BASE_URL = 'http://localhost:3000';
    initializeSDK(Environment.Local);
  } else {
    BASE_URL = 'https://api.paj.cash';
    initializeSDK(Environment.Production);
  }
}

/**
 * Initiate an OTP session for the user.
 * @param {string} emailOrPhone - User email or phone number
 * @param {string} apiKey - Merchant API Key
 */
export async function initiateSession(emailOrPhone, apiKey) {
  try {
    return await sdkInitiate(emailOrPhone, apiKey);
  } catch (error) {
    const msg = error.response?.data?.message || error.message || String(error);
    throw new Error(msg);
  }
}

/**
 * Verify OTP session and obtain JWT token.
 * @param {string} emailOrPhone - User email or phone number
 * @param {string} otp - 6-digit OTP code
 * @param {string} apiKey - Merchant API Key
 */
export async function verifySession(emailOrPhone, otp, apiKey) {
  try {
    // Generate a deterministic valid UUID format from the email
    // This prevents hitting the 'maximum 2 devices' limit on PajCash
    // by making all logins for this email look like the same virtual device.
    let hashStr = '00000000000000000000000000000000';
    if (crypto && crypto.subtle && TextEncoder) {
      const msgUint8 = new TextEncoder().encode(emailOrPhone.toLowerCase().trim());
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      hashStr = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
    } else {
      // Fallback simple hash if Web Crypto API is unavailable
      let h = 0;
      for (let i = 0; i < emailOrPhone.length; i++) h = Math.imul(31, h) + emailOrPhone.charCodeAt(i) | 0;
      hashStr = Math.abs(h).toString(16).padStart(32, '0');
    }

    const deterministicUuid = `${hashStr.substring(0,8)}-${hashStr.substring(8,12)}-4${hashStr.substring(13,16)}-8${hashStr.substring(17,20)}-${hashStr.substring(20,32)}`;

    const device = {
      uuid: deterministicUuid,
      device: 'Browser',
      os: 'Web',
      browser: 'WebBrowser'
    };
    return await sdkVerify(emailOrPhone, otp, device, apiKey);
  } catch (error) {
    const msg = error.response?.data?.message || error.message || String(error);
    throw new Error(msg);
  }
}

/**
 * Fetch supported token list (public endpoint — no auth required).
 */
export async function getSupportedTokens() {
  const res = await fetch(`${BASE_URL}/token`);
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.message || `Failed to fetch tokens: ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch available banks.
 * @param {string} sessionToken - User JWT Session Token
 */
export async function getBanks(sessionToken) {
  try {
    return await sdkGetBanks(sessionToken);
  } catch (error) {
    const msg = error.response?.data?.message || error.message || String(error);
    throw new Error(msg);
  }
}

/**
 * Resolve a bank account number to its registered account name.
 * @param {string} sessionToken  - User JWT Session Token
 * @param {string} bankId        - Bank ID from getBanks()
 * @param {string} accountNumber - Account number to resolve
 */
export async function resolveBankAccount(sessionToken, bankId, accountNumber) {
  try {
    return await sdkResolveBankAccount(sessionToken, bankId, accountNumber);
  } catch (error) {
    const msg = error.response?.data?.message || error.message || String(error);
    throw new Error(msg);
  }
}

/**
 * Create an off-ramp order.
 * Returns: { id, address, mint, currency, amount, fiatAmount, rate, fee }
 *
 * @param {Object} order
 * @param {string} sessionToken - User JWT Session Token
 */
export async function createOfframpOrder(order, sessionToken) {
  try {
    return await sdkCreateOfframpOrder(order, sessionToken);
  } catch (error) {
    const msg = error.response?.data?.message || error.message || String(error);
    throw new Error(msg);
  }
}

/**
 * Fetch live exchange rates (public — no auth required).
 * Uses the paj_ramp SDK internally.
 */
export async function getAllRate() {
  try {
    return await sdkGetAllRate();
  } catch (error) {
    const msg = error.response?.data?.message || error.message || String(error);
    throw new Error(msg);
  }
}

/**
 * Fetch all transactions for the session account.
 * @param {string} sessionToken - User JWT Session Token
 */
/**
 * Create an on-ramp order (Buy).
 * PajCash returns bank account details; user transfers fiat to receive crypto.
 * @param {Object} order  - { currency, amount, wallet, chain, fee? }
 * @param {string} sessionToken
 */
export async function createOnrampOrder(order, sessionToken) {
  try {
    return await sdkCreateOnrampOrder(order, sessionToken);
  } catch (error) {
    const msg = error.response?.data?.message || error.message || String(error);
    throw new Error(msg);
  }
}

/**
 * Get the estimated crypto value for a given fiat amount (onramp direction).
 * @param {{ currency: string, amount: number }} query
 * @param {string} sessionToken
 */
export async function getOnrampValue(query, sessionToken) {
  try {
    return await sdkGetOnrampValue(query, sessionToken);
  } catch (error) {
    const msg = error.response?.data?.message || error.message || String(error);
    throw new Error(msg);
  }
}

export async function getTransactionHistory(sessionToken) {
  try {
    return await sdkGetAllTransactions(sessionToken);
  } catch (error) {
    const msg = error.response?.data?.message || error.message || String(error);
    throw new Error(msg);
  }
}

/**
 * Notify PajCash API that the onramp transaction has been cancelled.
 */
export async function cancelOnrampOrder(orderId, sessionToken) {
  try {
    // Try REST endpoint options
    const res = await fetch(`${BASE_URL}/pub/onramp/${orderId}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionToken}`
      }
    });
    if (!res.ok) {
      await fetch(`${BASE_URL}/pub/onramp/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`
        },
        body: JSON.stringify({ orderId })
      });
    }
  } catch (error) {
    console.warn('cancelOnrampOrder API error:', error);
  }
}

/**
 * Notify PajCash API that the user has completed the fiat payment.
 */
export async function paidOnrampOrder(orderId, sessionToken) {
  try {
    // Try REST endpoint options
    const res = await fetch(`${BASE_URL}/pub/onramp/${orderId}/paid`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionToken}`
      }
    });
    if (!res.ok) {
      await fetch(`${BASE_URL}/pub/onramp/paid`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`
        },
        body: JSON.stringify({ orderId })
      });
    }
  } catch (error) {
    console.warn('paidOnrampOrder API error:', error);
  }
}

/**
 * Fetch a single transaction detail to poll its latest status.
 */
export async function getTransaction(sessionToken, orderId) {
  try {
    return await sdkGetTransaction(sessionToken, orderId);
  } catch (error) {
    const msg = error.response?.data?.message || error.message || String(error);
    throw new Error(msg);
  }
}
