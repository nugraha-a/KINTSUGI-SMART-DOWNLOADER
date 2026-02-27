// One-time fix: reset corrupted local_filename entries in the database
// These were caused by a regex bug that truncated paths at the first space
const fs = require('fs');
const dbPath = 'C:/Users/it/Music/Playlists/Kintsugi - Copy/data/kintsugi_db.json';
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
let fixed = 0;

Object.entries(db).forEach(([id, entry]) => {
    if (entry.local_filename && !entry.local_filename.endsWith('.opus') &&
        !entry.local_filename.endsWith('.webm') && !entry.local_filename.endsWith('.m4a') &&
        !entry.local_filename.endsWith('.mp3') && !entry.local_filename.endsWith('.flac')) {
        console.log(`FIX: [${id}] "${entry.title}" had local_filename="${entry.local_filename}", resetting to null`);
        entry.local_filename = null;
        entry.download_status = 'pending';
        fixed++;
    }
});

if (fixed > 0) {
    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');
    console.log(`\nFixed ${fixed} corrupted entries. They will be re-downloaded on next run.`);
} else {
    console.log('No corrupted entries found.');
}
