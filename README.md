# KINTSUGI-SMART-DOWNLOADER

**YouTube Playlist Downloader with Archive Trust, FFmpeg Integrity Check & Smart Fallback (v8.0 LITE MODE)**

A lightweight PowerShell script that downloads YouTube playlists as audio files (OPUS format) with archive-based duplicate prevention, corruption detection, and intelligent client fallback.

> 🎵 **Perfect for**: Music archiving, playlist backups, offline listening, audio collection management

---

## 📋 Overview

The `Downloader.ps1` script automates YouTube playlist downloads with these features:

- **📦 Archive Trust Mode**: Uses local `archive.txt` to prevent duplicate downloads
- **🔍 FFmpeg Deep Scan**: Validates audio file integrity and automatically removes corrupted files
- **♻️ Intelligent Fallback**: Primary Android VR client with Web Browser fallback for reliability
- **⏸️ Smart Resume**: Continues interrupted downloads without re-downloading existing files
- **📊 Session Statistics**: Displays download count and collection size

---

## ⚙️ Prerequisites - Installation Guide

### What You Need to Install

#### 1️⃣ **Python 3.8 or Higher**

**Why?** Python is needed to run `pip` and install `yt-dlp` package.

**Installation Steps:**
1. Visit: https://www.python.org/downloads/
2. Click **"Download Python 3.x.x"** (latest version)
3. Run the installer (`.exe` file)
4. ⚠️ **IMPORTANT**: Check ✅ **"Add Python to PATH"** during installation
5. Click "Install Now" and wait for completion

**Verify Installation:**
```powershell
# Open PowerShell and run:
python --version
pip --version
```

---

#### 2️⃣ **yt-dlp** (YouTube Downloader)

**Why?** Extracts playlist metadata and downloads audio from YouTube.

**Installation Method A: Using pip (RECOMMENDED)**
```powershell
# Open PowerShell as Administrator and run:
pip install yt-dlp
```

**Installation Method B: Download Binary Directly**
1. Go to: https://github.com/yt-dlp/yt-dlp
2. Look for **Releases** section (right side of page)
3. Download latest **`yt-dlp.exe`** file
4. Move `yt-dlp.exe` to the same folder as `Downloader.ps1`

**Verify Installation:**
```powershell
yt-dlp --version
```

---

#### 3️⃣ **FFmpeg** (Audio Validator)

**Why?** Checks audio files for corruption and validates file integrity.

**Status:** ⭐ Recommended (optional, but highly suggested)

**Installation Method A: Download Pre-built Binary (EASIEST)**
1. Go to: https://www.gyan.dev/ffmpeg/builds/
2. Download **`ffmpeg-release-full.7z`** (or `.zip` if you don't have 7-zip)
3. Extract the archive (right-click → Extract here)
4. Navigate to the extracted folder → `bin/` folder
5. Find **`ffmpeg.exe`**
6. Copy `ffmpeg.exe` to the same folder as `Downloader.ps1`

**Installation Method B: Using Chocolatey**
```powershell
# Requires Chocolatey installed. In PowerShell as Administrator:
choco install ffmpeg
```

**Installation Method C: Using Scoop**
```powershell
# Requires Scoop installed. In PowerShell:
scoop install ffmpeg
```

**Verify Installation:**
```powershell
ffmpeg -version
```

---

#### 4️⃣ **PowerShell 5.0 or Higher**

**Status:** ✅ Already included in Windows 10/11

**For Older Windows:**
- Download: https://learn.microsoft.com/en-us/powershell/scripting/install/installing-powershell-on-windows

**Verify:**
```powershell
$PSVersionTable.PSVersion
```

---

#### 5️⃣ **Internet Connection**
- Required for YouTube API access and downloading files

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
├── Downloader.ps1          ← Main script (v8.0 LITE MODE)
├── yt-dlp.exe              ← Required (install via pip or download)
├── ffmpeg.exe              ← Optional (for Deep Scan feature)
└── README.md               ← This file
```

**Note**: The script is now in **LITE MODE** which uses archive-based deduplication (no full playlist sync).

### Step 3: Configure the Script

1. Open `Downloader.ps1` in a text editor (Notepad or VS Code)
2. Find lines 11-15 and modify:

```powershell
# Line 11: Where files will be saved
$OutputFolder = "C:\Users\it\Music\Kintsugi"

# Line 15: Your YouTube playlist URL
$URL = "https://www.youtube.com/playlist?list=YOUR_PLAYLIST_ID"
```

**How to get your playlist URL:**
- Go to YouTube
- Open any playlist
- Copy the URL from address bar (e.g., `https://www.youtube.com/playlist?list=PLxxxxxxxxxxxxxx`)

### Step 4: Run the Script

1. Open **PowerShell as Administrator**
2. Navigate to script folder:
   ```powershell
   cd "C:\path\to\KINTSUGI-SMART-DOWNLOADER"
   ```
3. Run the script:
   ```powershell
   .\Downloader.ps1
   ```
4. When prompted, choose whether to perform Deep Scan:
   - Type `Y` to validate and remove corrupted files
   - Type `N` to skip straight to downloading

---

## 📊 How It Works (4 Phases)

### 🔧 Phase 1: Configuration
- Loads configuration settings
- Checks for `yt-dlp.exe` and `ffmpeg.exe` availability
- Creates output folder if it doesn't exist
- Displays system ready message

### 📦 Phase 2: Archive Mode
- Trusts local `archive.txt` file to prevent duplicate downloads
- No YouTube playlist metadata sync required
- Faster startup and less API calls
- Archive file automatically created/updated during downloads

### 🔍 Phase 3: Maintenance (FFmpeg Deep Scan) - Optional
- **User prompted**: "Lakukan Deep Scan sekarang? (Y/N)"
- If YES: Scans all existing `.opus` files for corruption
- Uses FFmpeg to validate audio integrity
- **Automatically removes** corrupted files
- Shows live progress bar
- If NO: Skips maintenance and proceeds to download

### 📥 Phase 4: Download Execution (Smart Fallback)
**Primary Client:**
- Uses **Android VR** client (most stable and fastest)

**If Errors Detected:**
- Automatically switches to **Web Browser** client
- Both methods support resume on interruption
- No duplicate downloads (archive-based prevention)

### 📊 Phase 5: Session Statistics
```
Total Koleksi Lokal      : X (Total files in collection)
Lagu Baru Didownload     : Y (New downloads this session)
```

---

## 📁 Output Files

After running the script, you'll find these files in `$OutputFolder`:

| File | Purpose |
|------|---------|
| `*.opus` | Audio files (format: `001 Artist - Title.opus`) |
| `archive.txt` | Downloaded video IDs (prevents re-downloads) |
| `error_log.txt` | Raw error messages from tools |
| `Laporan_Gagal.txt` | Human-readable failure report with links |

---

## 🔧 Customization

### Change Audio Format
Edit `Downloader.ps1` around line 57:
```powershell
--audio-format opus          # Change to: mp3, m4a, wav, vorbis, flac, etc.
--audio-quality 0            # 0 = highest quality, 9 = lowest
```

### Change Output Filename Format
Edit line 57:
```powershell
-o "%(playlist_index)s %(artist)s - %(title)s.%(ext)s"
```

**Available Variables:**
- `%(playlist_index)s` - Position in playlist (001, 002, etc.)
- `%(title)s` - Video title
- `%(artist)s` - Channel/uploader name
- `%(uploader)s` - Uploader name
- `%(duration)s` - Video duration
- `%(ext)s` - File extension

### Disable FFmpeg Deep Check
Remove or comment out the FFmpeg check section in Phase 3. (Not recommended)

---

## ⚠️ Troubleshooting

| Problem | Solution |
|---------|----------|
| **"yt-dlp.exe not found"** | Install via pip: `pip install yt-dlp` OR download from https://github.com/yt-dlp/yt-dlp |
| **"Access Denied" error** | Run PowerShell as Administrator |
| **Downloads fail immediately** | Check internet connection, verify playlist URL, check YouTube isn't blocking |
| **FFmpeg Deep Check not running** | Download FFmpeg from https://www.gyan.dev/ffmpeg/builds/ |
| **Files marked as corrupted but play fine** | FFmpeg sometimes has false positives; check manually |
| **"Permission denied on archive.txt"** | Close the file if open in another program; wait 30 seconds |
| **Script runs but downloads nothing** | Verify all files already downloaded (check `archive.txt`) |
| **Python/pip not recognized** | Reinstall Python and check "Add Python to PATH" |

---

## 💡 Tips & Tricks

### First Run Setup
1. Create a **small test playlist** (5-10 videos)
2. Run script on test playlist first
3. Verify it works, then use on real playlists

### Large Playlists
- **1000+ videos**: May take 2-4 hours first run
- Script supports resume, so interruptions are safe
- Check progress in console output

### Backup Your Downloads
- Regularly copy `$OutputFolder` to external drive
- Keep `archive.txt` backed up (contains download history)

### Custom Batch Processing
Create a PowerShell script to download multiple playlists:
```powershell
$playlists = @(
    "https://www.youtube.com/playlist?list=PLxxxxx",
    "https://www.youtube.com/playlist?list=PLyyyyy"
)

foreach ($playlist in $playlists) {
    # Edit $URL in Downloader.ps1, then run
    .\Downloader.ps1
}
```

---

## 📝 Important Notes

- ✅ **Archive-Based Deduplication**: Uses local `archive.txt` to prevent re-downloads (faster than sync)
- ✅ **Corruption Detection**: FFmpeg Deep Scan option validates and removes corrupted files
- ✅ **Intelligent Fallback**: Android VR + Web Browser clients for maximum reliability
- ✅ **Resume Support**: Interruptions don't cause re-downloads (archive prevents duplicates)
- ✅ **Optional Maintenance**: Deep Scan is optional - script works fine without FFmpeg
- ⚠️ **LITE MODE**: No full playlist synchronization (uses archive only)
- ⚠️ **First Run**: May take longer depending on playlist size
- ⚠️ **Respect Copyright**: Ensure you have rights to download content

---

## 📜 License & Legal

This project is for **personal, non-commercial use only**.

- Ensure compliance with **YouTube's Terms of Service**
- Respect **copyright laws** in your jurisdiction
- Authors are **not responsible** for misuse of this tool

---

## 👤 Author

**nugraha-a** - KINTSUGI Smart Downloader Ultimate Edition

---

## 🤝 Contributing

Found a bug? Have a suggestion?
- Create an issue on GitHub
- Submit a pull request with improvements

---

**Last Updated:** January 2026
**Version:** v8.0 LITE MODE