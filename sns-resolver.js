// SNS Domain Resolution Module
// Resolves .sol domains to Solana wallet addresses

const SNS_PROGRAM_ID = "namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX";
const ROOT_DOMAIN_ACCOUNT = "58PwtjSDuFHuUkYjH9BYnnQKHfwo9reZhC2zMJv9JPkx";

/**
 * Resolve a .sol domain to a wallet address
 * @param {string} domain - The .sol domain (with or without .sol suffix)
 * @param {object} connection - Solana connection object
 * @returns {Promise<string|null>} - The resolved wallet address or null
 */
async function resolveSNSDomain(domain, connection) {
  try {
    // Remove .sol suffix if present
    const domainName = domain.toLowerCase().replace('.sol', '');
    
    // Check if it's already a valid Solana address
    if (isValidSolanaAddress(domainName)) {
      return domainName;
    }

    // Try to resolve via SNS
    // Note: This is a simplified version. Full SNS resolution requires the @bonfida/spl-name-service package
    // For now, we'll use a direct RPC call approach
    
    const hashedName = await getHashedName(domainName);
    const nameAccountKey = await getNameAccountKey(
      hashedName,
      undefined,
      new window.solanaWeb3.PublicKey(ROOT_DOMAIN_ACCOUNT)
    );

    const owner = await NameRegistryState.retrieve(connection, nameAccountKey);
    return owner.owner.toBase58();
  } catch (error) {
    console.error('SNS resolution failed:', error);
    return null;
  }
}

/**
 * Check if a string is a valid Solana address
 */
function isValidSolanaAddress(address) {
  try {
    const pubkey = new window.solanaWeb3.PublicKey(address);
    return window.solanaWeb3.PublicKey.isOnCurve(pubkey.toBytes());
  } catch {
    return false;
  }
}

/**
 * Hash a domain name for SNS lookup
 */
async function getHashedName(name) {
  const input = "\0" + name;
  const buffer = Buffer.from(input);
  const hash = await window.crypto.subtle.digest('SHA-256', buffer);
  return new Uint8Array(hash);
}

/**
 * Get the name account key for SNS
 */
async function getNameAccountKey(hashed_name, nameClass, parentAccount) {
  const seeds = [hashed_name];
  if (nameClass) {
    seeds.push(nameClass.toBuffer());
  } else {
    seeds.push(Buffer.alloc(32));
  }
  seeds.push(parentAccount.toBuffer());
  
  const [nameAccountKey] = await window.solanaWeb3.PublicKey.findProgramAddress(
    seeds,
    new window.solanaWeb3.PublicKey(SNS_PROGRAM_ID)
  );
  return nameAccountKey;
}

/**
 * Name Registry State class for SNS
 */
class NameRegistryState {
  static async retrieve(connection, nameAccountKey) {
    const accountInfo = await connection.getAccountInfo(nameAccountKey);
    if (!accountInfo) {
      throw new Error('Invalid name account provided');
    }
    
    // Parse the account data
    // SNS account structure: parent_name (32) + owner (32) + class (32) + data (variable)
    const owner = new window.solanaWeb3.PublicKey(accountInfo.data.slice(32, 64));
    
    return { owner };
  }
}

// Export for use in main app
window.SNSResolver = {
  resolveSNSDomain,
  isValidSolanaAddress
};
