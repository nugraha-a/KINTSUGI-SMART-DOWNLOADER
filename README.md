# KINTSUGI-SMART-DOWNLOADER

**YouTube Playlist Downloader with Multi-Threaded Downloads, Dynamic Quality FFmpeg Conversion & Smart Sync (v67.0 SMART QUALITY EDITION)**

A Node.js-powered async downloader that synchronizes YouTube playlists with intelligent audio quality optimization, multi-threaded processing, and comprehensive file management.

> 🎵 **Perfect for**: Music archiving, playlist backups, offline listening, audio collection management

---

## 📋 Overview

The `kintsugi_async.js` script automates YouTube playlist downloads with these advanced features:

- **🚀 Multi-Threaded Downloads**: Concurrent yt-dlp workers for faster playlist processing
- **🎛️ Dynamic Quality**: Intelligent bitrate selection based on source audio analysis
- **🔄 Playlist Sync**: Full synchronization with YouTube playlist (new, deleted, private video detection)
- **📦 Archive Management**: Database-driven tracking with orphan/deleted video handling
- **🔧 FFmpeg Conversion**: Multi-threaded audio conversion with dynamic quality optimization
- **📊 Session Logging**: Timestamped logs with granular file/activity tracking
- **⏸️ Smart Resume**: Continues interrupted downloads without duplicates

---

## 🆕 What's New in v67.0

- **SMART QUALITY EDITION**: Dynamic bitrate selection based on source file analysis
- **Multi-threaded FFmpeg**: Parallel audio conversion utilizing all CPU cores
- **Interactive Menu**: User-friendly console menu for different operations
- **Enhanced Archive System**: Better handling of orphaned and unavailable videos
- **Data Directory Structure**: Organized `data/` folder for database, archive, and logs

---

## ⚙️ Prerequisites - Installation Guide

### What You Need to Install

#### 1️⃣ **Node.js 16.x or Higher**

**Why?** Node.js is required to run the async JavaScript downloader script.

**Installation Steps:**
1. Visit: https://nodejs.org/
2. Click **"Download LTS"** (recommended version)
3. Run the installer (`.msi` file)
4. Follow installation wizard (default options are fine)
5. Node.js will be added to PATH automatically

**Verify Installation:**
```powershell
# Open PowerShell/CMD and run:
node --version
npm --version
```

---

#### 2️⃣ **yt-dlp** (YouTube Downloader)

**Why?** Extracts playlist metadata and downloads audio from YouTube.

**Installation: Download Binary (RECOMMENDED)**
1. Go to: https://github.com/yt-dlp/yt-dlp/releases
2. Download latest **`yt-dlp.exe`** file
3. Move `yt-dlp.exe` to the same folder as `kintsugi_async.js`

**Verify Installation:**
```powershell
yt-dlp --version
```

---

#### 3️⃣ **FFmpeg & FFprobe** (Audio Processing)

**Why?** Converts audio files and analyzes source quality for dynamic bitrate selection.

**Status:** ⭐ Required for full functionality

**Installation: Download Pre-built Binary (EASIEST)**
1. Go to: https://www.gyan.dev/ffmpeg/builds/
2. Download **`ffmpeg-release-full.7z`** (or `.zip`)
3. Extract the archive
4. Navigate to extracted folder → `bin/` folder
5. Copy **`ffmpeg.exe`** and **`ffprobe.exe`** to the script folder

**Verify Installation:**
```powershell
ffmpeg -version
ffprobe -version
```

---

## 🚀 Quick Start (Step by Step)

### Step 1: Get the Script

**Option A: Using Git**
```powershell
git clone https://github.com/nugraha-a/KINTSUGI-SMART-DOWNLOADER.git
cd KINTSUGI-SMART-DOWNLOADER
```

**Option B: Download Manually**
1. Go to: https://github.com/nugraha-a/KINTSUGI-SMART-DOWNLOADER
2. Click "Code" → "Download ZIP"
3. Extract the ZIP file

### Step 2: Place Tools in Script Folder

Your folder should look like this:
```
KINTSUGI-SMART-DOWNLOADER/
├── kintsugi_async.js       ← Main script (v67.0 SMART QUALITY EDITION)
├── START_SYNC.bat          ← One-click launcher for Windows
├── yt-dlp.exe              ← Required (download from GitHub)
├── ffmpeg.exe              ← Required (for conversion & quality analysis)
├── ffprobe.exe             ← Required (for audio analysis)
├── data/                   ← Auto-created: database, archive, logs
│   ├── kintsugi_db.json    ← Playlist database
│   ├── archive.txt         ← Downloaded video IDs
│   └── log/                ← Session logs
└── README.md               ← This file
```

### Step 3: Configure the Script

1. Open `kintsugi_async.js` in a text editor (Notepad, VS Code, etc.)
2. Find lines 17-19 and modify:

```javascript
const CONFIG = {
    url: "https://www.youtube.com/playlist?list=YOUR_PLAYLIST_ID",
    outputDir: "C:\\Users\\YourName\\Music\\Kintsugi",
    // ... other settings
};
```

**How to get your playlist URL:**
- Go to YouTube → Open any playlist
- Copy the URL from address bar (e.g., `https://www.youtube.com/playlist?list=PLxxxxxxxxxxxxxx`)

### Step 4: Run the Script

**Option A: Using Batch File (Easiest)**
1. Double-click `START_SYNC.bat`

**Option B: Using Command Line**
```powershell
cd "C:\path\to\KINTSUGI-SMART-DOWNLOADER"
node kintsugi_async.js
```

### Step 5: Choose from Interactive Menu

```
╔══════════════════════════════════════════════════════╗
║           KINTSUGI SMART DOWNLOADER                  ║
╠══════════════════════════════════════════════════════╣
║  [1] Sync Playlist & Download                        ║
║  [2] FFmpeg Conversion Only                          ║
║  [3] Full Sync + Convert                             ║
║  [4] Settings                                        ║
║  [5] Exit                                            ║
╚══════════════════════════════════════════════════════╝
```

---

## 📊 How It Works (Multi-Phase Architecture)

### 🔧 Phase 1: Initialization
- Auto-detects CPU cores for optimal thread count
- Creates output and data directories
- Initializes session logging with timestamp

### 📡 Phase 2: Playlist Snapshot
- Connects to YouTube Playlist API via yt-dlp
- Retrieves all video metadata (title, uploader, status)
- Detects new, deleted, and private videos

### 🔄 Phase 3: Harmonization (Data Sync)
- Compares remote playlist with local database
- Marks videos as: `active`, `orphaned`, `unavailable_pending`, `archived`
- Preserves title history for deleted videos

### 🔍 Phase 4: Audit (User Decision)
- Prompts for orphaned videos (removed from playlist): Keep or Delete?
- Prompts for unavailable videos (deleted/private): Keep or Delete?

### 📝 Phase 5: Re-indexing
- Renames files based on playlist position: `001 Artist - Title.opus`
- Archived files get `[ARCHIVED]` prefix
- Sanitizes illegal filename characters

### 🛡️ Phase 6: Whitelist Security
- Removes untracked files from output directory
- Cleans up temporary/partial download files

### 📥 Phase 7: Multi-Threaded Download
**3 Concurrent Workers with Fallback Strategies:**
1. **NITRO**: Android VR client with 8 connections (fastest)
2. **SAFE**: Android client with 2 connections (reliable)
3. **IOS**: iOS client (backup)

- Downloads native Opus audio from YouTube (no re-encoding loss)
- Embeds thumbnails and metadata

### 🎛️ Phase 8: FFmpeg Conversion (Optional)
- Converts source files (.webm, .m4a) to optimized Opus
- **Dynamic Quality**: Analyzes source bitrate and adjusts output accordingly
  - Lossless sources → 256k
  - High quality (≥256kbps) → 192k
  - Standard YouTube (≥128kbps) → 128k
  - Lower quality → 96k or 64k

---

## 🔧 Configuration Options

Edit the `CONFIG` object in `kintsugi_async.js`:

```javascript
const CONFIG = {
    // Core Settings
    url: "YOUR_PLAYLIST_URL",
    outputDir: "C:\\Users\\YourName\\Music\\Kintsugi",
    
    // Multi-Thread Settings
    maxDownloadConcurrency: 3,      // Concurrent yt-dlp downloads
    maxFfmpegConcurrency: 4,        // FFmpeg threads (auto-detects CPU)
    ffmpegThreadsPerJob: 2,         // Threads per FFmpeg job
    staggerDelay: 500,              // Delay between workers (ms)
    
    // Quality Settings
    dynamicQuality: true,           // Enable smart quality selection
    qualityTiers: {
        lossless: '256k',           // FLAC, WAV, AIFF
        high: '192k',               // Source ≥ 256 kbps
        standard: '128k',           // Standard YouTube
        low: '96k',                 // Source ≥ 96 kbps
        minimum: '64k'              // Very low source
    },
    fallbackBitrate: '128k',        // When probe fails
    
    // File Settings
    supportedSourceFormats: ['.webm', '.m4a'],
    deleteSourceAfterConvert: true
};
```

---

## 📁 Output Files

| File/Folder | Purpose |
|-------------|---------|
| `*.opus` | Audio files (format: `001 Artist - Title.opus`) |
| `[ARCHIVED] *.opus` | Archived files (removed from playlist but kept) |
| `data/kintsugi_db.json` | Playlist database with video metadata & status |
| `data/archive.txt` | Downloaded video IDs (prevents re-downloads) |
| `data/log/*.log` | Session logs with timestamps |

---

## 🎯 Video Status Lifecycle

| Status | Description |
|--------|-------------|
| `active` | In playlist, ready for download/sync |
| `orphaned` | Removed from playlist (user chooses: keep or delete) |
| `unavailable_pending` | Video is deleted/private (user chooses: keep or delete) |
| `archived` | User chose to keep orphaned video |
| `unavailable_archived` | User chose to keep deleted/private video |

---

## ⚠️ Troubleshooting

| Problem | Solution |
|---------|----------|
| **"Node.js not found"** | Install from https://nodejs.org/ |
| **"yt-dlp.exe not found"** | Download from https://github.com/yt-dlp/yt-dlp |
| **"ffprobe not found"** | Download FFmpeg package (includes ffprobe) |
| **Downloads fail** | Check internet, verify playlist URL, try different strategy |
| **Quality always 128k** | Ensure ffprobe.exe is in script folder |
| **Script hangs on sync** | Large playlists may take time; check YouTube connectivity |
| **CTRL+C doesn't stop** | Force kill: Press CTRL+C multiple times or close window |

---

## 💡 Tips & Tricks

### First Run Setup
1. Create a **small test playlist** (5-10 videos)
2. Run script on test playlist first
3. Verify it works, then use on real playlists

### Large Playlists
- **1000+ videos**: First sync takes time, downloads are fast with 3 workers
- Script supports resume - interruptions are safe
- Check `data/log/` for detailed progress

### Performance Tuning
- Increase `maxDownloadConcurrency` for faster downloads (uses more bandwidth)
- Adjust `maxFfmpegConcurrency` based on your CPU cores

### Backup Your Downloads
- Regularly backup `outputDir` to external drive
- Keep `data/kintsugi_db.json` backed up (contains all metadata)
- Keep `data/archive.txt` backed up (download history)

---

## 📝 Important Notes

- ✅ **Native Opus**: Downloads YouTube's native Opus audio (no re-encoding loss)
- ✅ **Smart Quality**: Analyzes source and adjusts output bitrate accordingly
- ✅ **Multi-Threaded**: Parallel downloads and conversions for speed
- ✅ **Resume Support**: Interruptions don't cause re-downloads
- ✅ **Database Driven**: Full tracking of playlist state and file status
- ⚠️ **First Run**: Initial sync may take longer for large playlists
- ⚠️ **Respect Copyright**: Ensure you have rights to download content

---

## 📜 License & Legal

This project is for **personal, non-commercial use only**.

- Ensure compliance with **YouTube's Terms of Service**
- Respect **copyright laws** in your jurisdiction
- Authors are **not responsible** for misuse of this tool

---

## 👤 Author

**nugraha-a** - KINTSUGI Smart Downloader v67.0 (SMART QUALITY EDITION)

---

## 🤝 Contributing

Found a bug? Have a suggestion?
- Create an issue on GitHub
- Submit a pull request with improvements

---

**Last Updated:** January 2026
**Version:** v67.0 SMART QUALITY EDITION