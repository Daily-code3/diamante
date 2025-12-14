#!/usr/bin/env node
/**
 * 🔷 Diamante Campaign Interactive CLI
 * Modern minimalist design with arrow-key navigation
 */

import { select, input, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import gradient from 'gradient-string';
import ora from 'ora';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(__dirname, 'config.json');
const API_URL = 'https://campapi.diamante.io/api/v1/transaction/transfer';

// ============================================================================
// Utilities
// ============================================================================
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const clear = () => console.clear();

const loadConfig = () => {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        }
    } catch { }
    return {};
};

const saveConfig = (config) => {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 4));
};

const extractUserId = (token) => {
    try {
        const payload = Buffer.from(token.split('.')[1], 'base64').toString();
        return JSON.parse(payload).userId;
    } catch {
        return null;
    }
};

const getHeaders = (token) => ({
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Content-Type': 'application/json',
    'access-token': token,
    'Origin': 'https://campaign.diamante.io',
    'Referer': 'https://campaign.diamante.io/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'sec-ch-ua': '"Google Chrome";v="143"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'Cookie': `access_token=${token}`,
});

// ============================================================================
// UI Helpers
// ============================================================================
const title = () => console.log('\n  ' + gradient.pastel(' diamante') + '\n');

const showAccount = (address, balance) => {
    if (address) {
        console.log(chalk.gray(`     ${address}`));
        if (balance !== null) console.log(chalk.green(`     ${balance} DIAM`));
    }
    console.log(chalk.gray('\n  ' + '─'.repeat(46) + '\n'));
};

// ============================================================================
// API Functions
// ============================================================================
const fetchAccountInfo = async (token, userId) => {
    try {
        const res = await fetch('https://campapi.diamante.io/api/v1/transaction/history', {
            method: 'POST',
            headers: getHeaders(token),
            body: JSON.stringify({ userId, limit: 1, offset: 0 }),
        });
        if (res.ok) {
            const data = await res.json();
            // API returns: { data: { transactions: [{ from: "0x...", to: "0x..." }] } }
            const transactions = data.data?.transactions || [];
            const address = transactions[0]?.from || null;
            // Balance not returned by history API
            return { balance: null, address };
        }
    } catch { }
    return { balance: null, address: null };
};

const sendTransaction = async (token, userId, toAddress, amount, retryCount = 0) => {
    const MAX_RETRIES = 3;
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: getHeaders(token),
            body: JSON.stringify({ toAddress, amount: Number(amount), userId }),
        });
        const data = await res.json();

        // Handle rate limiting with retry (API needs longer cooldown)
        if (data.status === 429 || res.status === 429 || (data.message && data.message.includes('guardian'))) {
            if (retryCount < MAX_RETRIES) {
                const waitTime = 15 + retryCount * 10;  // 15s, 25s, 35s
                return { retry: true, waitTime, retryCount: retryCount + 1 };
            }
        }

        if (data.success) {
            const hash = data.data?.transferData?.hash || '✓';
            return { success: true, hash };
        }
        return { success: false, error: data.message || 'Failed' };
    } catch (e) {
        return { success: false, error: e.message };
    }
};

// ============================================================================
// Menus
// ============================================================================
const promptToken = async () => {
    clear();
    title();
    console.log(chalk.yellow('  ⚠ token not found\n'));
    console.log(chalk.gray('  get yours → campaign.diamante.io → F12 → Cookies\n'));

    const token = await input({
        message: 'paste here',
        theme: { prefix: '  ' },
    });

    return token.trim();
};

const mainMenu = async (config, balance, address) => {
    clear();
    title();
    showAccount(address || config.walletAddress, balance);

    const choice = await select({
        message: '',
        choices: [
            { name: 'send tokens', value: 'send' },
            { name: `wallets                          ${chalk.gray((config.wallets?.length || 0) + ' loaded')}`, value: 'wallets' },
            { name: 'settings', value: 'settings' },
            { name: 'history', value: 'history' },
            { name: 'exit', value: 'exit' },
        ],
        theme: {
            prefix: '  ',
            style: {
                highlight: (text) => chalk.cyan('› ') + chalk.white(text),
            },
        },
    });

    return choice;
};

const settingsMenu = async (config) => {
    clear();
    title();
    console.log(chalk.gray('  ⚙ settings\n'));

    const choice = await select({
        message: '',
        choices: [
            { name: `delay           ${chalk.cyan((config.delays?.min || 1.5) + ' - ' + (config.delays?.max || 4) + 's')}`, value: 'delay' },
            { name: `sends/wallet    ${chalk.cyan(config.sendPerWallet || 2)}`, value: 'sends' },
            { name: `amount          ${chalk.cyan((config.amountPerSend || 1) + ' DIAM')}`, value: 'amount' },
            { name: `continuous      ${config.continuous ? chalk.green('ON') : chalk.gray('OFF')}`, value: 'continuous' },
            { name: `max rounds      ${chalk.cyan(config.maxIterations || 1)}`, value: 'maxIterations' },
            { name: chalk.gray('← back'), value: 'back' },
        ],
        theme: {
            prefix: '  ',
            style: { highlight: (text) => chalk.cyan('› ') + text },
        },
    });

    return choice;
};

const walletsMenu = async (config) => {
    clear();
    title();
    console.log(chalk.gray('  📋 wallets\n'));

    const wallets = config.wallets || [];
    const choices = [
        ...wallets.map((w, i) => ({
            name: `${w.slice(0, 14)}...${w.slice(-6)}`,
            value: `remove_${i}`,
        })),
        { name: chalk.green('+ add wallet'), value: 'add' },
        { name: chalk.gray('← back'), value: 'back' },
    ];

    const choice = await select({
        message: '',
        choices,
        theme: {
            prefix: '  ',
            style: { highlight: (text) => chalk.cyan('› ') + text },
        },
    });

    return choice;
};

const runSending = async (config) => {
    clear();
    title();

    const token = config.accessToken;
    const userId = extractUserId(token);
    const wallets = config.wallets || [];
    const sendsPerWallet = config.sendPerWallet || 2;
    const amount = config.amountPerSend || 1;
    const minDelay = config.delays?.min || 92.4;
    const maxDelay = config.delays?.max || 143.7;

    if (wallets.length === 0) {
        console.log(chalk.red('  ✗ no wallets configured\n'));
        await sleep(2000);
        return;
    }

    // Build queue
    const queue = [];
    for (const wallet of wallets) {
        for (let i = 0; i < sendsPerWallet; i++) {
            queue.push(wallet);
        }
    }
    // Shuffle
    for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
    }

    console.log(chalk.gray(`  sending ${queue.length} transactions...\n`));

    let success = 0;
    let failed = 0;

    for (let i = 0; i < queue.length; i++) {
        const wallet = queue[i];
        const shortAddr = `${wallet.slice(0, 12)}...${wallet.slice(-4)}`;

        if (i > 0) {
            const delay = Math.floor(minDelay + Math.random() * (maxDelay - minDelay));
            const spinner = ora({ text: chalk.gray(`waiting ${delay}s...`), prefixText: '  ' }).start();
            // Countdown timer
            for (let sec = delay; sec > 0; sec--) {
                spinner.text = chalk.gray(`waiting ${sec}s...`);
                await sleep(1000);
            }
            spinner.stop();
        }

        const spinner = ora({ text: `${shortAddr}`, prefixText: '  ' }).start();
        let result = await sendTransaction(token, userId, wallet, amount);

        // Handle rate limit retries with countdown
        while (result.retry) {
            // Countdown timer
            let remaining = result.waitTime;
            while (remaining > 0) {
                spinner.text = chalk.yellow(`rate limited, waiting ${remaining}s...`);
                await sleep(1000);
                remaining--;
            }
            spinner.text = `${shortAddr} (retry ${result.retryCount})`;
            result = await sendTransaction(token, userId, wallet, amount, result.retryCount);
        }

        if (result.success) {
            success++;
            const shortHash = result.hash.length > 16 ? `${result.hash.slice(0, 10)}...` : result.hash;
            spinner.succeed(chalk.green(`${shortAddr}  ✓ ${shortHash}`));
        } else {
            failed++;
            spinner.fail(chalk.red(`${shortAddr}  ✗ ${result.error?.slice(0, 30) || 'Error'}`));
        }

        // Progress bar
        const pct = Math.floor(((i + 1) / queue.length) * 100);
        const barWidth = 40;
        const filled = Math.floor((pct / 100) * barWidth);
        const bar = chalk.cyan('▓'.repeat(filled)) + chalk.gray('░'.repeat(barWidth - filled));
        process.stdout.write(`\r  ${bar}  ${pct}%  ${success}✓ ${failed}✗`);
    }

    console.log('\n\n' + chalk.green(`  done! ${success}/${queue.length} successful\n`));
    await sleep(3000);
};

// ============================================================================
// Main Loop
// ============================================================================
const main = async () => {
    let config = loadConfig();
    let balance = null;
    let address = null;

    // Token check
    if (!config.accessToken) {
        const token = await promptToken();
        if (!token) {
            console.log(chalk.red('  ✗ no token provided'));
            process.exit(1);
        }
        config.accessToken = token;
        saveConfig(config);
    }

    // Fetch account info
    const userId = extractUserId(config.accessToken);
    const spinner = ora({ text: 'connecting...', prefixText: '  ' }).start();
    const accountInfo = await fetchAccountInfo(config.accessToken, userId);
    balance = accountInfo.balance;
    address = accountInfo.address || config.walletAddress;
    spinner.stop();

    // Main loop
    while (true) {
        const choice = await mainMenu(config, balance, address);

        switch (choice) {
            case 'send':
                await runSending(config);
                break;

            case 'wallets':
                while (true) {
                    const wChoice = await walletsMenu(config);
                    if (wChoice === 'back') break;
                    if (wChoice === 'add') {
                        const addr = await input({ message: 'wallet address', theme: { prefix: '  ' } });
                        if (addr.trim()) {
                            config.wallets = [...(config.wallets || []), addr.trim()];
                            saveConfig(config);
                        }
                    } else if (wChoice.startsWith('remove_')) {
                        const idx = parseInt(wChoice.split('_')[1]);
                        const doRemove = await confirm({ message: 'remove this wallet?', theme: { prefix: '  ' } });
                        if (doRemove) {
                            config.wallets.splice(idx, 1);
                            saveConfig(config);
                        }
                    }
                }
                break;

            case 'settings':
                while (true) {
                    const sChoice = await settingsMenu(config);
                    if (sChoice === 'back') break;

                    if (sChoice === 'continuous') {
                        config.continuous = !config.continuous;
                        saveConfig(config);
                    } else if (sChoice === 'sends') {
                        const val = await input({ message: 'sends per wallet', theme: { prefix: '  ' } });
                        if (val) { config.sendPerWallet = parseInt(val) || 2; saveConfig(config); }
                    } else if (sChoice === 'amount') {
                        const val = await input({ message: 'amount per send', theme: { prefix: '  ' } });
                        if (val) { config.amountPerSend = parseFloat(val) || 1; saveConfig(config); }
                    } else if (sChoice === 'maxIterations') {
                        const val = await input({ message: 'max rounds', theme: { prefix: '  ' } });
                        if (val) { config.maxIterations = parseInt(val) || 1; saveConfig(config); }
                    } else if (sChoice === 'delay') {
                        const minVal = await input({ message: 'min delay (s)', theme: { prefix: '  ' } });
                        const maxVal = await input({ message: 'max delay (s)', theme: { prefix: '  ' } });
                        if (minVal || maxVal) {
                            config.delays = config.delays || {};
                            if (minVal) config.delays.min = parseFloat(minVal);
                            if (maxVal) config.delays.max = parseFloat(maxVal);
                            saveConfig(config);
                        }
                    }
                }
                break;

            case 'history':
                console.log(chalk.gray('\n  history coming soon...\n'));
                await sleep(1500);
                break;

            case 'exit':
                clear();
                console.log(chalk.gray('\n  bye! 👋\n'));
                process.exit(0);
        }
    }
};

main().catch(e => {
    console.error(chalk.red(`\n  error: ${e.message}\n`));
    process.exit(1);
});
