# 🔷 Diamante Campaign Transaction CLI

Stress-testing tool for the Diamante Testnet. Each wallet receives tokens multiple times per round, distributed randomly.

## Quick Start

1. **Install dependencies**:

```bash
npm install
```

2. **Run:**

```bash
npm start
```

## How It Works

If you have **3 wallets** with `sendPerWallet: 2`:
- Creates 6 transactions per round (3 × 2)
- Shuffles them randomly
- Each wallet receives exactly 2 tokens, but **not consecutively**

Example order:
```
Wallet A → 1 DIAM
Wallet C → 1 DIAM
Wallet B → 1 DIAM
Wallet A → 1 DIAM  (2nd time)
Wallet C → 1 DIAM  (2nd time)
Wallet B → 1 DIAM  (2nd time)
```

## Get Your Access Token

1. Go to https://campaign.diamante.io/transactions
2. Connect your wallet
3. Open DevTools (F12) → **Application** → **Cookies**
4. Copy the `access_token` value


| Field | Description |
|-------|-------------|
| `accessToken` | Your JWT token from the campaign site |
| `sendPerWallet` | How many times each wallet receives tokens per round |
| `amountPerSend` | DIAM amount per transaction |
| `wallets` | Array of destination addresses |
| `delays` | Min/max delay between transactions (seconds) |
| `continuous` | Run multiple rounds |
| `maxIterations` | Max rounds (if continuous) |

## CLI Options

```bash
node diamante.js                                    # Use config.json
node diamante.js -t TOKEN --to ADDR1,ADDR2 -s 2     # CLI args
node diamante.js --config -c -i 5                   # 5 rounds from config
node diamante.js --fast                             # Fast mode (0.5-1s)
node diamante.js --history                          # View tx history
```

| Option | Description |
|--------|-------------|
| `--token, -t` | Access token |
| `--to` | Comma-separated addresses |
| `--amount` | Amount per send (default: 1) |
| `--sends, -s` | Sends per wallet per round (default: 2) |
| `--continuous, -c` | Run multiple rounds |
| `--iterations, -i` | Max rounds |
| `--fast, -f` | Fast mode (0.5-1s delays) |
| `--history` | Show transaction history |

## Output Example

```
══════════════════════════════════════════════════
  🔷 DIAMANTE STRESS TEST
══════════════════════════════════════════════════
  Wallets:        3
  Sends/wallet:   2
  Amount/send:    1 DIAM
  Total/round:    6 transactions (6 DIAM)
  Mode:           Single round

──────────────────────────────────────────────────
  ROUND 1 | 6 transactions
──────────────────────────────────────────────────

   [0xfb9f6d71...] Send 1/2
[14:30:15] ✅ Sent 1 DIAM → 0xfb9f6d71...f43e | 0x8a2b3c4d...7e3f
   [█████░░░░░░░░░░░░░░░░░░░░] 17%

   [0x12345678...] Send 1/2
[14:30:18] ✅ Sent 1 DIAM → 0x12345678...5678 | 0x9b3c4d5e...8f4a
   [██████████░░░░░░░░░░░░░░░] 33%

══════════════════════════════════════════════════
  📊 FINAL SUMMARY
══════════════════════════════════════════════════
  Total Txs:      6
  Successful:     6 (100.0%)
  Failed:         0
  DIAM Sent:      6.00
  Avg TPS:        0.42

  Per-Wallet:
    0xfb9f6d71...f43e: 2/2 ✓
    0x12345678...5678: 2/2 ✓
    0xabcdef12...1234: 2/2 ✓
══════════════════════════════════════════════════
```

## Requirements

- Node.js 18+ (uses native `fetch`)
