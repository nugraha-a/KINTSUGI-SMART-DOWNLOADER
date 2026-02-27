/**
 * Spotify → YouTube Playlist Converter (Playwright)
 * 
 * Scrapes tracks from a Spotify playlist via Chosic.com, searches YouTube
 * for each, and adds them to an existing YouTube playlist.
 * 
 * Features:
 * - Chosic.com integration for Spotify playlist export (no DRM issues)
 * - Official channel prioritization (VEVO, Topic, verified badge, etc.)
 * - Fuzzy title matching (handles Japanese ↔ Romanji, special chars, etc.)
 * - Duplicate detection against existing playlist
 * - Resume support (saves progress to JSON files)
 * - Multi-tab concurrency for YouTube operations
 * - Same Chrome Dev persistent profile as clicker.js
 */

const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ─── Configuration ───────────────────────────────────────────────
const CONFIG = {
    // Spotify
    spotifyPlaylistUrl: 'https://open.spotify.com/playlist/1BwXW1gY9cdH3DzurM40Hx?si=58ec11a643414e75',

    // YouTube target playlist name (as it appears in the "Save to" dialog)
    youtubePlaylistName: 'My Playlist',

    // Paths
    chromePath: String.raw`C:\Program Files\Google\Chrome Dev\Application\chrome.exe`,
    automationProfile: path.join(__dirname, '.chrome-automation-profile'),
    dataDir: path.join(__dirname, 'spotify_data'),

    // Concurrency
    concurrentTabs: 3,

    // Timing (ms)
    scrollDelay: 1500,
    pageLoadDelay: 2500,
    dialogWait: 1500,
    afterSaveDelay: 1000,

    // Fuzzy matching threshold (0-1, lower = more lenient)
    matchThreshold: 0.35,
};
// ─────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

function askUser(q) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(r => { rl.question(q, ans => { rl.close(); r(ans); }); });
}

// ═══════════════════════════════════════════════════════════════
//  FUZZY MATCHING ENGINE
//  Handles: Japanese/Romanji, special chars, reordered words, etc.
// ═══════════════════════════════════════════════════════════════

function normalize(str) {
    return str
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\(official\s*(music\s*)?video\)/gi, '')
        .replace(/\(official\s*audio\)/gi, '')
        .replace(/\(lyric\s*video\)/gi, '')
        .replace(/\(lyrics?\)/gi, '')
        .replace(/\(mv\)/gi, '')
        .replace(/\[official\s*(music\s*)?video\]/gi, '')
        .replace(/\[mv\]/gi, '')
        .replace(/【.*?】/g, '')
        .replace(/「.*?」/g, '')
        .replace(/『.*?』/g, '')
        .replace(/\s*(\(|\[)?\s*fe?a?t\.?\s+.*?(\)|\])?/gi, '')
        .replace(/[^\w\s\u3000-\u9fff\uff00-\uffef\u4e00-\u9faf]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function levenshtein(a, b) {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
    }
    return dp[m][n];
}

function similarity(a, b) {
    const na = normalize(a);
    const nb = normalize(b);
    if (na === nb) return 1.0;
    if (na.includes(nb) || nb.includes(na)) return 0.9;

    const wordsA = new Set(na.split(' ').filter(w => w.length > 1));
    const wordsB = new Set(nb.split(' ').filter(w => w.length > 1));
    const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
    const union = new Set([...wordsA, ...wordsB]).size;
    const jaccard = union > 0 ? intersection / union : 0;

    const maxLen = Math.max(na.length, nb.length);
    const lev = maxLen > 0 ? 1 - levenshtein(na, nb) / maxLen : 1;

    return Math.max(jaccard, lev);
}

function isInPlaylist(trackTitle, trackArtist, playlistItems) {
    const searchStr = `${trackArtist} ${trackTitle}`;
    let bestScore = 0;
    let bestMatch = '';

    for (const item of playlistItems) {
        const score1 = similarity(searchStr, item.title);
        const score2 = similarity(trackTitle, item.title);
        const score3 = similarity(searchStr, `${item.channel} ${item.title}`);
        const score = Math.max(score1, score2, score3);
        if (score > bestScore) {
            bestScore = score;
            bestMatch = item.title;
        }
    }

    return {
        found: bestScore >= (1 - CONFIG.matchThreshold),
        matchedTitle: bestMatch,
        score: bestScore,
    };
}

// ═══════════════════════════════════════════════════════════════
//  PHASE 1: SCRAPE SPOTIFY PLAYLIST (via Chosic.com)
// ═══════════════════════════════════════════════════════════════

async function scrapeSpotifyPlaylist(page) {
    const cacheFile = path.join(CONFIG.dataDir, 'spotify_tracks.json');

    if (fs.existsSync(cacheFile)) {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        if (cached.length > 0) {
            console.log(`\u{1F4E6} Loaded ${cached.length} tracks from cache (spotify_tracks.json)`);
            const answer = await askUser('   Use cached data? [Y/n]: ');
            if (answer.toLowerCase() !== 'n') return cached;
        }
    }

    console.log('\n\u{1F3B5} Phase 1: Scraping Spotify Playlist via Chosic.com...');
    console.log(`   Spotify URL: ${CONFIG.spotifyPlaylistUrl}\n`);

    await page.goto('https://www.chosic.com/spotify-playlist-exporter/', {
        waitUntil: 'domcontentloaded', timeout: 30000
    });
    await sleep(3000);

    // Accept cookies if dialog appears
    try {
        const cookieBtn = await page.$('button:has-text("Accept"), .cookie-accept, #accept-cookies');
        if (cookieBtn) await cookieBtn.click();
        await sleep(500);
    } catch (e) { }

    // Find the input field and paste the Spotify URL
    console.log('   Pasting Spotify playlist URL...');
    let inputFound = false;

    for (const sel of [
        'input[type="text"]', 'input[type="url"]', 'input[type="search"]',
        'input[placeholder*="playlist" i]', 'input[placeholder*="spotify" i]',
        'input[placeholder*="URL" i]', 'input[placeholder*="link" i]',
        '#playlist-url', '#url-input', '.url-input input', 'input'
    ]) {
        try {
            const input = await page.$(sel);
            if (input && await input.isVisible()) {
                await input.click();
                await input.fill('');
                await input.fill(CONFIG.spotifyPlaylistUrl);
                inputFound = true;
                console.log('   \u2713 URL pasted');
                break;
            }
        } catch (e) { }
    }

    if (!inputFound) {
        console.log('   \u26A0\uFE0F  Could not find URL input. Please paste URL manually.');
        await askUser('   Press ENTER after pasting and clicking export... ');
    } else {
        await sleep(1000);
        let btnClicked = false;

        for (const sel of [
            'button:has-text("Get")', 'button:has-text("Export")',
            'button:has-text("Submit")', 'button:has-text("Search")',
            'button[type="submit"]', 'input[type="submit"]',
            '.export-btn', '#export-btn', '.submit-btn', 'form button'
        ]) {
            try {
                const btn = await page.$(sel);
                if (btn && await btn.isVisible()) {
                    await btn.click();
                    btnClicked = true;
                    console.log('   \u2713 Export button clicked');
                    break;
                }
            } catch (e) { }
        }

        if (!btnClicked) {
            try {
                await page.keyboard.press('Enter');
                btnClicked = true;
                console.log('   \u2713 Pressed Enter');
            } catch (e) { }
        }

        if (!btnClicked) {
            console.log('   \u26A0\uFE0F  Could not find export button. Please click it manually.');
            await askUser('   Press ENTER after tracks are loaded... ');
        }
    }

    // Wait for tracks to load
    console.log('   Waiting for tracks to load...');
    for (let i = 0; i < 30; i++) {
        await sleep(2000);
        const count = await page.evaluate(() => {
            const rows = document.querySelectorAll(
                '.track-row, .playlist-track, tr.track, ' +
                'div[class*="track"], li[class*="track"], ' +
                '.song-row, .tracklist-row, .track-item, ' +
                'table tbody tr'
            );
            return rows.length;
        });
        if (count > 0) {
            console.log(`   \u2713 ${count} tracks detected`);
            break;
        }
        process.stdout.write(`\r   Waiting... (${(i + 1) * 2}s)`);
    }

    // Scroll to load all tracks
    await sleep(1000);
    let prevCount = 0, stableCount = 0;
    for (let i = 0; i < 50; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await sleep(1000);
        const count = await page.evaluate(() =>
            document.querySelectorAll('table tbody tr, .track-row, .playlist-track, div[class*="track"]').length
        );
        if (count === prevCount) {
            stableCount++;
            if (stableCount >= 3) break;
        } else {
            stableCount = 0;
            process.stdout.write(`\r   ${count} tracks...`);
        }
        prevCount = count;
    }
    console.log('');

    // Extract tracks
    let tracks = await page.evaluate(() => {
        const result = [];
        const seen = new Set();

        // Strategy 1: Table rows (Chosic uses a table)
        const tableRows = document.querySelectorAll('table tbody tr, .tracklist tr');
        if (tableRows.length > 0) {
            for (const row of tableRows) {
                const cells = row.querySelectorAll('td');
                if (cells.length >= 2) {
                    let title = '', artist = '';
                    for (const cell of cells) {
                        const text = cell.textContent.trim();
                        if (!text || /^\d+$/.test(text)) continue;
                        if (!title) { title = text; continue; }
                        if (!artist) { artist = text; break; }
                    }
                    if (title && !seen.has(title)) {
                        seen.add(title);
                        result.push({ title, artist });
                    }
                }
            }
            if (result.length > 0) return result;
        }

        // Strategy 2: Div-based track items
        const trackDivs = document.querySelectorAll(
            '.track-row, .playlist-track, .song-row, .track-item, ' +
            'div[class*="TrackRow"], div[class*="track-row"]'
        );
        for (const div of trackDivs) {
            const titleEl = div.querySelector('.track-name, .song-name, .title, [class*="title"], a:first-child');
            const artistEl = div.querySelector('.track-artist, .artist, [class*="artist"], .secondary');
            const title = titleEl ? titleEl.textContent.trim() : '';
            const artist = artistEl ? artistEl.textContent.trim() : '';
            if (title && !seen.has(title)) { seen.add(title); result.push({ title, artist }); }
        }
        if (result.length > 0) return result;

        // Strategy 3: Generic links
        const allContainers = document.querySelectorAll('[class*="track"], [class*="song"], [class*="item"]');
        for (const el of allContainers) {
            const links = el.querySelectorAll('a');
            if (links.length >= 1) {
                const title = links[0].textContent.trim();
                const artist = links.length >= 2 ? links[1].textContent.trim() : '';
                if (title && title.length > 2 && !seen.has(title)) {
                    seen.add(title);
                    result.push({ title, artist });
                }
            }
        }
        return result;
    });

    if (tracks.length === 0) {
        const debugFile = path.join(CONFIG.dataDir, 'chosic_debug.html');
        const html = await page.content();
        fs.writeFileSync(debugFile, html, 'utf8');
        console.log('   \u274C Auto-extraction failed. Page saved to: ' + debugFile);
        console.log('   Tip: You can manually create spotify_tracks.json:');
        console.log('   [{"title": "Song Name", "artist": "Artist Name"}, ...]');
        return [];
    }

    console.log(`   \u2713 Scraped ${tracks.length} tracks\n`);
    tracks.slice(0, 5).forEach((t, i) => console.log(`   ${i + 1}. ${t.artist} \u2014 ${t.title}`));
    if (tracks.length > 5) console.log(`   ... and ${tracks.length - 5} more\n`);

    fs.writeFileSync(cacheFile, JSON.stringify(tracks, null, 2), 'utf8');
    console.log('   \uD83D\uDCBE Saved to spotify_tracks.json\n');

    return tracks;
}

// ═══════════════════════════════════════════════════════════════
//  PHASE 2: FETCH EXISTING YOUTUBE PLAYLIST (for dedup)
// ═══════════════════════════════════════════════════════════════

async function fetchExistingPlaylist(page, playlistUrl) {
    const cacheFile = path.join(CONFIG.dataDir, 'youtube_playlist_cache.json');

    if (fs.existsSync(cacheFile)) {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        console.log(`\u{1F4E6} Loaded ${cached.length} existing playlist items from cache`);
        const answer = await askUser('   Use cached playlist data? [Y/n]: ');
        if (answer.toLowerCase() !== 'n') return cached;
    }

    console.log('\n\u{1F4CB} Phase 2: Fetching existing YouTube playlist for dedup...');
    await page.goto(playlistUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);

    // Scroll to load ALL videos (YouTube loads ~100 per batch)
    console.log('   Scrolling to load all videos (YouTube loads ~100 per batch)...');
    let prevCount = 0;
    let stable = 0;
    const STABLE_THRESHOLD = 8;

    for (let i = 0; i < 500; i++) {
        await page.evaluate(() => {
            window.scrollTo(0, document.body.scrollHeight);
            const container = document.querySelector('ytd-section-list-renderer') ||
                document.querySelector('#contents');
            if (container) container.scrollTop = container.scrollHeight;
        });
        await sleep(2000);

        const count = await page.evaluate(() =>
            document.querySelectorAll('ytd-playlist-video-renderer').length
        );

        if (count === prevCount) {
            stable++;
            process.stdout.write(`\r   Loaded ${count} videos (waiting ${stable}/${STABLE_THRESHOLD})...`);
            if (stable >= STABLE_THRESHOLD) {
                process.stdout.write(`\r   \u2713 Loaded all ${count} videos (scroll stabilized)          \n`);
                break;
            }
            if (stable % 3 === 0) {
                await page.evaluate(() => window.scrollTo(0, 0));
                await sleep(500);
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await sleep(1500);
            }
        } else {
            stable = 0;
            process.stdout.write(`\r   Loading... ${count} videos`);
        }
        prevCount = count;
    }

    const items = await page.evaluate(() => {
        const videos = document.querySelectorAll('ytd-playlist-video-renderer');
        return Array.from(videos).map(v => {
            const titleEl = v.querySelector('#video-title');
            const channelEl = v.querySelector('#channel-name a, .ytd-channel-name a, #text.ytd-channel-name');
            const linkEl = v.querySelector('a#thumbnail, a[href*="watch"]');
            const href = linkEl ? linkEl.getAttribute('href') : '';
            const videoId = href ? new URLSearchParams(href.split('?')[1] || '').get('v') : '';
            return {
                title: titleEl ? titleEl.textContent.trim() : '',
                channel: channelEl ? channelEl.textContent.trim() : '',
                videoId: videoId || '',
            };
        });
    });

    console.log(`   \u2713 Found ${items.length} videos in existing playlist\n`);

    fs.writeFileSync(cacheFile, JSON.stringify(items, null, 2), 'utf8');
    return items;
}

// ═══════════════════════════════════════════════════════════════
//  PHASE 3: SEARCH YOUTUBE FOR EACH TRACK
//  Prioritizes official channels (VEVO, Topic, verified, etc.)
// ═══════════════════════════════════════════════════════════════

function scoreOfficialness(title, channel) {
    let score = 0;
    const ch = channel.toLowerCase();
    const t = title.toLowerCase();

    if (ch.includes('vevo')) score += 100;
    if (ch.endsWith('- topic') || ch.endsWith('- \u30C8\u30D4\u30C3\u30AF')) score += 90;
    if (ch.includes('official')) score += 60;
    if (t.includes('official audio') || t.includes('official video') || t.includes('official music video')) score += 50;
    if (t.includes('\u516C\u5F0F') || ch.includes('\u516C\u5F0F')) score += 50;
    if (t.includes(' mv') || t.includes('(mv)') || t.includes('[mv]')) score += 20;
    if (t.includes('audio') || t.includes('lyric video') || t.includes('lyrics')) score += 10;
    if (t.includes('cover') || t.includes('\u30AB\u30D0\u30FC')) score -= 80;
    if (t.includes('remix') && !t.includes('official remix')) score -= 30;
    if (t.includes('reaction')) score -= 100;
    if (t.includes('tutorial') || t.includes('lesson')) score -= 100;
    if (t.includes('piano ver') || t.includes('acoustic ver') || t.includes('\u5F3E\u3044\u3066\u307F\u305F') || t.includes('\u6B4C\u3063\u3066\u307F\u305F')) score -= 70;
    if (t.includes('live') && !t.includes('official live')) score -= 10;

    return score;
}

async function searchYouTubeForTrack(page, track) {
    const query = `${track.artist} ${track.title}`;
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

    try {
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    } catch (e) {
        await sleep(2000);
        try {
            await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        } catch (e2) {
            return null;
        }
    }
    await sleep(2500);

    try {
        await page.waitForSelector('ytd-video-renderer', { timeout: 10000 });
    } catch (e) { }

    const candidates = await page.evaluate(() => {
        const renderers = document.querySelectorAll('ytd-video-renderer');
        const results = [];
        for (const r of renderers) {
            if (results.length >= 10) break;
            if (r.querySelector('[data-style="DISPLAY_AD"]') || r.querySelector('ytd-ad-slot-renderer'))
                continue;

            const titleEl = r.querySelector('#video-title');
            const linkEl = r.querySelector('a#video-title, a#thumbnail');
            const channelEl = r.querySelector('.ytd-channel-name a, #text.ytd-channel-name');
            const badgeEl = r.querySelector('ytd-badge-supported-renderer .badge-style-type-verified, .badge-style-type-verified-artist');

            if (titleEl && linkEl) {
                const href = linkEl.getAttribute('href') || '';
                if (href.includes('/shorts/')) continue;
                const videoId = new URLSearchParams(href.split('?')[1] || '').get('v');
                if (!videoId) continue;

                results.push({
                    title: titleEl.textContent.trim(),
                    channel: channelEl ? channelEl.textContent.trim() : '',
                    url: `https://www.youtube.com/watch?v=${videoId}`,
                    videoId,
                    verified: !!badgeEl,
                });
            }
        }
        return results;
    });

    if (candidates.length === 0) return null;

    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        let score = scoreOfficialness(c.title, c.channel);
        if (c.verified) score += 70;
        score += (10 - i) * 2;
        const querySim = similarity(`${track.artist} ${track.title}`, c.title);
        score += querySim * 30;

        if (score > bestScore) {
            bestScore = score;
            bestIdx = i;
        }
    }

    const picked = candidates[bestIdx];
    if (bestIdx > 0) {
        picked._note = `Picked #${bestIdx + 1} over #1 (official score: ${bestScore.toFixed(0)})`;
    }
    return picked;
}

async function searchAllTracks(context, tracks, existingPlaylist) {
    const mapFile = path.join(CONFIG.dataDir, 'spotify_youtube_map.json');
    let trackMap = {};

    if (fs.existsSync(mapFile)) {
        trackMap = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
        const done = Object.keys(trackMap).length;
        console.log(`\u{1F4E6} Loaded ${done} previously resolved tracks`);
    }

    console.log('\n\uD83D\uDD0D Phase 3: Searching YouTube for each Spotify track...\n');

    const page = await context.newPage();
    let searched = 0, skippedDup = 0, skippedResolved = 0, notFound = 0;

    for (const track of tracks) {
        const key = `${track.artist} \u2014 ${track.title}`;

        if (trackMap[key]) {
            skippedResolved++;
            continue;
        }

        const dupCheck = isInPlaylist(track.title, track.artist, existingPlaylist);
        if (dupCheck.found) {
            skippedDup++;
            trackMap[key] = {
                status: 'already_in_playlist',
                matchedTitle: dupCheck.matchedTitle,
                score: dupCheck.score.toFixed(2),
            };
            console.log(`  \u23ED\uFE0F  [${searched + skippedDup + skippedResolved}/${tracks.length}] ${key}`);
            console.log(`      \u2514\u2500 Already in playlist: "${dupCheck.matchedTitle}" (${(dupCheck.score * 100).toFixed(0)}% match)`);
            continue;
        }

        searched++;
        const result = await searchYouTubeForTrack(page, track);

        if (result && result.url) {
            const idMatch = existingPlaylist.find(p => p.videoId === result.videoId);
            if (idMatch) {
                skippedDup++;
                trackMap[key] = {
                    status: 'already_in_playlist',
                    matchedTitle: idMatch.title,
                    videoId: result.videoId,
                    score: '1.00 (exact videoId)',
                };
                console.log(`  \u23ED\uFE0F  [${searched + skippedDup + skippedResolved}/${tracks.length}] ${key}`);
                console.log(`      \u2514\u2500 Exact video already in playlist: "${idMatch.title}"`);
            } else {
                trackMap[key] = {
                    status: 'found',
                    url: result.url,
                    videoId: result.videoId,
                    youtubeTitle: result.title,
                    channel: result.channel,
                };
                console.log(`  \u2705 [${searched + skippedDup + skippedResolved}/${tracks.length}] ${key}`);
                console.log(`      \u2514\u2500 Found: "${result.title}" by ${result.channel}`);
            }
        } else {
            notFound++;
            trackMap[key] = { status: 'not_found' };
            console.log(`  \u274C [${searched + skippedDup + skippedResolved}/${tracks.length}] ${key}`);
            console.log(`      \u2514\u2500 No results found`);
        }

        fs.writeFileSync(mapFile, JSON.stringify(trackMap, null, 2), 'utf8');
        await sleep(500);
    }

    await page.close();

    const toAdd = Object.entries(trackMap).filter(([, v]) => v.status === 'found');
    console.log('\n   \u2500\u2500\u2500 Search Summary \u2500\u2500\u2500');
    console.log(`   \uD83D\uDD0D Searched:            ${searched}`);
    console.log(`   \u23ED\uFE0F  Already in playlist: ${skippedDup}`);
    console.log(`   \u{1F4E6} Previously resolved: ${skippedResolved}`);
    console.log(`   \u274C Not found:           ${notFound}`);
    console.log(`   \uD83C\uDFAF To add:             ${toAdd.length}\n`);

    return trackMap;
}

// ═══════════════════════════════════════════════════════════════
//  PHASE 4: ADD TO YOUTUBE PLAYLIST
//  (Same pattern as clicker.js)
// ═══════════════════════════════════════════════════════════════

let success = 0, alreadyAdded = 0, fail = 0;
const failedUrls = [];
let processed = 0;
let totalToAdd = 0;

async function addVideoToPlaylist(page, url, trackName, workerId) {
    processed++;
    const tag = `[${processed}/${totalToAdd}][T${workerId}]`;
    const videoId = (() => { try { return new URL(url).searchParams.get('v') || '?'; } catch { return '?'; } })();

    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        try {
            await page.waitForSelector('#top-level-buttons-computed, ytd-menu-renderer', { timeout: 8000 });
        } catch (e) { }
        await sleep(1500);

        // === Step 1: Click Save ===
        let saveClicked = false;

        try {
            const saveBtn = await page.waitForSelector(
                'button[aria-label*="Save" i]',
                { timeout: 6000, state: 'visible' }
            );
            if (saveBtn) { await saveBtn.click(); saveClicked = true; }
        } catch (e) { }

        if (!saveClicked) {
            try {
                const dots = await page.$$('ytd-menu-renderer yt-icon-button button, ytd-menu-renderer button[aria-label="More actions"]');
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

        if (!saveClicked) {
            try {
                const btns = await page.$$('ytd-toggle-button-renderer, ytd-button-renderer');
                for (const btn of btns) {
                    const txt = await btn.textContent();
                    if (txt && txt.trim().toLowerCase() === 'save') {
                        await btn.click(); saveClicked = true; break;
                    }
                }
            } catch (e) { }
        }

        if (!saveClicked) throw new Error('Save btn not found');

        // === Step 2: Wait for Save dialog ===
        await sleep(CONFIG.dialogWait);
        let dialogFound = false;
        for (const sel of [
            'ytd-add-to-playlist-renderer',
            'tp-yt-paper-dialog:has-text("Save to")',
            'ytd-popup-container:has-text("Save to")',
        ]) {
            try {
                await page.waitForSelector(sel, { timeout: 2000, state: 'visible' });
                dialogFound = true; break;
            } catch (e) { }
        }
        if (!dialogFound) throw new Error('Dialog not found');
        await sleep(800);

        // === Step 3: Click target playlist ===
        let found = false, wasAlready = false;
        const playlistName = CONFIG.youtubePlaylistName;

        try {
            const row = page.locator('ytd-playlist-add-to-option-renderer', { hasText: playlistName });
            if (await row.count() > 0) {
                const isChecked = await row.evaluate(el => {
                    const cb = el.querySelector('tp-yt-paper-checkbox, #checkbox, button[aria-pressed]');
                    if (!cb) return false;
                    return cb.getAttribute('aria-checked') === 'true' ||
                        cb.getAttribute('aria-pressed') === 'true' ||
                        cb.hasAttribute('checked');
                });
                if (isChecked) { wasAlready = true; }
                else { await row.click(); }
                found = true;
            }
        } catch (e) { }

        if (!found) {
            const rows = await page.$$('ytd-playlist-add-to-option-renderer');
            for (const r of rows) {
                const t = await r.textContent();
                if (t && t.includes(playlistName)) { await r.click(); found = true; break; }
            }
        }

        if (!found) {
            try {
                await page.locator(`text="${playlistName}"`).first().click();
                found = true;
            } catch (e) { }
        }

        if (!found) throw new Error(`Playlist "${playlistName}" not found in dialog`);

        // === Step 4: Verify save was registered ===
        if (!wasAlready) {
            await sleep(2000);
            let verified = false;
            try {
                const row = page.locator('ytd-playlist-add-to-option-renderer', { hasText: playlistName });
                verified = await row.evaluate(el => {
                    const cb = el.querySelector('tp-yt-paper-checkbox, #checkbox, button[aria-pressed]');
                    if (!cb) return false;
                    return cb.getAttribute('aria-checked') === 'true'
                        || cb.getAttribute('aria-pressed') === 'true'
                        || cb.hasAttribute('checked');
                });
            } catch (e) { }
            if (!verified) throw new Error('Save clicked but checkbox not confirmed');
        }

        await sleep(500);
        await page.keyboard.press('Escape');
        await sleep(300);

        if (wasAlready) {
            alreadyAdded++;
            console.log(`${tag} \u23ED\uFE0F  ${trackName} (already saved)`);
        } else {
            success++;
            console.log(`${tag} \u2705 ${trackName}`);
        }

    } catch (err) {
        console.log(`${tag} \u274C ${trackName} \u2014 ${err.message}`);
        fail++;
        failedUrls.push({ url, trackName });
        try { await page.keyboard.press('Escape'); } catch (e) { }
        await sleep(300);
    }
}

async function addWorker(context, items, workerId) {
    const page = await context.newPage();
    for (const { url, trackName } of items) {
        await addVideoToPlaylist(page, url, trackName, workerId);
    }
    await page.close();
}

// ═══════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════

async function start() {
    console.log('\u2550'.repeat(59));
    console.log('  \u{1F3B5} Spotify \u2192 YouTube Playlist Converter');
    console.log('\u2550'.repeat(59) + '\n');

    if (!fs.existsSync(CONFIG.dataDir)) fs.mkdirSync(CONFIG.dataDir, { recursive: true });

    const isFirstRun = !fs.existsSync(CONFIG.automationProfile);
    console.log('\uD83D\uDE80 Launching Chrome Dev...');
    if (isFirstRun) console.log('   First run \u2014 you may need to log in to YouTube & Spotify.\n');

    const context = await chromium.launchPersistentContext(CONFIG.automationProfile, {
        executablePath: CONFIG.chromePath,
        headless: false,
        viewport: null,
        timeout: 60000,
        args: [
            '--start-maximized', '--disable-notifications',
            '--no-first-run', '--no-default-browser-check',
            '--disable-blink-features=AutomationControlled',
        ],
        ignoreDefaultArgs: ['--enable-automation'],
    });
    console.log('   \u2713 Launched!\n');

    const mainPage = context.pages()[0] || await context.newPage();
    await mainPage.goto('https://www.youtube.com', { waitUntil: 'networkidle', timeout: 30000 });
    await sleep(2000);
    const avatar = await mainPage.$('#avatar-btn, button[aria-label="Account menu"]');
    if (!avatar) {
        console.log('\u26A0\uFE0F  NOT logged in to YouTube. Please log in.');
        await askUser('\n   Press ENTER after logging in... ');
    } else {
        console.log('   \u2713 YouTube: Logged in.\n');
    }

    // Phase 1
    const tracks = await scrapeSpotifyPlaylist(mainPage);
    if (tracks.length === 0) {
        console.log('\u274C No tracks found. Check the Spotify URL.');
        await context.close();
        return;
    }

    // Phase 2
    let playlistUrl = '';
    const answer = await askUser('\u{1F4CB} Enter your YouTube playlist URL (or press ENTER to skip dedup): ');
    playlistUrl = answer.trim();

    let existingPlaylist = [];
    if (playlistUrl) {
        existingPlaylist = await fetchExistingPlaylist(mainPage, playlistUrl);
    } else {
        console.log('   \u26A0\uFE0F  Skipping dedup (no playlist URL). Will still detect via Save dialog.\n');
    }

    // Phase 3
    const trackMap = await searchAllTracks(context, tracks, existingPlaylist);

    // Phase 4
    const toAdd = Object.entries(trackMap)
        .filter(([, v]) => v.status === 'found')
        .map(([key, v]) => ({ url: v.url, trackName: key }));

    if (toAdd.length === 0) {
        console.log('\u2705 Nothing new to add! All tracks already in playlist or not found.');
        await context.close();
        return;
    }

    console.log(`\n\uD83C\uDFAF Phase 4: Adding ${toAdd.length} videos to "${CONFIG.youtubePlaylistName}"...\n`);
    totalToAdd = toAdd.length;

    const confirm = await askUser(`   Add ${toAdd.length} videos? [Y/n]: `);
    if (confirm.toLowerCase() === 'n') {
        console.log('   Cancelled.');
        await context.close();
        return;
    }

    await mainPage.close();

    const tabs = Math.min(CONFIG.concurrentTabs, toAdd.length);
    const chunks = Array.from({ length: tabs }, () => []);
    toAdd.forEach((item, i) => chunks[i % tabs].push(item));

    console.log(`\n\u2500\u2500\u2500 Starting ${tabs} workers \u2500\u2500\u2500\n`);
    const startTime = Date.now();

    await Promise.all(
        chunks.map((chunk, i) => addWorker(context, chunk, i + 1))
    );

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n' + '\u2550'.repeat(59));
    console.log('  RESULTS');
    console.log('\u2550'.repeat(59));
    console.log(`  \u2705 Added:          ${success}`);
    console.log(`  \u23ED\uFE0F  Already saved:  ${alreadyAdded}`);
    console.log(`  \u274C Failed:         ${fail}`);
    console.log(`  \u{1F4CB} Total:          ${totalToAdd}`);
    console.log(`  \u23F1\uFE0F  Time:           ${elapsed}s`);

    if (failedUrls.length > 0) {
        const failFile = path.join(CONFIG.dataDir, 'failed_spotify_urls.json');
        fs.writeFileSync(failFile, JSON.stringify(failedUrls, null, 2), 'utf8');
        console.log(`\n  Failed URLs \u2192 ${failFile}`);
    }

    const mapFile = path.join(CONFIG.dataDir, 'spotify_youtube_map.json');
    for (const { trackName } of toAdd) {
        if (trackMap[trackName] && trackMap[trackName].status === 'found') {
            trackMap[trackName].status = 'added';
        }
    }
    fs.writeFileSync(mapFile, JSON.stringify(trackMap, null, 2), 'utf8');

    console.log('\u2550'.repeat(59));
    console.log('\nPress Ctrl+C to exit.');

    await new Promise(() => { });
}

start().catch(err => { console.error(`\n\uD83D\uDCA5 ${err.message}`); console.error(err.stack); });
