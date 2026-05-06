# Solpay Implementation Guide

## Complete List of Changes Needed

### 1. Add Tab Navigation System

**Location**: Inside `.card-body`, before the current content

**Add**:
```javascript
const [activeTab, setActiveTab] = React.useState("send"); // "send", "receive", "wallet"

// Tab navigation UI
<div className="tabs">
  <button className={`tab-btn ${activeTab==="send"?"active":""}`} onClick={()=>setActiveTab("send")}>Send</button>
  <button className={`tab-btn ${activeTab==="receive"?"active":""}`} onClick={()=>setActiveTab("receive")}>Receive</button>
  <button className={`tab-btn ${activeTab==="wallet"?"active":""}`} onClick={()=>setActiveTab("wallet")}>💼 Wallet</button>
</div>
```

### 2. Add Wallet Selection Modal

**Add new component before App component**:
```javascript
function WalletSelectModal({ onClose, onSelect }) {
  const [wallets, setWallets] = React.useState([]);
  
  React.useEffect(() => {
    const detected = [];
    if (window.solana?.isPhantom) detected.push({ name: "Phantom", provider: window.solana, icon: "👻" });
    if (window.solflare?.isSolflare) detected.push({ name: "Solflare", provider: window.solflare, icon: "🔥" });
    if (window.backpack) detected.push({ name: "Backpack", provider: window.backpack, icon: "🎒" });
    setWallets(detected);
  }, []);
  
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Select Wallet</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        {wallets.length === 0 ? (
          <div style={{padding:"2rem",textAlign:"center",color:"var(--text2)"}}>
            <div style={{fontSize:36,marginBottom:12}}>🔐</div>
            <div style={{fontSize:14,fontWeight:600,marginBottom:6}}>No Wallet Found</div>
            <div style={{fontSize:12}}>Install Phantom or Solflare browser extension</div>
          </div>
        ) : (
          wallets.map(w => (
            <div key={w.name} className="modal-item" onClick={() => onSelect(w.provider)}>
              <div style={{fontSize:28}}>{w.icon}</div>
              <div className="m-name">{w.name}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

### 3. Implement SNS Domain Resolution

**Add before App component**:
```javascript
async function resolveDomain(input, connection) {
  // If it's already a valid address, return it
  try {
    new window.solanaWeb3.PublicKey(input);
    return input;
  } catch {}
  
  // Try SNS resolution
  try {
    const domain = input.toLowerCase().replace('.sol', '');
    // Use Bonfida SNS resolver
    const hashedName = await getHashedName(domain);
    const nameAccountKey = await getNameAccountKey(hashedName);
    const owner = await NameRegistryState.retrieve(connection, nameAccountKey);
    return owner.owner.toBase58();
  } catch (e) {
    console.error('SNS resolution failed:', e);
    throw new Error('Invalid .sol domain or wallet address');
  }
}

async function getHashedName(name) {
  const input = Buffer.from('\0' + name, 'utf8');
  const hash = await window.crypto.subtle.digest('SHA-256', input);
  return new Uint8Array(hash);
}

async function getNameAccountKey(hashedName) {
  const SNS_PROGRAM_ID = new window.solanaWeb3.PublicKey('namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX');
  const ROOT_DOMAIN = new window.solanaWeb3.PublicKey('58PwtjSDuFHuUkYjH9BYnnQKHfwo9reZhC2zMJv9JPkx');
  const [nameAccountKey] = await window.solanaWeb3.PublicKey.findProgramAddress(
    [hashedName, Buffer.alloc(32), ROOT_DOMAIN.toBuffer()],
    SNS_PROGRAM_ID
  );
  return nameAccountKey;
}

class NameRegistryState {
  static async retrieve(connection, nameAccountKey) {
    const accountInfo = await connection.getAccountInfo(nameAccountKey);
    if (!accountInfo) throw new Error('Domain not found');
    const owner = new window.solanaWeb3.PublicKey(accountInfo.data.slice(32, 64));
    return { owner };
  }
}
```

### 4. Implement Actual Token Transfer

**Replace `handleSingleSendFee` function**:
```javascript
async function handleSingleSend() {
  if (!connected || !walletPubkey) return;
  if (!recipient || !(parseFloat(amount) > 0)) return;
  
  try {
    setSendingFee(true);
    const provider = window.solana || window.solflare;
    const connection = new window.solanaWeb3.Connection(RPC_LIST[0]);
    
    // Resolve recipient address
    const recipientAddress = await resolveDomain(recipient, connection);
    const recipientPubkey = new window.solanaWeb3.PublicKey(recipientAddress);
    const fromPubkey = provider.publicKey;
    
    // Calculate amounts
    const tokenAmount = tokAmt;
    
    // Build transaction based on token type
    let tx;
    if (tok.symbol === 'SOL') {
      // SOL transfer
      const lamports = toLamports(tokenAmount);
      tx = new window.solanaWeb3.Transaction().add(
        window.solanaWeb3.SystemProgram.transfer({
          fromPubkey,
          toPubkey: recipientPubkey,
          lamports
        })
      );
    } else {
      // SPL Token transfer
      // This requires finding the token accounts and using SPL token program
      alert('SPL token transfers coming soon! For now, only SOL transfers are supported.');
      setSendingFee(false);
      return;
    }
    
    // Add platform fee
    const feeSol = computeFeeSolFromTokenAmount(tokenAmount, tokLive.price, liveSolPrice);
    const feePubkey = new window.solanaWeb3.PublicKey(FEE_WALLET);
    tx.add(
      window.solanaWeb3.SystemProgram.transfer({
        fromPubkey,
        toPubkey: feePubkey,
        lamports: toLamports(feeSol)
      })
    );
    
    // Send transaction
    const sig = await provider.signAndSendTransaction(tx);
    const txId = sig?.signature || sig;
    
    alert(`✅ Transfer successful!\\n\\nTransaction: ${txId}\\n\\nSent ${fmtTok(tokenAmount)} ${tok.symbol} to ${recipient}`);
    await fetchBalances(walletPubkey);
  } catch (e) {
    alert('❌ Transfer failed: ' + (e.message || e));
    console.error('Transfer failed:', e);
  } finally {
    setSendingFee(false);
  }
}
```

### 5. Remove Template Download Buttons

**Find and remove**:
```javascript
<div className="tmpl-btns">
  <button className="tmpl-btn" onClick={dlTemplate}>📄 CSV template</button>
  <button className="tmpl-btn" onClick={dlTemplate}>📊 XLSX template</button>
</div>
```

### 6. Add Receive Tab Content

**Add new component**:
```javascript
function ReceivePanel({ walletPubkey }) {
  const [copied, setCopied] = React.useState(false);
  
  const copyAddress = () => {
    navigator.clipboard.writeText(walletPubkey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  if (!walletPubkey) {
    return (
      <div className="no-wallet">
        <div className="no-wallet-icon">🔐</div>
        <div className="no-wallet-title">Connect your wallet</div>
        <div className="no-wallet-sub">Connect to view your receive address and QR code</div>
      </div>
    );
  }
  
  return (
    <div>
      <div className="card-title">Receive Crypto</div>
      <p className="card-sub">Share your wallet address or QR code to receive payments</p>
      
      <div className="qr-wrap">
        <QRGen domain={walletPubkey} />
        <div className="qr-domain">{walletPubkey.slice(0,8)}...{walletPubkey.slice(-8)}</div>
        <div className="qr-label">Your Solana Wallet Address</div>
        <button className={`copy-btn ${copied?"copy-ok":""}`} onClick={copyAddress}>
          {copied ? "✓ Copied!" : "📋 Copy Address"}
        </button>
      </div>
    </div>
  );
}
```

### 7. Integrate Wallet Tab

**In App component, add conditional rendering**:
```javascript
{activeTab === "send" && (
  // existing send UI
)}
{activeTab === "receive" && (
  <ReceivePanel walletPubkey={walletPubkey} />
)}
{activeTab === "wallet" && (
  <WalletTokensPanel
    walletPubkey={walletPubkey}
    solBalance={solBalance}
    splTokens={splTokens}
    loading={walletLoading}
    error={walletError}
    onRefresh={() => fetchBalances(walletPubkey)}
    solPrice={liveSolPrice}
  />
)}
```

### 8. Update Connect Wallet Function

**Replace `connectWallet` function**:
```javascript
const [showWalletSelect, setShowWalletSelect] = React.useState(false);

async function connectWallet() {
  setShowWalletSelect(true);
}

async function handleWalletSelect(provider) {
  setShowWalletSelect(false);
  try {
    const resp = await provider.connect();
    const pk = resp.publicKey.toString();
    setWalletPubkey(pk);
    setConnected(true);
    fetchBalances(pk);
  } catch (e) {
    console.error('Wallet connect error:', e);
  }
}
```

### 9. Add Token Logo Support

**Update token rendering to use logos**:
```javascript
<img 
  src={`https://img.jup.ag/tokens/${tok.mint || tok.symbol}`}
  alt={tok.symbol}
  style={{width:32,height:32,borderRadius:"50%"}}
  onError={(e) => {
    e.target.style.display = 'none';
    e.target.nextSibling.style.display = 'flex';
  }}
/>
<div className="tok-icon" style={{background:tok.bg,color:tok.color,display:"none"}}>
  {tok.symbol.slice(0,3)}
</div>
```

### 10. Improve Error Handling

**Add toast notification system**:
```javascript
function Toast({ message, type, onClose }) {
  React.useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, []);
  
  return (
    <div style={{
      position:"fixed",
      top:20,
      right:20,
      background: type==="error" ? "var(--red)" : "var(--green)",
      color:"#fff",
      padding:"12px 20px",
      borderRadius:10,
      boxShadow:"0 4px 12px rgba(0,0,0,0.3)",
      zIndex:1000,
      maxWidth:300
    }}>
      {message}
    </div>
  );
}
```

## Testing Checklist

- [ ] Wallet selection modal shows available wallets
- [ ] Can connect to Phantom
- [ ] Can connect to Solflare
- [ ] Token list shows only wallet tokens when connected
- [ ] Token logos display correctly
- [ ] Can switch between Send/Receive/Wallet tabs
- [ ] Receive tab shows QR code
- [ ] Can copy wallet address
- [ ] Wallet tab shows SOL balance
- [ ] Wallet tab shows SPL tokens
- [ ] Can resolve .sol domains
- [ ] Can send SOL to wallet address
- [ ] Can send SOL to .sol domain
- [ ] Platform fee is charged correctly
- [ ] Transaction confirmation shows
- [ ] Error messages display properly
- [ ] Bulk send works (if implemented)
- [ ] Template buttons are removed
- [ ] Fiat conversion is accurate
- [ ] Live rates update every 60s

## Notes

- SNS resolution requires the domain to be registered
- SPL token transfers require finding associated token accounts
- Bulk transfers should be done sequentially to avoid nonce issues
- Consider adding transaction confirmation before sending
- Add loading states for better UX
- Consider adding transaction history
