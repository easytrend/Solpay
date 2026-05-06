# Solpay - Complete Fix List

## Issues to Fix

### 1. Wallet Connection
- **Current**: Simple connect button
- **Needed**: Modal to select between Phantom/Solflare/other wallets
- **Implementation**: Add wallet selection modal with wallet detection

### 2. Token Selection
- **Current**: Shows static token list
- **Needed**: Show only tokens in connected wallet with real balances
- **Implementation**: Fetch SPL tokens from wallet, show balance + price + logo

### 3. Fiat Conversion
- **Current**: Uses CoinGecko (may be inaccurate)
- **Needed**: More accurate pricing
- **Implementation**: Use Jupiter aggregator for Solana tokens, fallback to CoinGecko

### 4. Send Functionality
- **Current**: Only charges platform fee, doesn't send tokens
- **Needed**: Actually execute token transfers
- **Implementation**: 
  - Resolve .sol domains via SNS
  - Build and send SPL token transfer transactions
  - Handle SOL transfers
  - Show transaction status

### 5. Bulk Send
- **Current**: Only charges fee, doesn't send
- **Needed**: Execute bulk transfers
- **Implementation**: Build multi-recipient transaction, execute sequentially

### 6. Template Buttons
- **Current**: Has CSV/XLSX template download buttons
- **Needed**: Remove them (per user request)
- **Implementation**: Remove the template buttons row

### 7. Receive Tab
- **Current**: Missing
- **Needed**: QR code for receiving payments
- **Implementation**: Add Receive tab with QR code generation

### 8. Wallet Tab
- **Current**: Component exists but not shown in UI
- **Needed**: Tab to view all wallet tokens
- **Implementation**: Add Wallet tab, integrate WalletTokensPanel component

### 9. Tab Navigation
- **Current**: Only Send/Bulk toggle
- **Needed**: Send / Receive / Wallet tabs
- **Implementation**: Add tab navigation system

### 10. Transaction Feedback
- **Current**: Basic alerts
- **Needed**: Better UI feedback for transactions
- **Implementation**: Toast notifications or status cards

## Implementation Plan

1. Add tab navigation (Send / Receive / Wallet)
2. Add wallet selection modal
3. Implement SNS domain resolution
4. Implement actual token transfers (single)
5. Implement bulk transfers
6. Remove template download buttons
7. Integrate wallet tokens panel
8. Add receive QR code tab
9. Improve error handling and feedback
10. Test all features

## Technical Requirements

- SNS SDK for domain resolution
- SPL Token program for token transfers
- Jupiter API for accurate pricing
- Better error handling
- Transaction confirmation UI
