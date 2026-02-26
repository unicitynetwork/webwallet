# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

The Unicity WEB GUI Wallet (v0.4.10) is a self-contained, browser-based cryptocurrency wallet for the Unicity network. The entire application runs in a single HTML file (`index.html`, ~14,000 lines) with embedded JavaScript and CSS, requiring no build process. It supports the Alpha cryptocurrency on the consensus layer (PoW blockchain).

## Development Commands

```bash
# Run the wallet (no build needed)
python3 -m http.server 8000  # open http://localhost:8000/index.html
# Or open index.html directly in browser

# Test scripts for wallet.dat analysis
npm install
node decrypt_and_derive.js           # Full decryption + BIP32 derivation
node analyze_encrypted_wallet.js     # Analyze encrypted wallet structure
node test_wallet_decryption.js       # Test decryption logic

# Debug service (Express server, port 3487)
cd debug-service && npm install && npm start

# Migration script (requires alpha-cli)
./alpha-migrate.sh <private_key_wif> <wallet_name>

# Create GitHub release
./create_release.sh  # Update version in script first
```

## Architecture

### Single-File Design
- `index.html` contains the complete wallet with embedded CryptoJS, elliptic.js, BIP32/BIP44 HD wallet, Bech32 encoding, QR code generation, and Fulcrum WebSocket client
- All crypto runs client-side; no server dependencies
- Use `offset`/`limit` when reading with the Read tool due to file size

### Cryptographic Stack
- **Key Generation**: Web Crypto API → 32 bytes entropy → secp256k1 keypair
- **HD Derivation**: BIP44 path `m/44'/0'/{index}'` using HMAC-SHA512
- **Address Format**: P2WPKH (SegWit) with `alpha1` Bech32 prefix
- **Wallet Encryption**: AES-256 with PBKDF2 (100,000 iterations)

### Operating Modes
- **Full Wallet**: Private key control for sending/receiving
- **Watch-Only**: Monitor addresses without private keys
- **Online/Offline**: Connected to Fulcrum or air-gapped

### Storage
- IndexedDB primary, localStorage fallback
- All sensitive data encrypted before storage

## Core Functions (line numbers approximate)

### Wallet Management
- `initializeWallet()` (~1980): Generate master key from secure entropy
- `generateNewAddress()`: Derive child keys via BIP32
- `restoreFromWalletDat(file)` (~3083): Import wallet.dat (SQLite binary parsing)
  - Auto-detects: descriptor, legacy HD, legacy non-HD, encrypted wallets
  - Pattern matching: `walletdescriptorkey`, `hdchain`, `mkey`, `ckey`
- `decryptAndImportWallet()` (~3450): Decrypt encrypted wallet.dat files

### Transaction Handling
- `createTransaction()`: Build with UTXO selection
- `signTransaction()`: Offline signing
- `broadcastTransaction()`: Submit via Fulcrum
- `updateTransactionHistory()`, `updateUtxoListDisplay()`: Paginated (20/page)

### Fulcrum Integration
- `connectToElectrumServer()`: WebSocket connection
- `subscribeToAddressChanges()`: Real-time updates
- `refreshBalance()`: Fetch UTXOs and balance

## Wallet.dat Import

### Binary Format
- SQLite-based with direct binary parsing (no sql.js dependency)
- DER-encoded private keys
- Supports: descriptor (modern), legacy HD, legacy non-HD, encrypted

### Encryption (Bitcoin Core Compatible)
- SHA-512 for key derivation, AES-256-CBC encryption
- `mkey` records: encrypted master key + derivation parameters
- `ckey` records: individually encrypted keys

### Address Scanning
- Auto-scans up to 100 addresses for BIP32 wallets after import
- Chain code extraction required for BIP32 derivation

## Test Scripts

Root directory contains Node.js utilities for wallet.dat debugging (require `npm install`):
- `analyze_*.js` - Examine wallet structure and encryption
- `decrypt_*.js` - Test decryption with various wallet types
- `test_*.js` - Validate address derivation and BIP32
- `find_*.js` - Search for specific keys/paths

Test wallet files are in `ref_materials/`.

## Debug Service

Express.js microservice in `debug-service/` (port 3487):
- Collects wallet debug reports via `/api/submit-report`
- Stores reports in `reports/` directory by date
- Serves wallet at `/wallet` for testing
- Supports HTTPS with certificates in `debug-service/ssl/`

## Key Implementation Details

1. **Child Key Export**: Exports derived keys (not master) for security
2. **Auto-Hide**: Private keys hidden after 30 seconds
3. **Transaction Queue**: Rate limited to 30 per block, auto-retry on failure
4. **Vesting Classification**: Queue-based UTXO classification with persistent TXO cache
5. **Balance Verification**: Fulcrum direct balance verification with loading spinner
