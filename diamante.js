#!/usr/bin/env node
/**
 * 🔷 Diamante Campaign Transaction CLI
 * 
 * Stress-testing tool for the Diamante Testnet Campaign.
 * Each wallet receives tokens multiple times per round, randomly distributed.
 * 
 * Usage:
 *   node diamante.js                           # Use config.json
 *   node diamante.js --token TOKEN --to ADDR   # CLI args
 */

const fs = require('fs');
const path = require('path');

// ============================================================================
// Configuration
// ============================================================================
const API_URL = 'https://campapi.diamante.io/api/v1/transaction/transfer';
const HISTORY_URL = 'https://campapi.diamante.io/api/v1/transaction/history';
const CONFIG_FILE = path.join(__dirname, 'config.json');

// Delays loaded from config.json
let MIN_DELAY = 1.5;
let MAX_DELAY = 4.0;

// Colors
const C = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    cyan: '\x1b[96m',
    green: '\x1b[92m',
    yellow: '\x1b[93m',
    red: '\x1b[91m',
    gray: '\x1b[90m',
    magenta: '\x1b[95m',
};

// ============================================================================
// Utilities
// ============================================================================
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const humanDelay = async () => {
    const delay = MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY);
    console.log(`${C.gray}   ⏳ Waiting ${delay.toFixed(1)}s...${C.reset}`);
    await sleep(delay * 1000);
};

const time = () => new Date().toLocaleTimeString('en-US', { hour12: false });

const log = (msg, type = 'info') => {
    const colors = { info: C.cyan, success: C.green, warn: C.yellow, error: C.red };
    console.log(`${C.bold}[${time()}]${C.reset} ${colors[type] || ''}${msg}${C.reset}`);
};

const extractUserId = (token) => {
    try {
        const payload = Buffer.from(token.split('.')[1], 'base64').toString();
        return JSON.parse(payload).userId;
    } catch {
        return null;
    }
};

const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
};

const progressBar = (curr, total) => {
    const w = 25;
    const f = Math.floor(w * curr / total);
    return '█'.repeat(f) + '░'.repeat(w - f);
};

const loadConfig = () => {
    if (!fs.existsSync(CONFIG_FILE)) return null;
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (e) {
        log(`Config error: ${e.message}`, 'error');
        return null;
    }
};

// ============================================================================
// API Client
// ============================================================================
class DiamanteSender {
    constructor(token, userId = null) {
        this.token = token;
        this.userId = userId || extractUserId(token);
        this.stats = { total: 0, success: 0, failed: 0, amount: 0, start: null };

        // Use exact browser headers to avoid "Unsupported Agent" block
        this.headers = {
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Content-Type': 'application/json',
            'access-token': token,
            'Origin': 'https://campaign.diamante.io',
            'Referer': 'https://campaign.diamante.io/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
            'sec-ch-ua': '"Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-site',
            'Cookie': `access_token=${token}`,
        };

        log(`Initialized | User: ${this.userId?.slice(0, 8) || 'unknown'}...`);
    }

    async send(toAddress, amount, retryCount = 0) {
        const MAX_RETRIES = 3;
        const shortAddr = `${toAddress.slice(0, 10)}...${toAddress.slice(-4)}`;

        // Only count on first attempt
        if (retryCount === 0) {
            this.stats.total++;
            if (!this.stats.start) this.stats.start = Date.now();
        }

        try {
            const res = await fetch(API_URL, {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify({
                    toAddress,
                    amount: Number(amount),
                    userId: this.userId,
                }),
            });

            const responseText = await res.text();
            let data;
            try {
                data = JSON.parse(responseText);
            } catch {
                data = { raw: responseText };
            }

            // Debug: show full response
            console.log(`${C.gray}   API Response: ${JSON.stringify(data).slice(0, 120)}...${C.reset}`);

            // Handle rate limiting (429)
            if (data.status === 429 || res.status === 429) {
                if (retryCount < MAX_RETRIES) {
                    const waitTime = 5 + retryCount * 3;
                    log(`⏳ Rate limited. Waiting ${waitTime}s before retry ${retryCount + 1}/${MAX_RETRIES}...`, 'warn');
                    await sleep(waitTime * 1000);
                    return this.send(toAddress, amount, retryCount + 1);
                }
            }

            // Check for actual success
            const isSuccess = data.success === true;

            if (isSuccess) {
                this.stats.success++;
                this.stats.amount += Number(amount);

                // Extract hash from nested response
                const transferData = data.data?.transferData || {};
                const hash = transferData.hash || transferData.txHash || data.txHash || '✓';
                const shortHash = typeof hash === 'string' && hash.length > 16
                    ? `${hash.slice(0, 10)}...${hash.slice(-6)}`
                    : hash;
                log(`✅ Sent ${amount} DIAM → ${shortAddr} | ${shortHash}`, 'success');
                return { success: true, hash, toAddress, amount, data };
            } else {
                const errMsg = data.message || data.error || JSON.stringify(data).slice(0, 60);
                this.stats.failed++;
                log(`❌ Failed → ${shortAddr}: ${errMsg}`, 'error');
                return { success: false, error: errMsg, toAddress, amount };
            }
        } catch (e) {
            this.stats.failed++;
            log(`❌ Error → ${shortAddr}: ${e.message}`, 'error');
            return { success: false, error: e.message, toAddress, amount };
        }
    }

    async sendRound(wallets, amount, sendPerWallet = 2, continuous = false, maxIter = null) {
        const results = [];
        let iter = 0;

        const buildQueue = () => {
            const queue = [];
            for (const wallet of wallets) {
                for (let i = 0; i < sendPerWallet; i++) {
                    queue.push(wallet);
                }
            }
            return shuffle(queue);
        };

        const totalPerRound = wallets.length * sendPerWallet;
        this.printHeader(wallets, amount, sendPerWallet, continuous, maxIter);

        try {
            while (true) {
                iter++;
                const queue = buildQueue();

                console.log(`\n${C.magenta}${'─'.repeat(50)}`);
                console.log(`  ROUND ${iter} | ${totalPerRound} transactions`);
                console.log(`${'─'.repeat(50)}${C.reset}\n`);

                const sendCount = {};
                wallets.forEach(w => sendCount[w] = 0);

                for (let i = 0; i < queue.length; i++) {
                    if (i > 0 || iter > 1) await humanDelay();

                    const wallet = queue[i];
                    sendCount[wallet]++;

                    const sendNum = sendCount[wallet];
                    console.log(`${C.gray}   [${wallet.slice(0, 8)}...] Send ${sendNum}/${sendPerWallet}${C.reset}`);

                    const result = await this.send(wallet, amount);
                    results.push(result);

                    const pct = ((i + 1) / queue.length * 100).toFixed(0);
                    console.log(`   [${progressBar(i + 1, queue.length)}] ${pct}%\n`);
                }

                console.log(`${C.cyan}   Round ${iter} complete: ${this.stats.success}/${this.stats.total} successful${C.reset}\n`);

                if (!continuous) break;
                if (maxIter && iter >= maxIter) {
                    log(`Reached ${maxIter} rounds`, 'warn');
                    break;
                }

                log('🔄 Next round in 5s...', 'info');
                await sleep(5000);
            }
        } catch (e) {
            if (e.message !== 'interrupted') throw e;
        }

        this.printSummary(results, wallets.length, sendPerWallet);
        return results;
    }

    printHeader(wallets, amount, sendPerWallet, continuous, maxIter) {
        const total = wallets.length * sendPerWallet;

        console.log(`\n${C.cyan}${'═'.repeat(50)}`);
        console.log(`  🔷 DIAMANTE STRESS TEST`);
        console.log(`${'═'.repeat(50)}${C.reset}`);
        console.log(`  Wallets:        ${wallets.length}`);
        console.log(`  Sends/wallet:   ${sendPerWallet}`);
        console.log(`  Amount/send:    ${amount} DIAM`);
        console.log(`  Total/round:    ${total} transactions (${total * amount} DIAM)`);
        console.log(`  Mode:           ${continuous ? 'Continuous' : 'Single round'}${maxIter ? ` (max ${maxIter})` : ''}`);
        console.log(`  Delay:          ${MIN_DELAY}-${MAX_DELAY}s`);
        console.log(`${'═'.repeat(50)}${C.reset}`);
    }

    printSummary(results, walletCount, sendPerWallet) {
        const s = this.stats;
        const elapsed = s.start ? (Date.now() - s.start) / 1000 : 0;
        const tps = elapsed > 0 ? s.total / elapsed : 0;

        console.log(`\n${C.cyan}${'═'.repeat(50)}`);
        console.log(`  📊 FINAL SUMMARY`);
        console.log(`${'═'.repeat(50)}${C.reset}`);
        console.log(`  Total Txs:      ${s.total}`);
        console.log(`  ${C.green}Successful:${C.reset}     ${s.success} (${(s.success / s.total * 100 || 0).toFixed(1)}%)`);
        console.log(`  ${C.red}Failed:${C.reset}         ${s.failed}`);
        console.log(`  DIAM Sent:      ${s.amount.toFixed(2)}`);
        console.log(`  Duration:       ${elapsed.toFixed(1)}s`);
        console.log(`  Avg TPS:        ${tps.toFixed(2)}`);

        if (walletCount <= 10) {
            const walletStats = {};
            results.forEach(r => {
                if (!walletStats[r.toAddress]) walletStats[r.toAddress] = { success: 0, failed: 0 };
                if (r.success) walletStats[r.toAddress].success++;
                else walletStats[r.toAddress].failed++;
            });

            console.log(`\n  ${C.yellow}Per-Wallet:${C.reset}`);
            Object.entries(walletStats).forEach(([addr, stat]) => {
                const short = `${addr.slice(0, 10)}...${addr.slice(-4)}`;
                const status = stat.failed === 0 ? C.green + '✓' : C.red + '✗';
                console.log(`    ${short}: ${stat.success}/${stat.success + stat.failed} ${status}${C.reset}`);
            });
        }

        console.log(`${'═'.repeat(50)}\n`);
    }

    async getHistory(limit = 10) {
        const res = await fetch(HISTORY_URL, {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify({ userId: this.userId, limit, offset: 0 }),
        });
        return res.ok ? res.json() : null;
    }
}

// ============================================================================
// CLI
// ============================================================================
function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        token: null,
        to: null,
        amount: null,
        sendPerWallet: null,
        continuous: false,
        iterations: null,
        fast: false,
        history: false,
        config: false,
    };

    if (args.length === 0) {
        opts.config = true;
        return opts;
    }

    for (let i = 0; i < args.length; i++) {
        const [arg, next] = [args[i], args[i + 1]];
        switch (arg) {
            case '--token': case '-t': opts.token = next; i++; break;
            case '--to': opts.to = next; i++; break;
            case '--amount': opts.amount = next; i++; break;
            case '--sends': case '-s': opts.sendPerWallet = parseInt(next); i++; break;
            case '--continuous': case '-c': opts.continuous = true; break;
            case '--iterations': case '-i': opts.iterations = parseInt(next); i++; break;
            case '--fast': case '-f': opts.fast = true; break;
            case '--history': opts.history = true; break;
            case '--config': opts.config = true; break;
            case '--help': case '-h': printHelp(); process.exit(0);
        }
    }
    return opts;
}

function printHelp() {
    console.log(`
${C.cyan}🔷 Diamante Campaign CLI${C.reset}

Usage:
  node diamante.js                        # Use config.json
  node diamante.js --token TOKEN --to ADDR --amount 1

Options:
  --token, -t       Access token
  --to              Comma-separated wallet addresses
  --amount          Amount per send (default: 1)
  --sends, -s       Sends per wallet per round (default: 2)
  --continuous, -c  Run multiple rounds
  --iterations, -i  Max rounds
  --fast, -f        Fast mode (0.5-1s delays)
  --history         Show transaction history
  --config          Use config.json (default if no args)
  --help, -h        Show help

${C.yellow}Config File (config.json):${C.reset}
{
  "accessToken": "eyJ...",
  "sendPerWallet": 2,
  "amountPerSend": 1,
  "wallets": ["0x...", "0x..."],
  "delays": { "min": 1.5, "max": 4.0 },
  "continuous": false,
  "maxIterations": 1
}
`);
}

async function main() {
    const opts = parseArgs();

    let config = null;
    if (opts.config || !opts.token) {
        config = loadConfig();
        if (!config && !opts.token) {
            console.error(`${C.red}Error: No config.json found and no --token provided${C.reset}`);
            printHelp();
            process.exit(1);
        }
    }

    const token = opts.token || config?.accessToken;
    const wallets = opts.to
        ? opts.to.split(',').map(a => a.trim()).filter(Boolean)
        : config?.wallets || [];
    const amount = opts.amount || config?.amountPerSend || '1';
    const sendPerWallet = opts.sendPerWallet || config?.sendPerWallet || 2;
    const continuous = opts.continuous || config?.continuous || false;
    const maxIter = opts.iterations || config?.maxIterations || null;

    // Apply delays from config first
    if (config?.delays) {
        MIN_DELAY = config.delays.min;
        MAX_DELAY = config.delays.max;
    }
    if (opts.fast) {
        MIN_DELAY = 0.5;
        MAX_DELAY = 1.0;
    }

    if (!token) {
        console.error(`${C.red}Error: --token is required${C.reset}`);
        process.exit(1);
    }

    if (wallets.length === 0) {
        console.error(`${C.red}Error: No wallets provided${C.reset}`);
        process.exit(1);
    }

    const sender = new DiamanteSender(token);

    if (opts.history) {
        const h = await sender.getHistory();
        console.log(JSON.stringify(h, null, 2));
        return;
    }

    process.on('SIGINT', () => {
        console.log(`\n${C.yellow}⚠️ Interrupted${C.reset}`);
        process.exit(130);
    });

    const results = await sender.sendRound(wallets, amount, sendPerWallet, continuous, maxIter);
    process.exit(results.some(r => !r.success) ? 1 : 0);
}

main().catch(e => {
    console.error(`${C.red}Error: ${e.message}${C.reset}`);
    process.exit(1);
});
