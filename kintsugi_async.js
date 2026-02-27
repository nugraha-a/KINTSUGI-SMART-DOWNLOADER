/**
 * KINTSUGI FINAL v67.0 (SMART QUALITY EDITION)
 * Features: 
 * - Multi-threaded FFmpeg source file to Opus conversion
 * - Dynamic quality selection based on source file analysis
 * - Multi-threaded yt-dlp downloads with worker pool
 * - Session Logging (Timestamped), Granular File/Activity Tracking
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const os = require('os');

// --- KONFIGURASI ---
const CONFIG = {
    url: "https://www.youtube.com/playlist?list=PLP_tyyJ-U_wuGtrsqPbQjmvH4gaiNLp-_",
    outputDir: "C:\\Users\\it\\Music\\Playlists\\Kintsugi - Copy",
    ytDlpExe: "yt-dlp.exe",
    ffmpegExe: "ffmpeg.exe",   // FFmpeg executable path
    ffprobeExe: "ffprobe.exe", // FFprobe for audio analysis

    // DATA FOLDER STRUCTURE
    dataDir: "data",            // data/ folder for database and archive
    logDir: "data/log",         // data/log/ folder for log files
    dbFile: "kintsugi_db.json",
    archiveFile: "archive.txt",

    // MODE: SESSION (Sesuai Request)
    logMode: 'SESSION',

    // MULTI-THREAD CONFIG
    maxDownloadConcurrency: 3,      // Concurrent yt-dlp downloads
    maxFfmpegConcurrency: Math.max(2, os.cpus().length - 2), // FFmpeg threads (auto-detect CPU)
    ffmpegThreadsPerJob: 2,         // FFmpeg threads per single conversion job
    staggerDelay: 500,              // Delay between starting workers (ms)

    // SOURCE FILES CONVERSION CONFIG (YouTube original formats only)
    sourceDir: null,                // Will prompt user if not set, or use outputDir
    supportedSourceFormats: ['.webm', '.m4a'],  // YouTube original audio formats
    deleteSourceAfterConvert: true, // Delete source files after successful conversion

    // DYNAMIC QUALITY CONFIG (based on YouTube Opus quality tiers)
    // YouTube Quality Tiers:
    //   Opus 249: ~50 kbps  (Low quality / data saver)
    //   Opus 251: ~128-160 kbps (Standard YouTube)
    //   Opus 774: ~256 kbps (YouTube Music Premium)
    dynamicQuality: true,           // Enable dynamic quality selection
    qualityTiers: {
        lossless: '256k',           // FLAC, WAV, AIFF (preserve quality)
        high: '192k',               // Source >= 256 kbps
        standard: '128k',           // Source >= 128 kbps (YouTube default)
        low: '96k',                 // Source >= 96 kbps  
        minimum: '64k'              // Source < 96 kbps
    },
    fallbackBitrate: '128k'         // Used when probe fails
};

const C = { Reset: "\x1b[0m", Red: "\x1b[31m", Green: "\x1b[32m", Yellow: "\x1b[33m", Cyan: "\x1b[36m", Magenta: "\x1b[35m", Gray: "\x1b[90m", Blue: "\x1b[34m" };

let isStopping = false;
const activeProcesses = new Set(); // Track all spawned processes for cleanup

const DOWNLOAD_STRATEGIES = [
    { name: "NITRO", args: ["--extractor-args", "youtube:player-client=android_vr", "-N", "8"] },
    { name: "SAFE", args: ["--extractor-args", "youtube:player-client=android", "-N", "2"] },
    { name: "IOS", args: ["--extractor-args", "youtube:player-client=ios"] }
];

function forceKill() {
    if (isStopping) return;
    isStopping = true;
    Logger.error("SYSTEM", "User menekan CTRL+C. Force Stopping...");

    // Kill all active processes
    activeProcesses.forEach(proc => {
        try { proc.kill('SIGKILL'); } catch (e) { }
    });

    try { execSync(`taskkill /F /IM ${CONFIG.ytDlpExe} /T`, { stdio: 'ignore' }); } catch (e) { }
    try { execSync(`taskkill /F /IM ${CONFIG.ffmpegExe} /T`, { stdio: 'ignore' }); } catch (e) { }
    try { execSync(`taskkill /F /IM ${CONFIG.ffprobeExe} /T`, { stdio: 'ignore' }); } catch (e) { }
    process.exit(0);
}
process.on('SIGINT', forceKill);

// --- AUDIO QUALITY ANALYZER ---
/**
 * Probe audio file to get bitrate, sample rate, and codec info
 * @param {string} filePath - Path to audio file
 * @returns {Promise<{bitrate: number, sampleRate: number, codec: string, isLossless: boolean}>}
 */
async function probeAudioInfo(filePath) {
    return new Promise((resolve) => {
        const ffprobePath = CONFIG.ffprobeExe.includes(path.sep)
            ? CONFIG.ffprobeExe
            : path.resolve(__dirname, CONFIG.ffprobeExe);

        const args = [
            '-v', 'quiet',
            '-print_format', 'json',
            '-show_format',
            '-show_streams',
            filePath
        ];

        const child = spawn(ffprobePath, args, { shell: false });
        activeProcesses.add(child);

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => stdout += data.toString());
        child.stderr.on('data', (data) => stderr += data.toString());

        child.on('close', (code) => {
            activeProcesses.delete(child);

            if (code !== 0) {
                Logger.file("PROBE", `FFprobe failed for ${path.basename(filePath)}`);
                resolve(null);
                return;
            }

            try {
                const data = JSON.parse(stdout);
                const audioStream = data.streams?.find(s => s.codec_type === 'audio');

                if (!audioStream) {
                    resolve(null);
                    return;
                }

                const codec = audioStream.codec_name?.toLowerCase() || '';
                const isLossless = ['flac', 'alac', 'wav', 'pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'aiff'].includes(codec);

                // Get bitrate (prefer stream bitrate, fallback to format bitrate)
                let bitrate = parseInt(audioStream.bit_rate) || parseInt(data.format?.bit_rate) || 0;
                bitrate = Math.round(bitrate / 1000); // Convert to kbps

                resolve({
                    bitrate,
                    sampleRate: parseInt(audioStream.sample_rate) || 44100,
                    codec,
                    isLossless,
                    channels: audioStream.channels || 2
                });
            } catch (e) {
                Logger.file("PROBE", `Parse error: ${e.message}`);
                resolve(null);
            }
        });

        child.on('error', () => {
            activeProcesses.delete(child);
            resolve(null);
        });
    });
}

/**
 * Determine optimal Opus bitrate based on source file quality
 * @param {object} audioInfo - Result from probeAudioInfo
 * @returns {string} - Optimal bitrate like '128k'
 */
function getOptimalOpusBitrate(audioInfo) {
    if (!audioInfo) {
        return CONFIG.fallbackBitrate;
    }

    const { bitrate, isLossless, sampleRate } = audioInfo;
    const tiers = CONFIG.qualityTiers;

    // Lossless sources get maximum quality
    if (isLossless) {
        Logger.file("QUALITY", `Lossless source detected -> ${tiers.lossless}`);
        return tiers.lossless;
    }

    // High sample rate sources (>=48kHz) deserve better quality
    const highRes = sampleRate >= 48000;

    // Determine tier based on source bitrate
    // Never output higher than source (no point in upsampling)
    if (bitrate >= 256 || highRes) {
        return tiers.high;      // 192k
    } else if (bitrate >= 160) {
        return tiers.standard;  // 128k (YouTube Opus 251 equivalent)
    } else if (bitrate >= 128) {
        return tiers.standard;  // 128k
    } else if (bitrate >= 96) {
        return tiers.low;       // 96k
    } else if (bitrate > 0) {
        return tiers.minimum;   // 64k (minimum reasonable quality)
    }

    return CONFIG.fallbackBitrate;
}

// --- 0. LOGGER SYSTEM (THE CHRONICLER) ---
const Logger = {
    currentLogPath: "",
    lock: false,

    init: () => {
        const now = new Date();
        const timeStr = now.toISOString().replace(/T/, '_').replace(/:/g, '-').split('.')[0];
        // Ensure log directory exists
        const logDir = path.join(CONFIG.outputDir, CONFIG.logDir);
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        Logger.currentLogPath = path.join(logDir, `runner_${timeStr}.log`);
        Logger.startSession();
    },

    _write: (level, context, message) => {
        const now = new Date();
        const timeStr = now.toISOString().replace('T', ' ').split('.')[0];
        const fileLine = `[${timeStr}] [${level}] [${context}] ${message}\n`;

        try {
            fs.appendFileSync(Logger.currentLogPath, fileLine);
        } catch (e) { }

        let color = C.Reset;
        if (level === 'INFO') color = C.Green;
        if (level === 'WARN') color = C.Yellow;
        if (level === 'ERROR') color = C.Red;
        if (level === 'FILE') color = C.Magenta;
        if (level === 'THREAD') color = C.Blue;

        if (level !== 'FILE') {
            console.log(`${color}[${context}] ${message}${C.Reset}`);
        }
    },

    info: (context, msg) => Logger._write('INFO', context, msg),
    warn: (context, msg) => Logger._write('WARN', context, msg),
    error: (context, msg) => Logger._write('ERROR', context, msg),
    file: (context, msg) => Logger._write('FILE', context, msg),
    thread: (context, msg) => Logger._write('THREAD', context, msg),

    startSession: () => {
        const sep = "=".repeat(60);
        const qualityMode = CONFIG.dynamicQuality ? 'DYNAMIC' : 'FIXED';
        const header = `\n${sep}\n SESSION ID: ${path.basename(Logger.currentLogPath)}\n START TIME: ${new Date().toLocaleString()}\n CPU CORES: ${os.cpus().length}\n DOWNLOAD THREADS: ${CONFIG.maxDownloadConcurrency}\n FFMPEG THREADS: ${CONFIG.maxFfmpegConcurrency}\n QUALITY MODE: ${qualityMode}\n${sep}\n`;
        try { fs.appendFileSync(Logger.currentLogPath, header); } catch (e) { }
        console.clear();
        console.log(`${C.Cyan}${sep}`);
        console.log(`   KINTSUGI v67.0 (SMART QUALITY EDITION)`);
        console.log(`   Log File: ${path.basename(Logger.currentLogPath)}`);
        console.log(`   CPU Cores: ${os.cpus().length} | Download Threads: ${CONFIG.maxDownloadConcurrency}`);
        console.log(`   FFmpeg Threads: ${CONFIG.maxFfmpegConcurrency} | Quality: ${qualityMode}`);
        console.log(`${sep}\n${C.Reset}`);
    }
};

// --- THREAD POOL SYSTEM ---
class ThreadPool {
    constructor(maxConcurrency, name = 'Pool') {
        this.maxConcurrency = maxConcurrency;
        this.name = name;
        this.running = 0;
        this.queue = [];
        this.completed = 0;
        this.failed = 0;
        this.total = 0;
    }

    async add(task) {
        this.total++;
        return new Promise((resolve, reject) => {
            this.queue.push({ task, resolve, reject });
            this._tryRun();
        });
    }

    _tryRun() {
        while (this.running < this.maxConcurrency && this.queue.length > 0 && !isStopping) {
            const { task, resolve, reject } = this.queue.shift();
            this.running++;

            task()
                .then(result => {
                    this.completed++;
                    resolve(result);
                })
                .catch(err => {
                    this.failed++;
                    reject(err);
                })
                .finally(() => {
                    this.running--;
                    this._tryRun();
                });
        }
    }

    getStats() {
        return {
            running: this.running,
            queued: this.queue.length,
            completed: this.completed,
            failed: this.failed,
            total: this.total
        };
    }
}

// --- 1. HARMONY MANAGER (FILE I/O TRACKING & SAFETY) ---
function getDataDir() {
    return path.join(CONFIG.outputDir, CONFIG.dataDir);
}

function loadDatabase() {
    let db = {};
    const dataDir = getDataDir();
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    const dbPath = path.join(dataDir, CONFIG.dbFile);
    const bakPath = path.join(dataDir, CONFIG.dbFile + ".bak");

    // Helper to try parse
    const tryLoad = (p) => {
        try {
            const content = fs.readFileSync(p, 'utf8');
            if (!content.trim()) throw new Error("Empty file");
            return JSON.parse(content);
        } catch (e) {
            return null;
        }
    };

    if (fs.existsSync(dbPath)) {
        Logger.file("DB_LOAD", `Membaca database: ${CONFIG.dbFile}`);
        db = tryLoad(dbPath);

        if (!db) {
            Logger.error("DB_LOAD", `${C.Red}DATABASE UTAMA KORUP/KOSONG!${C.Reset}`);
            if (fs.existsSync(bakPath)) {
                Logger.warn("DB_LOAD", "Mencoba membaca backup...");
                db = tryLoad(bakPath);
                if (db) {
                    Logger.info("DB_LOAD", "Backup berhasil dimuat. Menyimpan ulang sebagai main DB.");
                    fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
                }
            }
        }
    } else {
        Logger.warn("DB_LOAD", "Database belum ada. Membuat baru.");
        return {}; // Safe to return empty only if file physically doesn't exist
    }

    if (!db) {
        // CRITICAL: Jika DB ada tapi korup, dan backup gagal -> STOP.
        // Jangan return {} karena runWhitelist akan menghapus semua file!
        Logger.error("FATAL", "GAGAL TYPE 1: Database korup dan tidak ada backup valid.");
        Logger.error("FATAL", "Script dihentikan demi keamanan file Anda.");
        process.exit(1);
    }

    Logger.file("DB_LOAD", `Berhasil memuat ${Object.keys(db).length} entri.`);
    return db;
}

function saveHarmony(db) {
    const dataDir = getDataDir();
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    const dbPath = path.join(dataDir, CONFIG.dbFile);
    const bakPath = path.join(dataDir, CONFIG.dbFile + ".bak");

    try {
        // 1. Create Atomic Backup from existing file (if valid)
        if (fs.existsSync(dbPath)) {
            try {
                const currentContent = fs.readFileSync(dbPath);
                // Only backup if current file is valid json
                JSON.parse(currentContent);
                fs.writeFileSync(bakPath, currentContent);
            } catch (e) {
                Logger.warn("DB_SAVE", "Main DB file corrupt on disk, skipping backup creation.");
            }
        }

        // 2. Write New
        // Logger.file("DB_SAVE", `Saving DB...`); // Reduce noise
        fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), 'utf8');

        // 3. Update Archive Text
        const validIDs = [];
        Object.values(db).forEach(item => {
            if (item.local_filename) {
                const fullPath = path.join(CONFIG.outputDir, item.local_filename);
                if (fs.existsSync(fullPath)) validIDs.push(`youtube ${item.id}`);
            }
        });
        fs.writeFileSync(path.join(dataDir, CONFIG.archiveFile), validIDs.join('\n'), 'utf8');
    } catch (e) {
        Logger.error("DB_SAVE", `FATAL: Gagal menyimpan database! ${e.message}`);
    }
}

// --- 2. SNAPSHOT ---
function getRemoteMetadata() {
    return new Promise((resolve) => {
        Logger.info("NET", "Menghubungi YouTube Playlist API...");
        const args = ["--flat-playlist", "--dump-json", "--no-clean-info", CONFIG.url];
        const child = spawn(path.resolve(__dirname, CONFIG.ytDlpExe), args, { shell: false });
        activeProcesses.add(child);

        let rawData = "";
        let count = 0;

        process.stdout.write(`${C.Magenta}>>> Snapshot... (0)${C.Reset}`);
        child.stdout.on('data', (chunk) => {
            rawData += chunk.toString();
            count += (chunk.toString().match(/\n/g) || []).length;
            process.stdout.write(`\r${C.Magenta}>>> Snapshot... (${count})${C.Reset}`);
        });

        child.on('close', (code) => {
            activeProcesses.delete(child);
            console.log("");
            if (code !== 0) { Logger.error("NET", "Gagal koneksi YouTube."); process.exit(1); }
            const entries = rawData.trim().split('\n').map(line => {
                try { return JSON.parse(line); } catch (e) { return null; }
            }).filter(e => e !== null);
            Logger.info("NET", `Snapshot selesai. ${entries.length} lagu ditemukan.`);
            resolve(entries);
        });
    });
}

// --- 3. CLEANUP ---
// --- 3. CLEANUP ---
function runNuclearClean() {
    Logger.info("CLEANUP", "Scanning residu file (.temp/.part)...");
    const files = fs.readdirSync(CONFIG.outputDir);
    let c = 0;
    files.forEach(f => {
        const fullPath = path.join(CONFIG.outputDir, f);
        // Strict cleanup: only delete known temporary extensions
        if (f.endsWith('.part') || f.endsWith('.ytdl') || f.endsWith('.temp') || (f.includes('.temp.') && !f.endsWith('.js'))) {
            try {
                fs.rmSync(fullPath, { force: true }); // Safer than unlinkSync
                c++;
                Logger.file("DELETE", `Menghapus residu: ${f}`);
            } catch (e) {
                Logger.error("DELETE", `Gagal hapus ${f}: ${e.message}`);
            }
        }
        // DEPRECATED: do not delete .webp here, handled by user preference or strict logic elsewhere
    });
    if (c > 0) Logger.warn("CLEANUP", `Dibersihkan ${c} file residu.`);
}

// --- 4. HARMONIZER ---
function runHarmonizer(remoteEntries, db) {
    Logger.info("SYNC", "Harmonizing Data...");
    const liveIDs = new Set();
    let stats = { new: 0, update: 0, dead: 0 };

    remoteEntries.forEach((entry, idx) => {
        liveIDs.add(entry.id);
        const targetIndex = idx + 1;
        const isDead = (entry.title === '[Deleted video]' || entry.title === '[Private video]');

        if (isDead) stats.dead++;

        if (db[entry.id]) {
            let realTitle = entry.title;
            if (isDead && db[entry.id].title && db[entry.id].title !== '[Deleted video]') {
                realTitle = db[entry.id].title;
                if (!realTitle.includes('[DEL]')) realTitle = `[DEL] ${realTitle}`;
            }

            let newStatus = db[entry.id].status;
            let oldStatus = newStatus;

            if (isDead) {
                if (newStatus === 'active' || newStatus === 'missing') newStatus = 'unavailable_pending';
            } else {
                // If video is back in playlist and was archived but file is deleted, reset to active
                if (newStatus === 'archived' || newStatus === 'unavailable_archived') {
                    const hasFile = db[entry.id].local_filename &&
                        fs.existsSync(path.join(CONFIG.outputDir, db[entry.id].local_filename));
                    if (!hasFile) {
                        // File was deleted, reset to active for re-download
                        newStatus = 'active';
                        Logger.info("REACTIVATE", `Archived video kembali ke playlist (file dihapus): ${entry.title}`);
                    }
                    // else: keep archived status since file still exists
                } else {
                    newStatus = 'active';
                }
            }

            if (oldStatus !== newStatus) {
                Logger.info("STATUS", `Change [${entry.id}]: ${oldStatus} -> ${newStatus}`);
            }

            // Preserve local fields that should NOT be overwritten by remote entry
            const preservedLocalFilename = db[entry.id].local_filename;
            const preservedDownloadStatus = db[entry.id].download_status;
            db[entry.id] = { ...db[entry.id], ...entry, title: realTitle, playlist_index: targetIndex, status: newStatus, local_filename: preservedLocalFilename, download_status: preservedDownloadStatus, last_synced: new Date().toISOString() };
            stats.update++;
        } else {
            db[entry.id] = { ...entry, playlist_index: targetIndex, local_filename: null, status: isDead ? 'unavailable_pending' : 'active', download_status: 'pending', last_synced: new Date().toISOString() };
            stats.new++;
            Logger.info("NEW", `Lagu Baru terdeteksi: ${entry.title}`);
        }
    });

    Object.keys(db).forEach(id => {
        if (!liveIDs.has(id)) {
            // Video no longer in playlist
            // archived and unavailable_archived: keep as is (user intentionally archived)
            // active, missing, unavailable_pending: become orphaned
            if (db[id].status === 'active' || db[id].status === 'missing' || db[id].status === 'unavailable_pending') {
                const oldStatus = db[id].status;
                db[id].status = 'orphaned';
                Logger.warn("ORPHAN", `[${oldStatus}] Lagu hilang dari playlist: ${db[id].title}`);
            }
            db[id].playlist_index = null;
        }
    });

    return { liveIDs };
}

// --- 5. AUDIT ---
async function runDoubleAudit(db) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise(r => rl.question(q, r));

    const orphans = Object.values(db).filter(i => i.status === 'orphaned');
    if (orphans.length > 0) {
        Logger.warn("AUDIT", `${orphans.length} lagu dihapus dari Playlist.`);
        console.log(` [1] HAPUS TOTAL.`);
        console.log(` [2] KEEP (Arsipkan).`);
        const ans = await ask(`${C.Yellow}Pilihan: ${C.Reset}`);

        orphans.forEach(item => {
            if (ans === '1') {
                if (item.local_filename) {
                    try {
                        fs.unlinkSync(path.join(CONFIG.outputDir, item.local_filename));
                        Logger.file("DELETE", `Menghapus file fisik: ${item.local_filename}`);
                    } catch (e) { }
                }
                delete db[item.id];
                Logger.info("AUDIT", `[DEL] ${item.title}`);
            } else {
                db[item.id].status = 'archived';
                Logger.info("AUDIT", `[KEEP] ${item.title}`);
            }
        });
    }

    const unavail = Object.values(db).filter(i => i.status === 'unavailable_pending');
    if (unavail.length > 0) {
        Logger.warn("AUDIT", `${unavail.length} Video Mati/Deleted.`);
        console.log(` [1] HAPUS TOTAL.`);
        console.log(` [2] KEEP (Arsipkan).`);
        const ans = await ask(`${C.Yellow}Pilihan: ${C.Reset}`);
        unavail.forEach(item => {
            if (ans === '1') {
                if (item.local_filename) {
                    try {
                        fs.unlinkSync(path.join(CONFIG.outputDir, item.local_filename));
                        Logger.file("DELETE", `Menghapus file fisik: ${item.local_filename}`);
                    } catch (e) { }
                }
                delete db[item.id];
                Logger.info("AUDIT", `[DEL] ${item.title}`);
            } else {
                db[item.id].status = 'unavailable_archived';
                Logger.info("AUDIT", `[KEEP] ${item.title}`);
            }
        });
    }
    rl.close();
    saveHarmony(db);
}

// --- 6. RE-INDEXING ---
function runReindexing(db) {
    Logger.info("INDEX", "Memeriksa nama file...");

    // Sanitize filename: remove Windows illegal chars  < > : " / \ | ? *
    const sanitizeFilename = (str) => {
        if (!str) return '';
        return str.replace(/[<>:"/\\|?*]/g, '').trim();
    };

    const doRename = (item, targetName) => {
        const oldName = item.local_filename;
        if (oldName && fs.existsSync(path.join(CONFIG.outputDir, oldName))) {
            if (oldName !== targetName) {
                // Check if target exists AND is NOT the same file (case-insensitive on Windows)
                const isSameFile = oldName.toLowerCase() === targetName.toLowerCase();

                if (fs.existsSync(path.join(CONFIG.outputDir, targetName)) && !isSameFile) {
                    // Only delete if it's a DIFFERENT file (not just case change)
                    try {
                        fs.unlinkSync(path.join(CONFIG.outputDir, targetName));
                        Logger.file("DELETE", `Menghapus konflik nama: ${targetName}`);
                    } catch (e) { }
                }

                try {
                    fs.renameSync(path.join(CONFIG.outputDir, oldName), path.join(CONFIG.outputDir, targetName));
                    db[item.id].local_filename = targetName;
                    Logger.file("RENAME", `${oldName} -> ${targetName}`);
                } catch (e) {
                    Logger.error("RENAME", `Gagal rename: ${e.message}`);
                }
            }
        }
    };

    Object.values(db).filter(i => i.status === 'active' && i.local_filename).forEach(item => {
        const prefix = String(item.playlist_index).padStart(3, '0');
        const cleanUploader = sanitizeFilename(item.uploader);
        const cleanTitle = sanitizeFilename(item.title);
        const target = `${prefix} ${cleanTitle} - ${cleanUploader}.opus`;
        doRename(item, target);
    });

    const archivedItems = Object.values(db).filter(i => (i.status === 'archived' || i.status === 'unavailable_archived') && i.local_filename);
    if (archivedItems.length > 0) {
        const archivedCount = archivedItems.filter(i => i.status === 'archived').length;
        const unavailableCount = archivedItems.filter(i => i.status === 'unavailable_archived').length;
        Logger.info("INDEX", `Archived files: ${archivedCount} archived, ${unavailableCount} unavailable_archived`);
    }

    archivedItems.forEach(item => {
        const cleanUploader = sanitizeFilename(item.uploader);
        const cleanTitle = sanitizeFilename(item.title);
        let tag = item.status === 'unavailable_archived' ? "[ARCHIVED] [DEL]" : "[ARCHIVED]";
        const target = `${tag} ${cleanTitle} - ${cleanUploader}.opus`;
        doRename(item, target);
    });

    saveHarmony(db);
}

// --- 7. SAFETY WHITELIST ---
function runWhitelist(db) {
    Logger.info("SECURITY", "Running Safety Whitelist Check...");

    // 1. Collect Valid Files from DB
    const validFiles = new Set();
    Object.values(db).forEach(i => { if (i.local_filename) validFiles.add(i.local_filename.toLowerCase()); });

    // 2. System Whitelist (Always Safe)
    const systemWhitelist = [
        CONFIG.dataDir.toLowerCase(),
        CONFIG.ytDlpExe.toLowerCase(),
        CONFIG.ffmpegExe.toLowerCase(),
        CONFIG.ffprobeExe.toLowerCase(),
        path.basename(__filename).toLowerCase(), // This script
        'package.json', 'package-lock.json',
        'node_modules', '.git', '.gitignore', '.env'
    ];

    const files = fs.readdirSync(CONFIG.outputDir);
    files.forEach(f => {
        const fullPath = path.join(CONFIG.outputDir, f);
        const lowerName = f.toLowerCase();

        // Skip directories and system files
        if (fs.lstatSync(fullPath).isDirectory()) return;
        if (systemWhitelist.some(sys => lowerName === sys || lowerName.endsWith('.js') || lowerName.endsWith('.json') || lowerName.endsWith('.log') || lowerName.endsWith('.bat'))) return;

        // Strict Logic: Only delete if it LOOKS like a Kintsugi file [001 Artist - Title] (starts with 3 digits) AND is not in DB
        // OR if it is a media file format we manage (.opus, .webm, .m4a)
        const isMediaFile = ['.opus', '.webm', '.m4a', '.mp3', '.flac', '.wav'].some(ext => lowerName.endsWith(ext));
        const looksLikeKintsugi = /^\d{3}\s/.test(f); // Starts with "001 "

        // IF it's in our Valid List, it's safe.
        if (validFiles.has(lowerName)) return;

        // IF it is NOT valid, AND looks like our file, THEN it is an orphan/garbage.
        if (isMediaFile || looksLikeKintsugi) {
            try {
                // QUARANTINE / SAFETY DELETE
                // For now, we delete, but because of loadDatabase check, we know DB is valid.
                fs.unlinkSync(fullPath);
                Logger.warn("SECURITY", `Menghapus file tidak dikenal (Orphan): ${f}`);
            } catch (e) {
                Logger.error("DELETE", `Gagal hapus ${f}: ${e.message}`);
            }
        } else {
            // Unknown file that doesn't look like ours (e.g. "my_notes.txt") -> IGNORE IT
            // Logger.file("IGNORE", `Ignoring alien file: ${f}`);
        }
    });
}

// --- 8. MULTI-THREADED FFMPEG CONVERTER WITH DYNAMIC QUALITY ---
async function convertSourceToOpus(sourceFile, outputFile, bitrate, workerId) {
    return new Promise((resolve, reject) => {
        const args = [
            '-i', sourceFile,
            '-vn',                              // No video
            '-c:a', 'libopus',                 // Opus codec
            '-b:a', bitrate,                   // Dynamic bitrate
            '-vbr', 'on',                      // Variable bitrate (like YouTube)
            '-compression_level', '10',        // Max compression (best quality)
            '-application', 'audio',           // Optimize for music
            '-threads', String(CONFIG.ffmpegThreadsPerJob),
            '-y',                               // Overwrite output
            outputFile
        ];

        const ffmpegPath = CONFIG.ffmpegExe.includes(path.sep)
            ? CONFIG.ffmpegExe
            : path.resolve(__dirname, CONFIG.ffmpegExe);

        const child = spawn(ffmpegPath, args, { shell: false });
        activeProcesses.add(child);

        let stderr = '';
        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('close', (code) => {
            activeProcesses.delete(child);
            if (code === 0) {
                resolve({ success: true, output: outputFile, bitrate });
            } else {
                reject(new Error(`FFmpeg exit code ${code}: ${stderr.slice(-200)}`));
            }
        });

        child.on('error', (err) => {
            activeProcesses.delete(child);
            reject(err);
        });
    });
}

async function runFfmpegConversionQueue(sourceDir) {
    const targetDir = sourceDir || CONFIG.outputDir;

    if (!fs.existsSync(targetDir)) {
        Logger.error("FFMPEG", `Source directory tidak ditemukan: ${targetDir}`);
        return { converted: 0, failed: 0 };
    }

    // Scan for convertible files
    const files = fs.readdirSync(targetDir);
    const sourceFiles = files.filter(f => {
        const ext = path.extname(f).toLowerCase();
        return CONFIG.supportedSourceFormats.includes(ext) && !f.endsWith('.opus');
    });

    if (sourceFiles.length === 0) {
        Logger.info("FFMPEG", "Tidak ada file source untuk dikonversi.");
        return { converted: 0, failed: 0 };
    }

    Logger.info("FFMPEG", `Ditemukan ${sourceFiles.length} file untuk dikonversi ke Opus.`);
    if (CONFIG.dynamicQuality) {
        Logger.info("FFMPEG", `Mode: DYNAMIC QUALITY (berdasarkan analisis source)`);
    } else {
        Logger.info("FFMPEG", `Mode: FIXED QUALITY (${CONFIG.fallbackBitrate})`);
    }
    Logger.thread("FFMPEG", `Memulai ${CONFIG.maxFfmpegConcurrency} worker threads...`);

    const pool = new ThreadPool(CONFIG.maxFfmpegConcurrency, 'FFmpeg');
    const results = { converted: 0, failed: 0, qualityStats: {} };
    const promises = [];

    sourceFiles.forEach((file, index) => {
        const sourcePath = path.join(targetDir, file);
        const baseName = path.basename(file, path.extname(file));
        const outputPath = path.join(targetDir, `${baseName}.opus`);

        // Skip if output already exists
        if (fs.existsSync(outputPath)) {
            Logger.file("FFMPEG", `Skip (exists): ${baseName}.opus`);
            return;
        }

        const promise = pool.add(async () => {
            const workerId = (index % CONFIG.maxFfmpegConcurrency) + 1;
            const displayName = baseName.length > 30 ? baseName.substring(0, 27) + '...' : baseName;

            // Determine optimal bitrate for this file
            let bitrate = CONFIG.fallbackBitrate;
            let qualityInfo = '';

            if (CONFIG.dynamicQuality) {
                const audioInfo = await probeAudioInfo(sourcePath);
                if (audioInfo) {
                    bitrate = getOptimalOpusBitrate(audioInfo);
                    qualityInfo = ` [${audioInfo.codec}@${audioInfo.bitrate}k → ${bitrate}]`;

                    // Track quality stats
                    results.qualityStats[bitrate] = (results.qualityStats[bitrate] || 0) + 1;
                }
            }

            Logger.thread(`W${workerId}`, `Converting: ${displayName}${qualityInfo}`);

            try {
                await convertSourceToOpus(sourcePath, outputPath, bitrate, workerId);

                Logger.info(`W${workerId}`, `✓ ${displayName}.opus @ ${bitrate}`);
                results.converted++;

                // Delete source if configured
                if (CONFIG.deleteSourceAfterConvert && fs.existsSync(outputPath)) {
                    try {
                        fs.unlinkSync(sourcePath);
                        Logger.file("DELETE", `Source deleted: ${file}`);
                    } catch (e) {
                        Logger.warn("DELETE", `Gagal hapus source: ${file}`);
                    }
                }

                return { success: true, file, bitrate };
            } catch (err) {
                Logger.error(`W${workerId}`, `✗ ${displayName}: ${err.message}`);
                results.failed++;
                return { success: false, file, error: err.message };
            }
        });

        promises.push(promise);
    });

    await Promise.allSettled(promises);

    // Log quality distribution
    if (Object.keys(results.qualityStats).length > 0) {
        const statsStr = Object.entries(results.qualityStats)
            .map(([br, count]) => `${br}:${count}`)
            .join(', ');
        Logger.info("FFMPEG", `Quality distribution: ${statsStr}`);
    }

    Logger.info("FFMPEG", `Konversi selesai: ${results.converted} sukses, ${results.failed} gagal.`);
    return results;
}

// --- 9. MULTI-THREADED YT-DLP DOWNLOADER ---
async function downloadSingleVideo(item, db, workerId) {
    const idx = String(item.playlist_index).padStart(3, '0');
    const fileNameTemplate = `${idx} %(artist)s - %(title)s.%(ext)s`;
    const displayTitle = item.title.length > 25 ? item.title.substring(0, 22) + '...' : item.title;

    Logger.thread(`W${workerId}`, `Starting: ${displayTitle}`);

    for (let strategy of DOWNLOAD_STRATEGIES) {
        if (isStopping) break;

        // Based on yt-dlp docs & YouTube Opus research:
        // YouTube serves Opus at ~128-160kbps (format 251) natively
        // Using -f ba[acodec=opus] downloads native Opus WITHOUT re-encoding
        // This preserves YouTube's original quality (no transcoding loss)
        // Fallback: ba (best audio) → convert to opus if not available
        const args = [
            "--no-color", "-P", CONFIG.outputDir,
            // Prefer native Opus from YouTube (format 251), fallback to best audio
            "-f", "ba[acodec=opus]/ba",
            // Only convert to opus if source is not opus already
            "-x", "--audio-format", "opus", "--audio-quality", "0",
            "--embed-thumbnail", "--embed-metadata",
            "--no-restrict-filenames", "--trim-filenames", "160",
            "-o", fileNameTemplate,
            "--no-overwrites", "--continue", "--no-cache-dir",
            "--progress", "--newline",
            // Sort by audio bitrate (abr) and sample rate (asr) for best quality
            "-S", "abr,asr",
            `https://www.youtube.com/watch?v=${item.id}`,
            ...strategy.args
        ];

        try {
            const result = await new Promise((resolve) => {
                const child = spawn(path.resolve(__dirname, CONFIG.ytDlpExe), args, { shell: false });
                activeProcesses.add(child);

                let fullOutput = "";
                child.stdout.on('data', (data) => {
                    fullOutput += data.toString();
                });
                child.stderr.on('data', (data) => {
                    fullOutput += data.toString();
                });

                child.on('close', (code) => {
                    activeProcesses.delete(child);

                    if (code === 0) {
                        const mergeMatch = fullOutput.match(/Merging formats into "(.*?)"/);
                        const destMatch = fullOutput.match(/Destination: (.+?)\r?\n/);
                        const alreadyMatch = fullOutput.match(/\[download\] (.+?) has already been downloaded/);

                        let detectedFile = null;
                        if (mergeMatch) detectedFile = mergeMatch[1];
                        else if (destMatch) detectedFile = destMatch[1];
                        else if (alreadyMatch) detectedFile = alreadyMatch[1];

                        if (detectedFile && fs.existsSync(detectedFile)) {
                            resolve({ success: true, filename: path.basename(detectedFile), strategy: strategy.name });
                        } else {
                            // Fallback
                            const files = fs.readdirSync(CONFIG.outputDir);
                            const found = files.find(f => f.startsWith(idx + " "));
                            if (found) {
                                resolve({ success: true, filename: found, strategy: 'Fallback' });
                            } else {
                                resolve({ success: false, retry: true });
                            }
                        }
                    } else {
                        if (fullOutput.includes("Video unavailable") || fullOutput.includes("Private video")) {
                            resolve({ success: false, unavailable: true });
                        } else {
                            resolve({ success: false, retry: true, code });
                        }
                    }
                });

                child.on('error', (err) => {
                    activeProcesses.delete(child);
                    resolve({ success: false, retry: true, error: err.message });
                });
            });

            if (result.success) {
                db[item.id].local_filename = result.filename;
                db[item.id].download_status = 'completed';
                Logger.info(`W${workerId}`, `✓ ${displayTitle} (${result.strategy})`);
                return { success: true };
            } else if (result.unavailable) {
                db[item.id].status = 'unavailable_pending';
                Logger.error(`W${workerId}`, `✗ ${displayTitle} (Unavailable)`);
                return { success: false, unavailable: true };
            }
            // If retry, continue to next strategy
        } catch (e) {
            Logger.error(`W${workerId}`, `Exception: ${e.message}`);
        }
    }

    // All strategies failed
    Logger.error(`W${workerId}`, `✗ ${displayTitle} (All strategies failed)`);
    return { success: false };
}

async function startMultiThreadDownloadQueue(db) {
    const queue = [];
    Object.values(db).forEach(item => {
        if (item.status === 'active') {
            const hasFile = item.local_filename && fs.existsSync(path.join(CONFIG.outputDir, item.local_filename));
            if (!hasFile) queue.push(item);
        }
    });

    if (queue.length === 0) {
        Logger.info("DOWN", "Tidak ada antrean download baru.");
        return { downloaded: 0, failed: 0 };
    }

    queue.sort((a, b) => a.playlist_index - b.playlist_index);
    Logger.info("DOWN", `Memulai download ${queue.length} file dengan ${CONFIG.maxDownloadConcurrency} threads...`);

    const pool = new ThreadPool(CONFIG.maxDownloadConcurrency, 'Download');
    const results = { downloaded: 0, failed: 0 };
    const promises = [];
    let saveCounter = 0;

    queue.forEach((item, index) => {
        const promise = pool.add(async () => {
            const workerId = (index % CONFIG.maxDownloadConcurrency) + 1;

            const result = await downloadSingleVideo(item, db, workerId);

            if (result.success) {
                results.downloaded++;
            } else {
                results.failed++;
            }

            // Periodic save (every 5 downloads)
            saveCounter++;
            if (saveCounter % 5 === 0) {
                saveHarmony(db);
            }

            return result;
        });

        promises.push(promise);
    });

    await Promise.allSettled(promises);
    saveHarmony(db);

    Logger.info("DOWN", `Download selesai: ${results.downloaded} sukses, ${results.failed} gagal.`);
    return results;
}

// --- 10. INTERACTIVE MENU ---
async function showInteractiveMenu() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise(r => rl.question(q, r));

    const qualityStr = CONFIG.dynamicQuality ? 'DYNAMIC' : 'FIXED';

    console.log(`\n${C.Cyan}╔════════════════════════════════════════════════════╗`);
    console.log(`║     KINTSUGI v67.0 - SMART QUALITY EDITION         ║`);
    console.log(`╠════════════════════════════════════════════════════╣`);
    console.log(`║ [1] Sync Playlist & Download (Normal Mode)         ║`);
    console.log(`║ [2] Convert Source Files to Opus (FFmpeg)          ║`);
    console.log(`║ [3] Full Sync + Convert (All-in-One)               ║`);
    console.log(`║ [4] Settings                                       ║`);
    console.log(`║ [0] Exit                                           ║`);
    console.log(`╠════════════════════════════════════════════════════╣`);
    console.log(`║ Quality Mode: ${qualityStr.padEnd(38)}║`);
    console.log(`╚════════════════════════════════════════════════════╝${C.Reset}`);

    const choice = await ask(`${C.Yellow}Pilihan: ${C.Reset}`);
    rl.close();

    return choice.trim();
}

async function showSettingsMenu() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise(r => rl.question(q, r));

    const tiers = CONFIG.qualityTiers;

    Logger.info("MENU", "Settings menu opened");

    console.log(`\n${C.Cyan}╔════════════════════════════════════════════════════╗`);
    console.log(`║                    SETTINGS                        ║`);
    console.log(`╚════════════════════════════════════════════════════╝${C.Reset}`);

    console.log(`\n${C.Yellow}── Thread Configuration ──${C.Reset}`);
    console.log(`   Download Threads: ${CONFIG.maxDownloadConcurrency}`);
    console.log(`   FFmpeg Threads:   ${CONFIG.maxFfmpegConcurrency}`);

    console.log(`\n${C.Yellow}── Quality Configuration ──${C.Reset}`);
    console.log(`   Dynamic Quality:  ${CONFIG.dynamicQuality ? 'ON (Auto-detect from source)' : 'OFF (Fixed bitrate)'}`);
    console.log(`   Fallback Bitrate: ${CONFIG.fallbackBitrate}`);

    if (CONFIG.dynamicQuality) {
        console.log(`\n${C.Gray}   Quality Tiers (based on YouTube Opus):${C.Reset}`);
        console.log(`${C.Gray}   ├─ Lossless (FLAC/WAV):   → ${tiers.lossless}`);
        console.log(`   ├─ High (≥256kbps):       → ${tiers.high}`);
        console.log(`   ├─ Standard (≥128kbps):   → ${tiers.standard}  ← YouTube default`);
        console.log(`   ├─ Low (≥96kbps):         → ${tiers.low}`);
        console.log(`   └─ Minimum (<96kbps):     → ${tiers.minimum}${C.Reset}`);
    }

    console.log(`\n${C.Yellow}── File Management ──${C.Reset}`);
    console.log(`   Delete source after convert: ${CONFIG.deleteSourceAfterConvert ? 'YES' : 'NO'}`);

    console.log(`\n${C.Cyan}── Options ──${C.Reset}`);
    console.log(`[1] Change Download Threads`);
    console.log(`[2] Change FFmpeg Threads`);
    console.log(`[3] Toggle Dynamic Quality`);
    console.log(`[4] Change Fallback Bitrate`);
    console.log(`[5] Toggle Delete Source After Convert`);
    console.log(`[0] Back`);

    const choice = await ask(`\n${C.Yellow}Pilihan: ${C.Reset}`);

    switch (choice.trim()) {
        case '1':
            const oldDT = CONFIG.maxDownloadConcurrency;
            const dt = await ask('Download threads (1-10): ');
            CONFIG.maxDownloadConcurrency = Math.max(1, Math.min(10, parseInt(dt) || 3));
            Logger.info("SETTINGS", `Download Threads: ${oldDT} → ${CONFIG.maxDownloadConcurrency}`);
            console.log(`${C.Green}✓ Download threads set to ${CONFIG.maxDownloadConcurrency}${C.Reset}`);
            break;
        case '2':
            const oldFT = CONFIG.maxFfmpegConcurrency;
            const ft = await ask('FFmpeg threads (1-16): ');
            CONFIG.maxFfmpegConcurrency = Math.max(1, Math.min(16, parseInt(ft) || 4));
            Logger.info("SETTINGS", `FFmpeg Threads: ${oldFT} → ${CONFIG.maxFfmpegConcurrency}`);
            console.log(`${C.Green}✓ FFmpeg threads set to ${CONFIG.maxFfmpegConcurrency}${C.Reset}`);
            break;
        case '3':
            const oldDQ = CONFIG.dynamicQuality;
            CONFIG.dynamicQuality = !CONFIG.dynamicQuality;
            Logger.info("SETTINGS", `Dynamic Quality: ${oldDQ ? 'ON' : 'OFF'} → ${CONFIG.dynamicQuality ? 'ON' : 'OFF'}`);
            console.log(`${C.Green}✓ Dynamic Quality: ${CONFIG.dynamicQuality ? 'ON' : 'OFF'}${C.Reset}`);
            break;
        case '4':
            const oldBR = CONFIG.fallbackBitrate;
            console.log(`Current: ${CONFIG.fallbackBitrate}`);
            console.log(`Options: 64k, 96k, 128k, 160k, 192k, 256k`);
            const br = await ask('Fallback bitrate: ');
            if (br.match(/^\d+k$/)) {
                CONFIG.fallbackBitrate = br;
                Logger.info("SETTINGS", `Fallback Bitrate: ${oldBR} → ${CONFIG.fallbackBitrate}`);
                console.log(`${C.Green}✓ Fallback bitrate set to ${CONFIG.fallbackBitrate}${C.Reset}`);
            }
            break;
        case '5':
            const oldDS = CONFIG.deleteSourceAfterConvert;
            CONFIG.deleteSourceAfterConvert = !CONFIG.deleteSourceAfterConvert;
            Logger.info("SETTINGS", `Delete Source: ${oldDS ? 'ON' : 'OFF'} → ${CONFIG.deleteSourceAfterConvert ? 'ON' : 'OFF'}`);
            console.log(`${C.Green}✓ Delete source: ${CONFIG.deleteSourceAfterConvert ? 'ON' : 'OFF'}${C.Reset}`);
            break;
        case '0':
            Logger.info("MENU", "Settings menu closed (no changes)");
            break;
        default:
            Logger.warn("MENU", `Invalid settings option: ${choice}`);
    }

    rl.close();
}

async function promptSourceDirectory() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise(r => rl.question(q, r));

    console.log(`\n${C.Cyan}=== FFmpeg Source Conversion ===${C.Reset}`);
    console.log(`Supported formats: ${CONFIG.supportedSourceFormats.join(', ')}`);
    console.log(`\nEnter source directory path (or press Enter for default):`);
    console.log(`Default: ${CONFIG.outputDir}`);

    const input = await ask(`${C.Yellow}Path: ${C.Reset}`);
    rl.close();

    return input.trim() || CONFIG.outputDir;
}

// --- ARCHIVED FILES MANAGEMENT ---
async function manageArchivedFiles(db) {
    const archivedItems = Object.values(db).filter(i =>
        (i.status === 'archived' || i.status === 'unavailable_archived') && i.local_filename
    );

    if (archivedItems.length === 0) {
        return; // No archived files
    }

    Logger.info("ARCHIVE", `Ditemukan ${archivedItems.length} file archived.`);

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise(r => rl.question(q, r));

    console.log(`\n${C.Yellow}╔════════════════════════════════════════════════════╗`);
    console.log(`║           ARCHIVED FILES MANAGEMENT                ║`);
    console.log(`╚════════════════════════════════════════════════════╝${C.Reset}`);

    console.log(`\n${C.Gray}Ditemukan ${archivedItems.length} file archived:${C.Reset}`);

    // Group by status
    const archived = archivedItems.filter(i => i.status === 'archived');
    const unavailableArchived = archivedItems.filter(i => i.status === 'unavailable_archived');

    if (archived.length > 0) {
        console.log(`\n${C.Cyan}[ARCHIVED] - User archived (${archived.length} files):${C.Reset}`);
        archived.slice(0, 10).forEach(item => {
            console.log(`   ${C.Gray}• ${item.title}${C.Reset}`);
        });
        if (archived.length > 10) console.log(`   ${C.Gray}... dan ${archived.length - 10} lainnya${C.Reset}`);
    }

    if (unavailableArchived.length > 0) {
        console.log(`\n${C.Red}[UNAVAILABLE_ARCHIVED] - Video deleted/private (${unavailableArchived.length} files):${C.Reset}`);
        unavailableArchived.slice(0, 10).forEach(item => {
            console.log(`   ${C.Gray}• ${item.title}${C.Reset}`);
        });
        if (unavailableArchived.length > 10) console.log(`   ${C.Gray}... dan ${unavailableArchived.length - 10} lainnya${C.Reset}`);
    }

    console.log(`\n${C.Yellow}Pilihan:${C.Reset}`);
    console.log(`[1] Keep semua archived files`);
    console.log(`[2] Delete SEMUA archived files`);
    console.log(`[3] Delete hanya unavailable_archived (video deleted/private)`);
    if (unavailableArchived.length > 0) {
        console.log(`[4] Recheck unavailable_archived (cek apakah video sudah public lagi)`);
    }
    console.log(`[0] Skip (lanjut tanpa perubahan)`);

    const choice = await ask(`\n${C.Yellow}Pilihan: ${C.Reset}`);

    let deletedCount = 0;

    switch (choice.trim()) {
        case '1':
            Logger.info("ARCHIVE", "User memilih keep semua archived files.");
            console.log(`${C.Green}✓ Semua file archived tetap disimpan.${C.Reset}`);
            break;

        case '2':
            Logger.info("ARCHIVE", "User memilih delete SEMUA archived files.");
            archivedItems.forEach(item => {
                const filePath = path.join(CONFIG.outputDir, item.local_filename);
                if (fs.existsSync(filePath)) {
                    try {
                        fs.unlinkSync(filePath);
                        Logger.file("ARCHIVE_DELETE", `Deleted: ${item.local_filename}`);
                        deletedCount++;
                    } catch (e) {
                        Logger.error("ARCHIVE_DELETE", `Gagal hapus: ${item.local_filename}`);
                    }
                }
                db[item.id].local_filename = null;
            });
            saveHarmony(db);
            console.log(`${C.Green}✓ ${deletedCount} file archived dihapus.${C.Reset}`);
            Logger.info("ARCHIVE", `${deletedCount} archived files telah dihapus.`);
            break;

        case '3':
            Logger.info("ARCHIVE", "User memilih delete hanya unavailable_archived.");
            unavailableArchived.forEach(item => {
                const filePath = path.join(CONFIG.outputDir, item.local_filename);
                if (fs.existsSync(filePath)) {
                    try {
                        fs.unlinkSync(filePath);
                        Logger.file("ARCHIVE_DELETE", `Deleted unavailable: ${item.local_filename}`);
                        deletedCount++;
                    } catch (e) {
                        Logger.error("ARCHIVE_DELETE", `Gagal hapus: ${item.local_filename}`);
                    }
                }
                db[item.id].local_filename = null;
            });
            saveHarmony(db);
            console.log(`${C.Green}✓ ${deletedCount} unavailable_archived files dihapus.${C.Reset}`);
            Logger.info("ARCHIVE", `${deletedCount} unavailable_archived files telah dihapus.`);
            break;

        case '4':
            if (unavailableArchived.length === 0) {
                console.log(`${C.Gray}Tidak ada unavailable_archived untuk dicek.${C.Reset}`);
                break;
            }

            Logger.info("ARCHIVE", `Rechecking ${unavailableArchived.length} unavailable_archived videos...`);
            console.log(`\n${C.Cyan}Mengecek ${unavailableArchived.length} video...${C.Reset}`);

            let reactivatedCount = 0;
            let stillUnavailableCount = 0;

            for (const item of unavailableArchived) {
                const displayTitle = item.title.length > 40 ? item.title.substring(0, 37) + '...' : item.title;
                process.stdout.write(`   Checking: ${displayTitle}... `);

                try {
                    // Use yt-dlp to check if video is available
                    const result = await new Promise((resolve) => {
                        const child = spawn(path.resolve(__dirname, CONFIG.ytDlpExe), [
                            '--skip-download',
                            '--no-warnings',
                            '--print', 'title',
                            `https://www.youtube.com/watch?v=${item.id}`
                        ], { shell: false, timeout: 15000 });

                        let output = '';
                        child.stdout.on('data', (data) => { output += data.toString(); });
                        child.on('close', (code) => {
                            resolve({ success: code === 0, title: output.trim() });
                        });
                        child.on('error', () => resolve({ success: false }));

                        // Timeout after 10 seconds
                        setTimeout(() => {
                            child.kill();
                            resolve({ success: false, timeout: true });
                        }, 10000);
                    });

                    if (result.success && result.title && result.title !== '[Deleted video]' && result.title !== '[Private video]') {
                        // Video is available again!
                        db[item.id].status = 'active';
                        db[item.id].title = result.title.replace('[DEL] ', ''); // Remove [DEL] tag
                        console.log(`${C.Green}✓ TERSEDIA! (akan di-download ulang)${C.Reset}`);
                        Logger.info("REACTIVATE", `Video kembali tersedia: ${result.title}`);
                        reactivatedCount++;
                    } else {
                        console.log(`${C.Red}✗ masih unavailable${C.Reset}`);
                        stillUnavailableCount++;
                    }
                } catch (e) {
                    console.log(`${C.Red}✗ error${C.Reset}`);
                    stillUnavailableCount++;
                }
            }

            if (reactivatedCount > 0) {
                saveHarmony(db);
                // Trigger download for reactivated videos
                console.log(`\n${C.Cyan}--- Memulai download video yang kembali tersedia ---${C.Reset}`);
                Logger.info("DOWN", "Starting download for reactivated videos...");
                await startMultiThreadDownloadQueue(db);
            }

            console.log(`\n${C.Cyan}Hasil recheck:${C.Reset}`);
            console.log(`   ${C.Green}✓ ${reactivatedCount} video kembali tersedia${C.Reset}`);
            console.log(`   ${C.Red}✗ ${stillUnavailableCount} video masih unavailable${C.Reset}`);
            Logger.info("ARCHIVE", `Recheck selesai: ${reactivatedCount} reactivated, ${stillUnavailableCount} still unavailable`);
            break;

        case '0':
        default:
            Logger.info("ARCHIVE", "User skip archived files management.");
            console.log(`${C.Gray}Skipped. Tidak ada perubahan.${C.Reset}`);
    }

    rl.close();
}

// --- MAIN INIT ---
(async () => {
    Logger.init();

    if (!fs.existsSync(CONFIG.outputDir)) fs.mkdirSync(CONFIG.outputDir, { recursive: true });

    // Main menu loop - keeps running until user picks an action or exits
    let running = true;
    while (running) {
        const choice = await showInteractiveMenu();

        switch (choice) {
            case '1':
                // Normal sync & download
                Logger.info("MENU", "Selected: [1] Sync Playlist & Download");
                running = false; // Exit menu loop, proceed with operation
                runNuclearClean();
                const db1 = loadDatabase();
                const remoteEntries = await getRemoteMetadata();
                runHarmonizer(remoteEntries, db1);
                await runDoubleAudit(db1);
                runReindexing(db1);
                runWhitelist(db1);
                await startMultiThreadDownloadQueue(db1);
                // Check for archived files after completion
                await manageArchivedFiles(db1);
                break;

            case '2':
                // FFmpeg conversion only
                Logger.info("MENU", "Selected: [2] FFmpeg Conversion Only");
                const sourceDir = await promptSourceDirectory();
                Logger.info("FFMPEG", `Source directory: ${sourceDir}`);
                const result2 = await runFfmpegConversionQueue(sourceDir);
                // If no files were converted, return to menu
                if (result2.converted === 0 && result2.failed === 0) {
                    Logger.info("MENU", "No files to convert. Returning to menu...");
                    console.log(`${C.Yellow}Tidak ada file untuk dikonversi. Kembali ke menu...${C.Reset}`);
                    await new Promise(r => setTimeout(r, 1500));
                    // Stay in loop - don't set running = false
                } else {
                    running = false; // Exit after successful conversion
                }
                break;

            case '3':
                // Full sync + convert
                Logger.info("MENU", "Selected: [3] Full Sync + Convert");
                running = false;
                runNuclearClean();
                const db3 = loadDatabase();
                const remote3 = await getRemoteMetadata();
                runHarmonizer(remote3, db3);
                await runDoubleAudit(db3);
                runReindexing(db3);
                runWhitelist(db3);
                await startMultiThreadDownloadQueue(db3);
                // After downloads, check for any source files to convert
                Logger.info("FFMPEG", "Starting FFmpeg Conversion Phase...");
                console.log(`\n${C.Cyan}--- Starting FFmpeg Conversion Phase ---${C.Reset}`);
                await runFfmpegConversionQueue(CONFIG.outputDir);
                // Check for archived files after completion
                await manageArchivedFiles(db3);
                break;

            case '4':
                // Settings - stay in loop, show updated settings
                Logger.info("MENU", "Selected: [4] Settings");
                await showSettingsMenu();
                console.log(`\n${C.Green}Settings updated! Returning to menu...${C.Reset}`);
                // Show current config after update
                console.log(`${C.Gray}Current: DL=${CONFIG.maxDownloadConcurrency} | FFmpeg=${CONFIG.maxFfmpegConcurrency} | Quality=${CONFIG.dynamicQuality ? 'DYNAMIC' : 'FIXED'}${C.Reset}`);
                Logger.info("MENU", "Returning to main menu");
                await new Promise(r => setTimeout(r, 1500)); // Brief pause to show changes
                // Loop continues - will show menu again
                break;

            case '0':
                Logger.info("MENU", "Selected: [0] Exit");
                Logger.info("SYSTEM", "Exit requested by user.");
                running = false;
                process.exit(0);
                break;

            default:
                Logger.warn("MENU", `Invalid menu option: "${choice}"`);
            // Loop continues - will show menu again
        }
    }

    Logger.info("SYSTEM", "Selesai. Cek file log untuk detail.");
})();