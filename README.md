# 🔷 Diamante Campaign CLI

Simple CLI tool to send DIAM tokens on the Diamante Campaign.

## Features

- ✅ **EVM Private Key** - Just paste your MetaMask/OKX wallet private key
- ✅ **No Cookies** - No need to deal with expiring tokens or cf_clearance
- ✅ **Multiple Wallets** - Send to multiple recipient wallets
- ✅ **Random Amounts** - Configurable min/max amount per transaction
- ✅ **Human Delays** - Random delays between transactions

## Quick Start

```bash
# Install dependencies
npm install

# Run the CLI
npm start
```

## Configuration

On first run, you'll be asked to paste your **EVM private key**. This is your MetaMask/OKX wallet private key that you use on the campaign.

### Get Your Private Key

**MetaMask:**
1. Click the 3 dots menu → Account details
2. Click "Show private key"
3. Enter your password
4. Copy the key

**OKX Wallet:**
1. Settings → Security
2. Export private key
3. Copy the key

⚠️ **Never share your private key with anyone!**

## Settings

- **Private Key** - Your EVM wallet private key
- **Wallets** - Recipient wallet addresses (0x...)
- **Delay** - Min/max seconds between transactions (default: 90-150s)
- **Amount** - Min/max DIAM per transaction (default: 1-2)
- **Sends/Wallet** - Number of sends per wallet per round (default: 2)

## Config File

Settings are saved in `config.json`:

```json
{
    "privateKey": "0x...",
    "wallets": ["0x...", "0x..."],
    "delays": { "min": 90, "max": 150 },
    "amount": { "min": 1, "max": 2 },
    "sendPerWallet": 2
}
```

## License

MIT
