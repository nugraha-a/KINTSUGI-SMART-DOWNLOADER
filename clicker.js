/**
 * YouTube Playlist Clicker — Playwright Multi-Tab Edition
 * Adds videos from missing_online.txt to a YouTube playlist using parallel tabs.
 *
 * YouTube 2025+ DOM:
 *   Dialog:  tp-yt-iron-dropdown > yt-sheet-view-model
 *   Rows:    yt-list-item-view-model[role="listitem"][aria-label*="PLAYLIST_NAME"]
 *   Toggle:  aria-pressed="true" / "false"
 *   State:   aria-label="..., Not selected" vs "..., Selected"
 */

const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ─── Configuration ───────────────────────────────────────────────
const ARCHIVE_FILE = String.raw`c:\Users\it\Music\Playlists\Kintsugi\data\missing_online.txt`;
const CHROME_PATH = String.raw`C:\Program Files\Google\Chrome Dev\Application\chrome.exe`;
const PLAYLIST_NAME = 'New Playlist';  // Must match the playlist name in YouTube
const AUTOMATION_PROFILE = path.join(__dirname, '.chrome-automation-profile');

const CONCURRENT_TABS = 5;
const PAGE_LOAD_DELAY = 2500;
const DIALOG_WAIT = 2000;
const AFTER_SAVE_DELAY = 1000;
// ─────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

function askUser(q) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(r => { rl.question(q, () => { rl.close(); r(); }); });
}

let success = 0, alreadyAdded = 0, fail = 0;
const failedUrls = [];
let processed = 0;
let totalUrls = 0;

async function processVideo(page, url, workerId) {
    const videoId = (() => { try { return new URL(url).searchParams.get('v') || '?'; } catch { return '?'; } })();
    processed++;
    const tag = `[${processed}/${totalUrls}][T${workerId}]`;

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

        // Wait for action buttons to load
        try {
            await page.waitForSelector('#top-level-buttons-computed, ytd-menu-renderer', { timeout: 10000 });
        } catch (e) { /* proceed */ }
        await sleep(PAGE_LOAD_DELAY);

        // === Step 1: Click Save button ===
        let saveClicked = false;

        // Primary: aria-label "Save to playlist"
        try {
            const saveBtn = await page.waitForSelector(
                'button[aria-label*="Save" i]',
                { timeout: 6000, state: 'visible' }
            );
            if (saveBtn) { await saveBtn.click(); saveClicked = true; }
        } catch (e) { }

        // Fallback: three-dot menu → Save
        if (!saveClicked) {
            try {
                const dots = await page.$$('ytd-menu-renderer yt-icon-button button, button[aria-label="More actions"]');
                for (const dot of dots) {
                    if (await dot.isVisible()) {
                        await dot.click();
                        await sleep(800);
                        const items = await page.$$('ytd-menu-service-item-renderer');
                        for (const item of items) {
                            const text = await item.textContent();
                            if (text.toLowerCase().includes('save')) {
                                await item.click(); saveClicked = true; break;
                            }
                        }
                        if (saveClicked) break;
                        await page.keyboard.press('Escape');
                        await sleep(200);
                    }
                }
            } catch (e) { }
        }

        if (!saveClicked) throw new Error('Save btn not found');

        // === Step 2: Wait for the Save-to dialog ===
        await sleep(DIALOG_WAIT);

        // New YouTube uses tp-yt-iron-dropdown with yt-sheet-view-model inside
        let dialogFound = false;
        for (const sel of [
            'yt-sheet-view-model',                     // New YouTube dialog container
            'tp-yt-iron-dropdown:not([aria-hidden])',   // The dropdown wrapper
            'yt-list-view-model[role="list"]',          // The playlist list
            'ytd-add-to-playlist-renderer',             // Legacy fallback
        ]) {
            try {
                await page.waitForSelector(sel, { timeout: 3000, state: 'visible' });
                dialogFound = true;
                break;
            } catch (e) { }
        }
        if (!dialogFound) throw new Error('Dialog not found');
        await sleep(800);

        // === Step 3: Find and click the target playlist ===
        let found = false, wasAlready = false;

        // New YouTube: yt-list-item-view-model with aria-label containing playlist name
        try {
            const rows = await page.$$('yt-list-item-view-model[role="listitem"]');
            for (const row of rows) {
                const ariaLabel = await row.getAttribute('aria-label');
                if (ariaLabel && ariaLabel.includes(PLAYLIST_NAME)) {
                    // Check if already selected via aria-label or aria-pressed
                    const isSelected = ariaLabel.toLowerCase().includes('selected') && !ariaLabel.toLowerCase().includes('not selected');
                    const isPressed = (await row.getAttribute('aria-pressed')) === 'true';

                    if (isSelected || isPressed) {
                        wasAlready = true;
                    } else {
                        await row.click();
                    }
                    found = true;
                    break;
                }
            }
        } catch (e) { }

        // Fallback: toggleable-list-item-view-model wrapper
        if (!found) {
            try {
                const wrappers = await page.$$('toggleable-list-item-view-model');
                for (const wrapper of wrappers) {
                    const text = await wrapper.textContent();
                    if (text && text.includes(PLAYLIST_NAME)) {
                        const inner = await wrapper.$('yt-list-item-view-model');
                        if (inner) {
                            const pressed = await inner.getAttribute('aria-pressed');
                            if (pressed === 'true') { wasAlready = true; }
                            else { await wrapper.click(); }
                        } else {
                            await wrapper.click();
                        }
                        found = true;
                        break;
                    }
                }
            } catch (e) { }
        }

        // Legacy fallback: ytd-playlist-add-to-option-renderer
        if (!found) {
            try {
                const rows = await page.$$('ytd-playlist-add-to-option-renderer');
                for (const row of rows) {
                    const text = await row.textContent();
                    if (text && text.includes(PLAYLIST_NAME)) {
                        await row.click();
                        found = true;
                        break;
                    }
                }
            } catch (e) { }
        }

        if (!found) throw new Error(`"${PLAYLIST_NAME}" not found in dialog`);

        // === Step 4: Close dialog ===
        await sleep(AFTER_SAVE_DELAY);
        await page.keyboard.press('Escape');
        await sleep(300);

        if (wasAlready) { alreadyAdded++; console.log(`${tag} ${videoId} ⏭️`); }
        else { success++; console.log(`${tag} ${videoId} ✅`); }

    } catch (err) {
        console.log(`${tag} ${videoId} ❌ ${err.message}`);
        fail++;
        failedUrls.push(url);
        try { await page.keyboard.press('Escape'); } catch (e) { }
        await sleep(300);
    }
}

async function worker(context, urls, workerId, page) {
    for (const url of urls) {
        try {
            if (page.isClosed()) {
                page = await context.newPage();
            }
        } catch (e) {
            try { page = await context.newPage(); } catch (e2) {
                console.log(`[T${workerId}] ❌ Cannot create page, stopping worker.`);
                for (const u of urls.slice(urls.indexOf(url))) { fail++; failedUrls.push(u); }
                return;
            }
        }
        await processVideo(page, url, workerId);
    }
    try { await page.close(); } catch (e) { }
}

async function start() {
    console.log('═══════════════════════════════════════════');
    console.log(`  YouTube Playlist Clicker (${CONCURRENT_TABS} tabs)`);
    console.log('═══════════════════════════════════════════\n');

    if (!fs.existsSync(ARCHIVE_FILE)) { console.error(`❌ ${ARCHIVE_FILE} not found`); return; }

    const urls = fs.readFileSync(ARCHIVE_FILE, 'utf8')
        .split('\n').map(l => l.trim()).filter(l => l.startsWith('http'));
    totalUrls = urls.length;
    console.log(`📋 ${urls.length} URLs to process with ${CONCURRENT_TABS} parallel tabs.`);
    console.log(`🎯 Target playlist: "${PLAYLIST_NAME}"\n`);

    console.log('🚀 Launching Chrome Dev...');
    const context = await chromium.launchPersistentContext(AUTOMATION_PROFILE, {
        executablePath: CHROME_PATH,
        headless: false,
        viewport: null,
        timeout: 60000,
        args: [
            '--start-maximized', '--disable-notifications',
            '--no-first-run', '--no-default-browser-check',
            '--disable-blink-features=AutomationControlled'
        ],
        ignoreDefaultArgs: ['--enable-automation'],
    });
    console.log('   ✓ Launched!\n');

    try {
        // Check login
        const mainPage = context.pages()[0] || await context.newPage();
        await mainPage.goto('https://www.youtube.com', { waitUntil: 'networkidle', timeout: 30000 });
        await sleep(2000);
        const avatar = await mainPage.$('#avatar-btn, button[aria-label="Account menu"]');
        if (!avatar) {
            console.log('⚠️  NOT logged in. Please log in in the browser window.');
            await askUser('\n   Press ENTER after logging in... ');
            console.log('   Continuing...\n');
        } else {
            console.log('   ✓ Logged in.\n');
        }
        await mainPage.close();

        // Pre-create worker pages sequentially
        const pages = [];
        for (let i = 0; i < CONCURRENT_TABS; i++) {
            try {
                pages.push(await context.newPage());
                await sleep(300);
            } catch (e) {
                console.log(`   ⚠️  Could only open ${pages.length} tabs`);
                break;
            }
        }

        if (pages.length === 0) {
            console.error('❌ Could not open any tabs!');
            return;
        }

        const actualTabs = pages.length;
        const chunks = Array.from({ length: actualTabs }, () => []);
        urls.forEach((url, i) => chunks[i % actualTabs].push(url));

        console.log(`─── Starting ${actualTabs} workers ───\n`);
        const startTime = Date.now();

        await Promise.all(
            chunks.map((chunk, i) => worker(context, chunk, i + 1, pages[i]))
        );

        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        console.log('\n═══════════════════════════════════════════');
        console.log('  RESULTS');
        console.log('═══════════════════════════════════════════');
        console.log(`  ✅ Added:     ${success}`);
        console.log(`  ⏭️  Already:   ${alreadyAdded}`);
        console.log(`  ❌ Failed:    ${fail}`);
        console.log(`  📋 Total:     ${totalUrls}`);
        console.log(`  ⏱️  Time:      ${elapsed}s`);

        if (failedUrls.length > 0) {
            const failFile = path.join(path.dirname(ARCHIVE_FILE), 'failed_urls.txt');
            fs.writeFileSync(failFile, failedUrls.join('\n'), 'utf8');
            console.log(`\n  Failed URLs → ${failFile}`);
        }

        console.log('═══════════════════════════════════════════');

    } finally {
        await context.close();
    }
}

start().catch(err => { console.error(`\n💥 ${err.message}`); console.error(err.stack); });
