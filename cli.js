#!/usr/bin/env node
/**
 * 🔷 Diamante Campaign CLI
 * Uses browser automation with REAL wallet signing via private key
 * No manual login needed!
 */

import { select, input, confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import gradient from 'gradient-string';
import ora from 'ora';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';
import { Wallet } from 'ethers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(__dirname, 'config.json');
const CAMPAIGN_URL = 'https://campaign.diamante.io/transactions';

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

const isValidPrivateKey = (key) => {
    try {
        new Wallet(key);
        return true;
    } catch {
        return false;
    }
};

const getWallet = (privateKey) => {
    try {
        return new Wallet(privateKey);
    } catch {
        return null;
    }
};

// ============================================================================
// UI Helpers
// ============================================================================
const title = () => console.log('\n  ' + gradient.pastel(' diamante') + '\n');

const showAccount = (address) => {
    if (address) {
        const shortAddr = `${address.slice(0, 10)}...${address.slice(-6)}`;
        console.log(chalk.gray(`     ${shortAddr}`));
    }
    console.log(chalk.gray('\n  ' + '─'.repeat(46) + '\n'));
};

// ============================================================================
// Browser Automation with Real Signing
// ============================================================================
let browser = null;
let page = null;
let walletInstance = null;

const initBrowser = async (privateKey, headless = true) => {
    if (browser) {
        try { await browser.close(); } catch { }
    }

    walletInstance = getWallet(privateKey);
    if (!walletInstance) throw new Error('Invalid private key');

    browser = await puppeteer.launch({
        headless: headless ? 'new' : false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
        ],
        defaultViewport: { width: 1400, height: 900 },
    });

    page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36');

    // Expose signing function to browser - this is the KEY!
    // The browser can call this to get real signatures
    await page.exposeFunction('__signMessage', async (message) => {
        try {
            const signature = await walletInstance.signMessage(message);
            return signature;
        } catch (e) {
            console.error('Signing error:', e);
            return null;
        }
    });

    await page.exposeFunction('__signTypedData', async (domain, types, value) => {
        try {
            const signature = await walletInstance.signTypedData(domain, types, value);
            return signature;
        } catch (e) {
            console.error('Typed data signing error:', e);
            return null;
        }
    });

    // Inject wallet BEFORE any page loads
    await page.evaluateOnNewDocument((walletAddress) => {
        // Create ethereum provider that uses our exposed signing functions
        window.ethereum = {
            isMetaMask: true,
            isConnected: () => true,
            selectedAddress: walletAddress,
            chainId: '0x1',
            networkVersion: '1',
            _events: {},
            _address: walletAddress,

            request: async function ({ method, params }) {
                console.log('[Wallet] Request:', method, params);

                switch (method) {
                    case 'eth_requestAccounts':
                    case 'eth_accounts':
                        return [this._address];

                    case 'eth_chainId':
                        return '0x1';

                    case 'net_version':
                        return '1';

                    case 'personal_sign': {
                        // params[0] is the message (hex), params[1] is the address
                        const hexMessage = params[0];
                        // Convert hex to string
                        let message;
                        if (hexMessage.startsWith('0x')) {
                            // Decode hex to string
                            const hex = hexMessage.slice(2);
                            message = '';
                            for (let i = 0; i < hex.length; i += 2) {
                                message += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
                            }
                        } else {
                            message = hexMessage;
                        }
                        console.log('[Wallet] Signing message:', message);
                        // Call our exposed function
                        const signature = await window.__signMessage(message);
                        console.log('[Wallet] Signature:', signature);
                        return signature;
                    }

                    case 'eth_sign': {
                        const message = params[1];
                        const signature = await window.__signMessage(message);
                        return signature;
                    }

                    case 'eth_signTypedData':
                    case 'eth_signTypedData_v3':
                    case 'eth_signTypedData_v4': {
                        const typedData = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1];
                        console.log('[Wallet] Signing typed data:', typedData);
                        const signature = await window.__signTypedData(
                            typedData.domain,
                            typedData.types,
                            typedData.message
                        );
                        return signature;
                    }

                    case 'wallet_switchEthereumChain':
                    case 'wallet_addEthereumChain':
                        return null;

                    case 'eth_getBalance':
                        return '0x0';

                    case 'eth_estimateGas':
                        return '0x5208';

                    case 'eth_sendTransaction':
                        console.log('[Wallet] Send transaction:', params);
                        return '0x' + Math.random().toString(16).substring(2, 66);

                    default:
                        console.log('[Wallet] Unhandled method:', method);
                        return null;
                }
            },

            send: function (method, params) {
                if (typeof method === 'object') {
                    return this.request(method);
                }
                return this.request({ method, params });
            },

            sendAsync: function (payload, callback) {
                this.request(payload)
                    .then(result => callback(null, { result }))
                    .catch(error => callback(error));
            },

            on: function (event, callback) {
                this._events[event] = callback;
                if (event === 'connect') {
                    setTimeout(() => callback({ chainId: '0x1' }), 100);
                }
                if (event === 'accountsChanged') {
                    setTimeout(() => callback([this._address]), 100);
                }
            },

            removeListener: function () { },
            removeAllListeners: function () { },

            enable: async function () {
                return [this._address];
            },
        };

        // Also expose for libraries that check window.web3
        window.web3 = { currentProvider: window.ethereum };

        console.log('[Wallet] Injected for address:', walletAddress);

    }, walletInstance.address);

    // Navigate to campaign
    await page.goto(CAMPAIGN_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(2000);

    // Try to connect wallet if there's a connect button
    await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const connectBtn = buttons.find(btn => {
            const text = btn.textContent.toLowerCase();
            return text.includes('connect') || text.includes('login');
        });
        if (connectBtn) {
            console.log('[Auto] Clicking connect button');
            connectBtn.click();
        }
    });

    await sleep(2000);

    // Look for wallet option (MetaMask, etc.)
    await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('button, div[role="button"], [class*="wallet"], [class*="option"]'));
        const walletBtn = items.find(item => {
            const text = item.textContent.toLowerCase();
            return text.includes('metamask') || text.includes('injected') || text.includes('browser');
        });
        if (walletBtn) {
            console.log('[Auto] Clicking wallet option');
            walletBtn.click();
        }
    });

    await sleep(3000);

    return { browser, page };
};

const closeBrowser = async () => {
    if (browser) {
        try { await browser.close(); } catch { }
        browser = null;
        page = null;
    }
};

// Send via browser UI
const sendViaBrowser = async (toAddress, amount) => {
    try {
        if (!page) {
            return { success: false, error: 'Browser not initialized' };
        }

        // Make sure we're on transactions page
        if (!page.url().includes('/transactions')) {
            await page.goto(CAMPAIGN_URL, { waitUntil: 'networkidle2', timeout: 30000 });
            await sleep(2000);
        }

        // Click Send button
        const hasSendBtn = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const sendBtn = buttons.find(btn => btn.textContent.trim().toLowerCase() === 'send');
            if (sendBtn) {
                sendBtn.click();
                return true;
            }
            return false;
        });

        if (!hasSendBtn) {
            return { success: false, error: 'Send button not found - wallet may not be connected' };
        }

        await sleep(1500);

        // Fill To Address - use keyboard typing for reliability
        await page.evaluate(() => {
            const inputs = Array.from(document.querySelectorAll('input'));
            const toInput = inputs.find(inp => {
                const ph = (inp.placeholder || '').toLowerCase();
                return ph.includes('address') || ph.includes('to');
            });
            if (toInput) toInput.focus();
        });
        await page.keyboard.type(toAddress, { delay: 30 });

        await sleep(500);

        // Fill Amount - tab to next field and type
        await page.keyboard.press('Tab');
        await sleep(200);
        await page.keyboard.type(amount.toString(), { delay: 30 });

        await sleep(1000);

        // Set up response listener BEFORE clicking submit
        let apiResponse = null;
        const responsePromise = new Promise((resolve) => {
            const handler = async (response) => {
                const url = response.url();
                if (url.includes('/transaction/transfer') || url.includes('/transfer')) {
                    try {
                        const text = await response.text();
                        apiResponse = { status: response.status(), body: text };
                        resolve(apiResponse);
                    } catch {
                        resolve(null);
                    }
                    page.off('response', handler);
                }
            };
            page.on('response', handler);
            // Timeout after 15 seconds
            setTimeout(() => resolve(null), 15000);
        });

        // Click Send Transaction button
        const submitted = await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const submitBtn = buttons.find(btn => {
                const text = btn.textContent.toLowerCase();
                return text.includes('send transaction') || text.includes('confirm');
            });
            if (submitBtn && !submitBtn.disabled) {
                submitBtn.click();
                return true;
            }
            return false;
        });

        if (!submitted) {
            // Try pressing Enter instead
            await page.keyboard.press('Enter');
        }

        // Wait for API response
        await responsePromise;
        await sleep(2000);

        // Check API response first (most reliable)
        if (apiResponse) {
            try {
                const data = JSON.parse(apiResponse.body);
                if (data.success === true) {
                    const hash = data.data?.transferData?.hash || data.txHash || '✓';
                    await page.keyboard.press('Escape');
                    await sleep(500);
                    return { success: true, hash };
                } else {
                    const error = data.message || data.error || 'Transaction rejected';
                    await page.keyboard.press('Escape');
                    await sleep(500);
                    return { success: false, error };
                }
            } catch {
                // If response is HTML, check status
                if (apiResponse.status >= 400) {
                    await page.keyboard.press('Escape');
                    await sleep(500);
                    return { success: false, error: `API error (${apiResponse.status})` };
                }
            }
        }

        // Fallback: Check page for success/error messages
        const result = await page.evaluate(() => {
            const body = document.body.innerText.toLowerCase();

            // Look for clear success indicators
            if (body.includes('transaction sent') || body.includes('successfully')) {
                const hashMatch = document.body.innerText.match(/0x[a-fA-F0-9]{64}/);
                return { success: true, hash: hashMatch ? hashMatch[0] : '✓' };
            }

            // Look for clear error indicators
            if (body.includes('error') || body.includes('failed') || body.includes('insufficient') || body.includes('rejected')) {
                return { success: false, error: 'Transaction failed' };
            }

            // Check if modal is still open with form (means not submitted)
            const hasForm = document.querySelector('input[placeholder*="ddress"], input[placeholder*="mount"]');
            if (hasForm) {
                return { success: false, error: 'Form not submitted' };
            }

            // Uncertain - mark as unknown
            return { success: false, error: 'Could not verify result' };
        });

        // Close modal
        await page.keyboard.press('Escape');
        await sleep(500);

        return result;
    } catch (e) {
        return { success: false, error: e.message };
    }
};

// ============================================================================
// Menus
// ============================================================================
const promptPrivateKey = async () => {
    clear();
    title();
    console.log(chalk.yellow('  ⚠ private key not found\n'));
    console.log(chalk.gray('  your EVM wallet private key (from MetaMask/OKX)\n'));

    const key = await input({
        message: 'paste here',
        theme: { prefix: '  ' },
    });

    return key.trim();
};

const mainMenu = async (config, address) => {
    clear();
    title();
    showAccount(address);

    const choice = await select({
        message: '',
        choices: [
            { name: 'send tokens', value: 'send' },
            { name: `wallets                          ${chalk.gray((config.wallets?.length || 0) + ' loaded')}`, value: 'wallets' },
            { name: 'settings', value: 'settings' },
            { name: 'exit', value: 'exit' },
        ],
        theme: {
            prefix: '  ',
            style: { highlight: (text) => chalk.cyan('› ') + chalk.white(text) },
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
            { name: `private key     ${config.privateKey ? chalk.green('●●●' + config.privateKey.slice(-4)) : chalk.red('not set')}`, value: 'privateKey' },
            { name: `delay           ${chalk.cyan((config.delays?.min || 90) + ' - ' + (config.delays?.max || 150) + 's')}`, value: 'delay' },
            { name: `sends/wallet    ${chalk.cyan(config.sendPerWallet || 2)}`, value: 'sends' },
            { name: `amount          ${chalk.cyan((config.amount?.min || 1) + ' - ' + (config.amount?.max || 2) + ' DIAM')}`, value: 'amount' },
            { name: `visible browser ${config.headless === false ? chalk.green('ON') : chalk.gray('OFF')}`, value: 'headless' },
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
    console.log(chalk.gray('  📋 recipient wallets\n'));

    const wallets = config.wallets || [];
    const choices = [
        ...wallets.map((w, i) => ({
            name: `${w.slice(0, 14)}...${w.slice(-6)}`,
            value: `remove_${i}`,
        })),
        { name: chalk.green('+ add wallet'), value: 'add' },
        { name: chalk.gray('← back'), value: 'back' },
    ];

    return await select({
        message: '',
        choices,
        theme: {
            prefix: '  ',
            style: { highlight: (text) => chalk.cyan('› ') + text },
        },
    });
};

// ============================================================================
// Send Tokens
// ============================================================================
const runSending = async (config) => {
    clear();
    title();

    const wallet = getWallet(config.privateKey);
    if (!wallet) {
        console.log(chalk.red('  ✗ invalid private key\n'));
        await sleep(2000);
        return;
    }

    const wallets = config.wallets || [];
    const sendsPerWallet = config.sendPerWallet || 2;
    const minAmount = config.amount?.min || 1;
    const maxAmount = config.amount?.max || 2;
    const minDelay = config.delays?.min || 90;
    const maxDelay = config.delays?.max || 150;

    if (wallets.length === 0) {
        console.log(chalk.red('  ✗ no recipient wallets\n'));
        await sleep(2000);
        return;
    }

    // Build queue
    const queue = [];
    for (const w of wallets) {
        for (let i = 0; i < sendsPerWallet; i++) {
            queue.push(w);
        }
    }
    // Shuffle
    for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
    }

    console.log(chalk.gray(`  sending ${queue.length} transactions (${minAmount}-${maxAmount} DIAM each)...\n`));

    // Initialize browser
    const spinner = ora({ text: 'initializing browser...', prefixText: '  ' }).start();
    try {
        await initBrowser(config.privateKey, config.headless !== false);
        spinner.succeed('browser ready');
    } catch (e) {
        spinner.fail(`browser error: ${e.message}`);
        await sleep(3000);
        return;
    }

    // Check if wallet connected
    await sleep(2000);
    const isConnected = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.some(btn => btn.textContent.trim().toLowerCase() === 'send');
    });

    if (!isConnected) {
        console.log(chalk.yellow('\n  ⚠ Wallet may not be connected. Trying to connect...\n'));
        // The wallet should auto-connect, but give it more time
        await sleep(5000);
    }

    let success = 0;
    let failed = 0;
    let totalAmount = 0;

    for (let i = 0; i < queue.length; i++) {
        const toWallet = queue[i];
        const shortAddr = `${toWallet.slice(0, 12)}...${toWallet.slice(-4)}`;

        if (i > 0) {
            const delay = Math.floor(minDelay + Math.random() * (maxDelay - minDelay));
            const waitSpinner = ora({ text: chalk.gray(`waiting ${delay}s...`), prefixText: '  ' }).start();
            for (let sec = delay; sec > 0; sec--) {
                waitSpinner.text = chalk.gray(`waiting ${sec}s...`);
                await sleep(1000);
            }
            waitSpinner.stop();
        }

        const txSpinner = ora({ text: `${shortAddr}`, prefixText: '  ' }).start();

        const amount = (minAmount + Math.random() * (maxAmount - minAmount)).toFixed(4);
        const result = await sendViaBrowser(toWallet, amount);

        if (result.success) {
            success++;
            totalAmount += parseFloat(amount);
            const shortHash = result.hash?.length > 16 ? `${result.hash.slice(0, 10)}...` : (result.hash || '✓');
            txSpinner.succeed(chalk.green(`${shortAddr}  ${amount} DIAM  ✓ ${shortHash}`));
        } else {
            failed++;
            txSpinner.fail(chalk.red(`${shortAddr}  ✗ ${result.error?.slice(0, 40) || 'Error'}`));
        }

        // Progress
        const pct = Math.floor(((i + 1) / queue.length) * 100);
        const bar = chalk.cyan('▓'.repeat(Math.floor(pct / 2.5))) + chalk.gray('░'.repeat(40 - Math.floor(pct / 2.5)));
        process.stdout.write(`\r  ${bar}  ${pct}%  ${success}✓ ${failed}✗`);
    }

    console.log('\n\n' + chalk.green(`  done! ${success}/${queue.length} successful | ${totalAmount.toFixed(4)} DIAM sent\n`));
    await closeBrowser();
    await sleep(3000);
};

// ============================================================================
// Main
// ============================================================================
const main = async () => {
    let config = loadConfig();

    if (!config.privateKey || !isValidPrivateKey(config.privateKey)) {
        const key = await promptPrivateKey();
        if (!key || !isValidPrivateKey(key)) {
            console.log(chalk.red('  ✗ invalid private key'));
            process.exit(1);
        }
        config.privateKey = key;
        saveConfig(config);
    }

    const address = getWallet(config.privateKey).address;

    while (true) {
        const choice = await mainMenu(config, address);

        switch (choice) {
            case 'send':
                await runSending(config);
                break;

            case 'wallets':
                while (true) {
                    const wChoice = await walletsMenu(config);
                    if (wChoice === 'back') break;
                    if (wChoice === 'add') {
                        const addr = await input({ message: 'wallet address (0x...)', theme: { prefix: '  ' } });
                        if (addr.trim()?.startsWith('0x')) {
                            config.wallets = [...(config.wallets || []), addr.trim()];
                            saveConfig(config);
                        }
                    } else if (wChoice.startsWith('remove_')) {
                        const idx = parseInt(wChoice.split('_')[1]);
                        if (await confirm({ message: 'remove?', theme: { prefix: '  ' } })) {
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

                    if (sChoice === 'privateKey') {
                        const k = await input({ message: 'private key', theme: { prefix: '  ' } });
                        if (k.trim() && isValidPrivateKey(k.trim())) {
                            config.privateKey = k.trim();
                            saveConfig(config);
                        }
                    } else if (sChoice === 'headless') {
                        config.headless = config.headless === false ? true : false;
                        saveConfig(config);
                    } else if (sChoice === 'sends') {
                        const v = await input({ message: 'sends per wallet', theme: { prefix: '  ' } });
                        if (v) { config.sendPerWallet = parseInt(v) || 2; saveConfig(config); }
                    } else if (sChoice === 'amount') {
                        const min = await input({ message: 'min amount', theme: { prefix: '  ' } });
                        const max = await input({ message: 'max amount', theme: { prefix: '  ' } });
                        config.amount = config.amount || {};
                        if (min) config.amount.min = parseFloat(min);
                        if (max) config.amount.max = parseFloat(max);
                        saveConfig(config);
                    } else if (sChoice === 'delay') {
                        const min = await input({ message: 'min delay (s)', theme: { prefix: '  ' } });
                        const max = await input({ message: 'max delay (s)', theme: { prefix: '  ' } });
                        config.delays = config.delays || {};
                        if (min) config.delays.min = parseFloat(min);
                        if (max) config.delays.max = parseFloat(max);
                        saveConfig(config);
                    }
                }
                break;

            case 'exit':
                await closeBrowser();
                console.log(chalk.gray('\n  bye! 👋\n'));
                process.exit(0);
        }
    }
};

process.on('SIGINT', async () => {
    await closeBrowser();
    process.exit(0);
});

main().catch(async e => {
    await closeBrowser();
    console.error(chalk.red(`\n  error: ${e.message}\n`));
    process.exit(1);
});
