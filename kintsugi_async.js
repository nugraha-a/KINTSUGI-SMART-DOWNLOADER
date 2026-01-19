/**
 * KINTSUGI GOLD MASTER (v36.0)
 * Fitur: Smart Index Matching, Trinity Strategy, Deep Heal, Nuclear Safety
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// --- KONFIGURASI UTAMA ---
const CONFIG = {
    url: "https://www.youtube.com/playlist?list=PLP_tyyJ-U_wvhzmzj7ciDDRC99alMEYiC",
    outputDir: "C:\\Users\\it\\Music\\Kintsugi",
    
    // Tools
    ytDlpExe: "yt-dlp.exe",
    ffprobeCmd: "ffprobe", // Biarkan 'ffprobe' agar mencari di ENV PATH
    
    // Database
    archiveFile: "archive.txt",
    auditFile: "audit_failed.log",
    
    // Performa
    maxConcurrency: 6, // 6 Worker stabil
    staggerDelay: 1000 
};

// --- WARNA ---
const C = { Reset: "\x1b[0m", Red: "\x1b[31m", Green: "\x1b[32m", Yellow: "\x1b[33m", Cyan: "\x1b[36m", Magenta: "\x1b[35m", Gray: "\x1b[90m" };

// Global State
let completedCount = 0;
let isStopping = false;
const runningProcesses = new Set();

// --- TRINITY DOWNLOAD STRATEGY ---
const DOWNLOAD_STRATEGIES = [
    // 1. NITRO: Sangat cepat, tapi kadang throttle
    { name: "NITRO", args: ["--extractor-args", "youtube:player-client=android_vr", "-N", "8"] },
    // 2. SAFE: Standar stabil
    { name: "SAFE", args: ["--extractor-args", "youtube:player-client=android", "-N", "1"] },
    // 3. COMPAT: Lambat, tapi tembus restriksi
    { name: "IOS", args: ["--extractor-args", "youtube:player-client=ios"] }
];

// --- FUNGSI KEAMANAN (CTRL+C) ---
function forceKill() {
    if (isStopping) return;
    isStopping = true;
    console.log(`\n\n${C.Red}==========================================`);
    console.log(`[SYSTEM] MEMBUBARKAN PROSES (KILL SWITCH)`);
    console.log(`==========================================${C.Reset}`);

    runningProcesses.forEach(p => { try { process.kill(p.pid); } catch(e) {} });
    
    // Bantai proses zombie di Windows
    try { execSync(`taskkill /F /IM ${CONFIG.ytDlpExe} /T`, { stdio: 'ignore' }); } catch(e) {}
    try { execSync(`taskkill /F /IM ffprobe.exe /T`, { stdio: 'ignore' }); } catch(e) {}
    
    process.exit(0);
}
process.on('SIGINT', forceKill);

// --- HELPER UTILS ---

// 1. Pembersih Nama File (Anti Folder Bug)
function sanitizeFilename(str) {
    if (!str) return "Unknown";
    // Ganti semua karakter ilegal Windows dengan Underscore
    return str.replace(/[\\/:*?"<>|]/g, "_").trim();
}

// 2. Pembersih Database
function loadAndCleanArchive() {
    const archivePath = path.join(CONFIG.outputDir, CONFIG.archiveFile);
    if (!fs.existsSync(archivePath)) return new Set();

    let content = fs.readFileSync(archivePath, 'utf8');
    // Hapus kode warna ANSI yang mungkin terselip
    content = content.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, ""); 
    
    const cleanLines = content.split('\n')
        .map(l => l.trim())
        .filter(l => l.match(/^youtube [a-zA-Z0-9_-]{11}$/));
    
    // Tulis ulang yang bersih
    fs.writeFileSync(archivePath, cleanLines.join('\n') + '\n', 'utf8');
    return new Set(cleanLines.map(l => l.split(' ')[1]));
}

// 3. Cek Kesehatan File (Deep Scan)
function checkFileIntegrity(filePath) {
    return new Promise((resolve) => {
        if (!fs.existsSync(filePath)) return resolve(false);
        const stats = fs.statSync(filePath);
        if (stats.size < 2048) return resolve(false); // < 2KB dianggap sampah

        // Gunakan spawn dengan shell:true agar mengenali command global
        const args = ["-v", "error", "-i", `"${filePath}"`, "-f", "null", "-"];
        const child = spawn(CONFIG.ffprobeCmd, args, { shell: true });
        
        runningProcesses.add(child);
        
        child.on('close', (code) => {
            runningProcesses.delete(child);
            resolve(code === 0);
        });
        
        // Jika ffprobe error sistem (bukan error file), anggap file SEHAT (Fail-safe)
        child.on('error', () => resolve(true)); 
    });
}

// --- LOGIKA UTAMA 1: SMART SCANNER & HEALER ---
async function runSmartHealer(entries, existingIDs) {
    console.log(`${C.Magenta}>>> [1/3] Smart Healer (Mencegah Redownload Sia-sia)...${C.Reset}`);
    
    // Cek FFprobe dulu
    try { execSync(`${CONFIG.ffprobeCmd} -version`, { stdio: 'ignore' }); } 
    catch (e) { console.log(`${C.Yellow} [WARN] FFprobe tidak terdeteksi di PATH. Scan kesehatan dilewati.${C.Reset}`); }

    // A. INDEXING FOLDER
    // Kita baca folder SEKALI saja biar cepat
    const files = fs.readdirSync(CONFIG.outputDir);
    const fileMap = new Map(); // Key: "001", Value: FullPath
    
    // Regex untuk menangkap "001 Judul Apapun.opus"
    files.forEach(f => {
        const match = f.match(/^(\d{3}) /);
        if (match && f.endsWith('.opus')) {
            fileMap.set(match[1], path.join(CONFIG.outputDir, f));
        }
    });

    let healthyCount = 0;
    let fixCount = 0;

    // Queue Worker untuk Cek Fisik
    async function worker(queue) {
        while (queue.length > 0 && !isStopping) {
            const item = queue.shift();
            const indexStr = String(item.idx + 1).padStart(3, '0');
            
            // Progress Bar Visual
            if (item.idx % 5 === 0) {
                process.stdout.write(`${C.Cyan}[SCAN]${C.Reset} Index: ${indexStr} | Valid: ${healthyCount} | Fix: ${fixCount} \r`);
            }

            // CARI FILE BERDASARKAN NOMOR (BUKAN NAMA)
            const actualPath = fileMap.get(indexStr);

            if (actualPath) {
                // File Ada! Cek Integritas
                const isHealthy = await checkFileIntegrity(actualPath);
                
                if (isHealthy) {
                    healthyCount++;
                    // PASTIKAN ID TERCATAT DI ARSIP (SYNC)
                    if (!existingIDs.has(item.id)) existingIDs.add(item.id);
                } else {
                    // File Ada TAPI Rusak
                    try { fs.unlinkSync(actualPath); } catch(e){}
                    existingIDs.delete(item.id); // Hapus dari DB -> Trigger Download
                    fixCount++;
                }
            } else {
                // File Tidak Ada
                existingIDs.delete(item.id); // Hapus dari DB -> Trigger Download
            }

            // BERSIHKAN FILE SAMPAH (PART/WEBP) UNTUK NOMOR INI
            // Agar download nanti bersih
            if (!actualPath || !existingIDs.has(item.id)) {
                files.filter(f => f.startsWith(`${indexStr} `) && (f.endsWith('.part') || f.endsWith('.webp') || f.endsWith('.ytdl')))
                     .forEach(junk => {
                         try { fs.unlinkSync(path.join(CONFIG.outputDir, junk)); } catch(e){}
                     });
            }
        }
    }

    const queue = entries.map((e, i) => ({ ...e, idx: i }));
    const workers = [];
    for (let i = 0; i < CONFIG.maxConcurrency; i++) workers.push(worker(queue));
    await Promise.all(workers);

    console.log(`\n${C.Green} [DONE] Scan Selesai. ${healthyCount} file valid.${C.Reset}`);
    
    // SIMPAN UPDATE DATABASE
    const archivePath = path.join(CONFIG.outputDir, CONFIG.archiveFile);
    const newContent = Array.from(existingIDs).map(id => `youtube ${id}`).join('\n');
    fs.writeFileSync(archivePath, newContent + '\n', 'utf8');
}

// --- LOGIKA UTAMA 2: TRINITY DOWNLOAD ---
function downloadItem(item, archivePath) {
    return new Promise(async (resolve) => {
        if (isStopping) return resolve();

        const indexStr = String(item.realIndex).padStart(3, '0');
        // Format nama file yt-dlp. Biarkan yt-dlp mengisi Artist/Title yang benar.
        // Kita hanya memaksa Nomor Urut di depan.
        const fileName = `${indexStr} %(artist)s - %(title)s.%(ext)s`;

        // LOOP 3 STRATEGI
        for (let i = 0; i < DOWNLOAD_STRATEGIES.length; i++) {
            if (isStopping) break;
            const strategy = DOWNLOAD_STRATEGIES[i];
            
            // Argumen Dasar
            const args = [
                "--no-color", "-P", CONFIG.outputDir,
                "-x", "--audio-format", "opus", "--audio-quality", "0",
                "--embed-thumbnail", "--embed-metadata",
                "--no-restrict-filenames", "--trim-filenames", "160",
                
                "-o", fileName, // Template Nama
                
                "--no-overwrites", "--continue", "--no-cache-dir",
                `https://www.youtube.com/watch?v=${item.id}`,
                
                ...strategy.args // Masukkan argumen Nitro/Safe/Compat
            ];

            const success = await new Promise(r => {
                const child = spawn(path.resolve(__dirname, CONFIG.ytDlpExe), args, { shell: false });
                runningProcesses.add(child);
                child.on('close', (code) => { runningProcesses.delete(child); r(code === 0); });
            });

            if (success) {
                // Sukses! Catat dan keluar loop
                try { fs.appendFileSync(archivePath, `youtube ${item.id}\n`); } catch(e) {}
                resolve(true);
                return;
            }
            // Jika gagal, lanjut ke strategi berikutnya...
        }
        resolve(false); // Gagal semua cara
    });
}

async function startDownloadQueue(queue) {
    const archivePath = path.join(CONFIG.outputDir, CONFIG.archiveFile);
    async function worker() {
        while (queue.length > 0 && !isStopping) {
            const item = queue.shift();
            process.stdout.write(`${C.Cyan}[DOWN]${C.Reset} ${String(item.realIndex).padStart(3,'0')} | Sisa: ${queue.length} \r`);
            await downloadItem(item, archivePath);
            completedCount++;
        }
    }
    const workers = [];
    for (let i = 0; i < CONFIG.maxConcurrency; i++) workers.push(worker());
    await Promise.all(workers);
}

// --- MAIN EXECUTION ---
(async () => {
    console.clear();
    console.log(`${C.Cyan}==========================================`);
    console.log(`   KINTSUGI GOLD MASTER (v36.0)`);
    console.log(`   Loop-Free | Auto-Heal | Multi-Strategy`);
    console.log(`==========================================\n${C.Reset}`);

    if (!fs.existsSync(CONFIG.outputDir)) fs.mkdirSync(CONFIG.outputDir, { recursive: true });
    
    // 1. SNAPSHOT
    console.log(`${C.Magenta}>>> [SNAPSHOT] Mengambil Data Playlist...${C.Reset}`);
    let entries = [];
    try {
        const cmd = `"${CONFIG.ytDlpExe}" --flat-playlist --dump-single-json --no-clean-info "${CONFIG.url}"`;
        const output = execSync(cmd, { maxBuffer: 1024 * 1024 * 50, encoding: 'utf8' });
        entries = JSON.parse(output).entries || [];
        console.log(`${C.Green} [OK] Terbaca ${entries.length} lagu.${C.Reset}`);
    } catch (e) {
        console.log(`${C.Red} [ERROR] Gagal ambil snapshot. Pastikan yt-dlp.exe ada.${C.Reset}`);
        process.exit(1);
    }

    // 2. HEALER SCAN (Hanya perbaiki yang benar-benar rusak)
    const existingIDs = loadAndCleanArchive();
    await runSmartHealer(entries, existingIDs);

    // 3. DOWNLOAD QUEUE
    const downloadQueue = [];
    entries.forEach((entry, idx) => {
        // Hanya download jika ID tidak ada di arsip (yang sudah diverifikasi healer)
        if (!existingIDs.has(entry.id)) {
            downloadQueue.push({ id: entry.id, realIndex: idx + 1 });
        }
    });

    if (downloadQueue.length > 0) {
        console.log(`\n${C.Magenta}>>> [DOWNLOAD] Memproses ${downloadQueue.length} file...${C.Reset}`);
        const startTime = Date.now();
        await startDownloadQueue(downloadQueue);
        console.log(`\n${C.Cyan}   SELESAI (${((Date.now() - startTime) / 1000).toFixed(1)}s)${C.Reset}`);
    } else {
        console.log(`\n${C.Green}[INFO] Sistem Sinkron Sempurna. Tidak ada aktivitas.${C.Reset}`);
    }

    // 4. FINAL AUDIT LOG
    const failedList = [];
    entries.forEach((item, idx) => {
        const indexStr = String(idx + 1).padStart(3, '0');
        // Audit sederhana: Cek apakah ada file opus dengan nomor ini
        const hasFile = fs.readdirSync(CONFIG.outputDir).some(f => f.startsWith(`${indexStr} `) && f.endsWith('.opus'));
        if (!hasFile) failedList.push(`[${indexStr}] ID: ${item.id}`);
    });

    if (failedList.length > 0) {
        fs.writeFileSync(path.join(CONFIG.outputDir, CONFIG.auditFile), failedList.join('\n'));
        console.log(`${C.Red}\n[FAIL] ${failedList.length} file gagal total (Cek audit_failed.log).${C.Reset}`);
    } else {
        console.log(`${C.Green}\n[SUCCESS] Audit Bersih 100%.${C.Reset}`);
    }

    console.log("\nTekan sembarang tombol untuk keluar...");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', process.exit.bind(process, 0));
})();