/**
 * Playlist Audit - Compare archive.txt vs online YouTube playlist
 * Uses yt-dlp to fetch online playlist, then compares with local archive.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ARCHIVE_FILE = String.raw`c:\Users\it\Music\Playlists\Kintsugi\data\archive.txt`;
const PLAYLIST_URL = 'https://www.youtube.com/playlist?list=PLP_tyyJ-U_wvCVc_darF_W5_t0TnurwLr';
const YT_DLP = path.join(__dirname, 'yt-dlp.exe');

function extractVideoId(url) {
    try {
        const u = new URL(url);
        return u.searchParams.get('v') || '';
    } catch { return ''; }
}

async function main() {
    console.log('═══════════════════════════════════════');
    console.log('  Playlist Audit');
    console.log('═══════════════════════════════════════\n');

    // 1. Read local archive
    console.log('📂 Reading archive.txt...');
    const archiveLines = fs.readFileSync(ARCHIVE_FILE, 'utf8')
        .split('\n').map(l => l.trim()).filter(l => l.startsWith('http'));

    const archiveIds = archiveLines.map(extractVideoId).filter(Boolean);
    const archiveSet = new Set(archiveIds);

    // Check for duplicates in archive
    const dupeMap = {};
    archiveIds.forEach((id, i) => {
        if (!dupeMap[id]) dupeMap[id] = [];
        dupeMap[id].push(i + 1);
    });
    const duplicates = Object.entries(dupeMap).filter(([, lines]) => lines.length > 1);

    console.log(`   Archive: ${archiveLines.length} URLs, ${archiveSet.size} unique video IDs`);
    if (duplicates.length > 0) {
        console.log(`   ⚠️  ${duplicates.length} duplicate IDs found in archive!`);
    }

    // 2. Fetch online playlist
    console.log('\n🌐 Fetching online playlist (this may take a minute)...');
    let onlineIds = [];
    try {
        const result = execSync(
            `"${YT_DLP}" --flat-playlist --print id "${PLAYLIST_URL}"`,
            { encoding: 'utf8', timeout: 120000, maxBuffer: 10 * 1024 * 1024 }
        );
        onlineIds = result.split('\n').map(l => l.trim()).filter(Boolean);
    } catch (err) {
        console.error(`❌ Failed to fetch playlist: ${err.message}`);
        return;
    }

    const onlineSet = new Set(onlineIds);
    console.log(`   Online:  ${onlineIds.length} videos`);

    // 3. Compare
    const inArchiveNotOnline = [...archiveSet].filter(id => !onlineSet.has(id));
    const inOnlineNotArchive = [...onlineSet].filter(id => !archiveSet.has(id));

    console.log('\n═══════════════════════════════════════');
    console.log('  AUDIT RESULTS');
    console.log('═══════════════════════════════════════');
    console.log(`  📂 Archive:            ${archiveLines.length} URLs (${archiveSet.size} unique)`);
    console.log(`  🌐 Online playlist:    ${onlineIds.length} videos`);
    console.log(`  🔄 Duplicates in file: ${duplicates.length}`);
    console.log(`  ❌ In archive, NOT online: ${inArchiveNotOnline.length}`);
    console.log(`  ➕ Online, NOT in archive: ${inOnlineNotArchive.length}`);

    if (duplicates.length > 0) {
        console.log('\n── Duplicates in archive.txt ──');
        duplicates.forEach(([id, lines]) => {
            console.log(`  ${id} → lines ${lines.join(', ')}`);
        });
    }

    if (inArchiveNotOnline.length > 0) {
        console.log('\n── In archive but MISSING from online playlist ──');
        inArchiveNotOnline.forEach(id => {
            console.log(`  https://www.youtube.com/watch?v=${id}`);
        });
        // Save to file
        const missingFile = path.join(path.dirname(ARCHIVE_FILE), 'missing_online.txt');
        fs.writeFileSync(missingFile, inArchiveNotOnline.map(id => `https://www.youtube.com/watch?v=${id}`).join('\n'), 'utf8');
        console.log(`  → Saved to ${missingFile}`);
    }

    if (inOnlineNotArchive.length > 0) {
        console.log('\n── Online but NOT in archive.txt ──');
        inOnlineNotArchive.forEach(id => {
            console.log(`  https://www.youtube.com/watch?v=${id}`);
        });
        const extraFile = path.join(path.dirname(ARCHIVE_FILE), 'extra_online.txt');
        fs.writeFileSync(extraFile, inOnlineNotArchive.map(id => `https://www.youtube.com/watch?v=${id}`).join('\n'), 'utf8');
        console.log(`  → Saved to ${extraFile}`);
    }

    console.log('\n═══════════════════════════════════════');
}

main().catch(err => console.error(`💥 ${err.message}`));
