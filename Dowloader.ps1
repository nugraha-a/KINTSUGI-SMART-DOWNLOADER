# ==========================================================
#   KINTSUGI SMART DOWNLOADER (ULTIMATE EDITION)
#   Fitur: Index Sync, FFmpeg Deep Check, Relay Download
# ==========================================================

# --- 1. KONFIGURASI ---
$OutputFolder = "C:\Users\it\Music\Kintsugi"
$ArchiveFile  = "$OutputFolder\archive.txt"
$ErrorFile    = "$OutputFolder\error_log.txt"
$ReportFile   = "$OutputFolder\Laporan_Gagal.txt"
$URL          = "https://www.youtube.com/playlist?list=PLP_tyyJ-U_wvhzmzj7ciDDRC99alMEYiC"
$YtDlp        = ".\yt-dlp.exe"

# Cek keberadaan FFmpeg untuk Deep Check
$FFmpegExe = ".\ffmpeg.exe"
if (-not (Test-Path $FFmpegExe)) {
    if (Get-Command "ffmpeg" -ErrorAction SilentlyContinue) { $FFmpegExe = "ffmpeg" } else { $FFmpegExe = $null }
}

# Pastikan folder ada
if (!(Test-Path $OutputFolder)) { New-Item -ItemType Directory -Path $OutputFolder | Out-Null }

Clear-Host
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   KINTSUGI DOWNLOADER - SYSTEM READY" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# --- 2. TAHAP SINKRONISASI (INDEX MATCHING) ---
Write-Host ">>> [SYNC] Membaca playlist & mencocokkan nomor file..." -ForegroundColor Magenta

# Ambil data Playlist (Hanya ID dan Index) via Android VR (biar ga error)
$JsonCmd = "$YtDlp --flat-playlist --dump-json --extractor-args ""youtube:player-client=android_vr"" $URL"

try {
    # Konversi output JSON ke Object PowerShell
    $PlaylistData = Invoke-Expression $JsonCmd | ConvertFrom-Json
} catch {
    Write-Host " [ERROR] Gagal koneksi ke YouTube. Cek internet/yt-dlp." -ForegroundColor Red
    $PlaylistData = @()
}

if ($PlaylistData) {
    # 1. Scan Folder Lokal: Ambil semua file .opus
    $LocalFiles = Get-ChildItem -Path $OutputFolder -Filter "*.opus"
    
    # 2. Buat Peta Nomor Urut Lokal: { 1=True, 2=True, ... }
    $LocalIndices = @{}
    foreach ($file in $LocalFiles) {
        # Regex: Ambil angka di awal nama file (misal: "001 Lagu.opus" -> ambil "001")
        if ($file.Name -match "^(\d{3,4})\s") {
            [int]$Index = $matches[1] 
            $LocalIndices[$Index] = $true
        }
    }

    $VerifiedArchive = @()
    $SyncedCount = 0

    # 3. Pencocokan: Jika Nomor X ada di Folder, simpan ID Youtube-nya ke Archive
    foreach ($video in $PlaylistData) {
        $PIndex = [int]$video.playlist_index
        $VidID  = $video.id

        if ($LocalIndices.ContainsKey($PIndex)) {
            $VerifiedArchive += "youtube $VidID"
            $SyncedCount++
        }
    }

    # 4. Simpan Archive Baru
    if ($VerifiedArchive.Count -gt 0) {
        $VerifiedArchive | Out-File -FilePath $ArchiveFile -Encoding UTF8 -Force
        Write-Host " [SUKSES] Sinkronisasi Selesai." -ForegroundColor Green
        Write-Host "          $SyncedCount file dikenali (Index Match) dan diamankan." -ForegroundColor Gray
    } else {
        Write-Host " [INFO] Tidak ada file yang cocok (Archive kosong)." -ForegroundColor Yellow
    }

} else {
    Write-Host " [SKIP] Sinkronisasi dilewati (Data Playlist Kosong)." -ForegroundColor DarkGray
}

$CountStart = $SyncedCount

# --- 3. TAHAP MAINTENANCE (FFMPEG DEEP CHECK) ---
if (Test-Path $ErrorFile) { Remove-Item $ErrorFile }
if (Test-Path $ReportFile) { Remove-Item $ReportFile }

if ($FFmpegExe) {
    Write-Host "`n>>> [CHECK] Memulai 'Deep Scan' integritas file (FFmpeg)..." -ForegroundColor Magenta
    
    $AllFiles = Get-ChildItem -Path $OutputFolder -Filter "*.opus"
    $TotalFiles = $AllFiles.Count
    $ScanCount = 0
    $BadFiles = 0

    foreach ($file in $AllFiles) {
        $ScanCount++
        # Update Progress Bar
        Write-Progress -Activity "Deep Scan Integritas Audio" -Status "Cek [$ScanCount / $TotalFiles]: $($file.Name)" -PercentComplete (($ScanCount / $TotalFiles) * 100)

        # FFmpeg Command: Baca file, buang output, lapor jika error exit code != 0
        $CheckCmd = Start-Process -FilePath $FFmpegExe -ArgumentList "-v error -i `"$($file.FullName)`" -f null -" -Wait -NoNewWindow -PassThru
        
        if ($CheckCmd.ExitCode -ne 0) {
            Write-Host "`n [RUSAK] File korup terdeteksi: $($file.Name)" -ForegroundColor Red
            
            # Hapus File Fisik
            Remove-Item $file.FullName -Force
            
            # Hapus dari Archive (Agar didownload ulang)
            if (Test-Path $ArchiveFile) {
                (Get-Content $ArchiveFile) | Where-Object { $_ -notmatch $file.BaseName } | Set-Content $ArchiveFile
            }
            $BadFiles++
        }
    }
    Write-Progress -Activity "Deep Scan Integritas Audio" -Completed
    
    if ($BadFiles -gt 0) {
        Write-Host " [INFO] Ditemukan & dihapus $BadFiles file rusak." -ForegroundColor Yellow
    } else {
        Write-Host " [OK] Semua file sehat (Validitas terjamin)." -ForegroundColor Green
    }
} else {
    Write-Host "`n [SKIP] Deep Check dilewati (ffmpeg.exe tidak ditemukan)." -ForegroundColor DarkGray
}

# --- 4. EKSEKUSI DOWNLOAD (ESTAFET 3 RONDE) ---
# Args: --no-overwrites (Skip jika ada), --continue (Resume part)
$BaseArgs = "-P ""$OutputFolder"" -x --audio-format opus --audio-quality 0 --embed-thumbnail --embed-metadata --parse-metadata ""playlist_title:%(album)s"" --windows-filenames --trim-filenames 160 -o ""%(playlist_index)s %(artist)s - %(title)s.%(ext)s"" --download-archive ""$ArchiveFile"" --ignore-errors --no-overwrites --continue"

function Run-YtDlp ($ClientName, $ClientArg) {
    Write-Host "`n>>> [DOWNLOAD] Menggunakan Client: $ClientName ..." -ForegroundColor Green
    $Cmd = "$YtDlp $BaseArgs --extractor-args ""youtube:player-client=$ClientArg"" $URL"
    # Jalankan dan lempar error ke log file
    Invoke-Expression "$Cmd 2>> ""$ErrorFile"""
}

# [RONDE 1] Android VR (Prioritas)
Run-YtDlp "Android VR" "android_vr"

# Cek Error Log
$ErrorCheck = if (Test-Path $ErrorFile) { (Get-Content $ErrorFile).Count } else { 0 }

if ($ErrorCheck -gt 0) {
    Write-Host "`n>>> [RETRY] Terdeteksi kegagalan. Mencoba metode cadangan..." -ForegroundColor Yellow
    
    # [RONDE 2] TV Embedded
    Run-YtDlp "TV Embedded" "tv_embedded"
    
    # [RONDE 3] Android Standar
    Run-YtDlp "Android Standar" "android"
} else {
    Write-Host "`n>>> [INFO] Download Ronde 1 Sukses!" -ForegroundColor Gray
}

# --- 5. LAPORAN AKHIR (DETAIL GAGAL) ---
Write-Host "`n>>> [ANALISIS] Membuat Laporan Akhir..." -ForegroundColor Magenta

$SuccessIDs = @()
if (Test-Path $ArchiveFile) {
    # Baca ID dari Archive
    $SuccessIDs = Get-Content $ArchiveFile | ForEach-Object { ($_ -split ' ')[1] }
}

$FailedCount = 0
$ReportContent = "=== LAPORAN DOWNLOAD GAGAL ===`r`nTanggal: $(Get-Date)`r`n`r`n"

if ($PlaylistData) {
    foreach ($video in $PlaylistData) {
        # Jika ID Video TIDAK ADA di Archive -> Gagal
        if ($SuccessIDs -notcontains $video.id) {
            $FailedCount++
            $Title  = if ($video.title) { $video.title } else { "Unknown" }
            $Artist = if ($video.artist) { $video.artist } elseif ($video.uploader) { $video.uploader } else { "Unknown" }
            
            Write-Host " [GAGAL] $Artist - $Title" -ForegroundColor Red
            $ReportContent += "[$($video.playlist_index)] $Artist - $Title`r`nLink: https://youtu.be/$($video.id)`r`n-------------------`r`n"
        }
    }
}

if ($FailedCount -gt 0) {
    $ReportContent | Out-File -FilePath $ReportFile -Encoding UTF8
    Write-Host "`n[!] Ada $FailedCount lagu gagal. Cek detail di: $ReportFile" -ForegroundColor Yellow
} else {
    Write-Host "`n[SEMPURNA] Semua lagu berhasil diamankan!" -ForegroundColor Green
    if (Test-Path $ReportFile) { Remove-Item $ReportFile } # Hapus laporan lama jika sukses
}

# --- 6. STATISTIK SESI ---
if (Test-Path $ArchiveFile) { $CountEnd = (Get-Content $ArchiveFile).Count } else { $CountEnd = 0 }
$NewDownloads = $CountEnd - $CountStart

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "   STATISTIK SESI" -ForegroundColor Cyan
Write-Host " + Total File Awal (Sync)   : $CountStart" -ForegroundColor Gray
Write-Host " + Lagu Baru Didownload     : $NewDownloads" -ForegroundColor Green
Write-Host " + Total Koleksi Akhir      : $CountEnd" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Tekan Enter untuk menutup..." -ForegroundColor DarkGray
Read-Host