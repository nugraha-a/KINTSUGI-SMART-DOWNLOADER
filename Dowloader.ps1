# ==========================================================
#   KINTSUGI SMART DOWNLOADER (AUTO-FIX EDITION)
#   Fitur: Index Sync, Deep Scan + Auto Redownload
# ==========================================================

# --- 1. KONFIGURASI ---
$OutputFolder = "C:\Users\it\Music\Kintsugi"
$ArchiveFile  = "$OutputFolder\archive.txt"
$ErrorFile    = "$OutputFolder\error_log.txt"
$ReportFile   = "$OutputFolder\Laporan_Gagal.txt"
$URL          = "https://www.youtube.com/playlist?list=PLP_tyyJ-U_wvhzmzj7ciDDRC99alMEYiC"
$YtDlp        = ".\yt-dlp.exe"

# Cek keberadaan yt-dlp
if (-not (Test-Path $YtDlp)) {
    if (Get-Command "yt-dlp" -ErrorAction SilentlyContinue) { $YtDlp = "yt-dlp" } else { 
        Write-Host " [ERROR] yt-dlp.exe tidak ditemukan!" -ForegroundColor Red
        Write-Host " Silakan install: pip install yt-dlp atau download dari https://github.com/yt-dlp/yt-dlp" -ForegroundColor Yellow
        exit 1
    }
}

# Cek keberadaan FFmpeg
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

# Ambil data Playlist (Hanya ID dan Index)
$JsonCmd = "$YtDlp --flat-playlist --dump-json --extractor-args ""youtube:player-client=android_vr"" $URL"

try {
    $PlaylistData = Invoke-Expression $JsonCmd | ConvertFrom-Json
} catch {
    Write-Host " [ERROR] Gagal koneksi ke YouTube. Cek internet/yt-dlp." -ForegroundColor Red
    $PlaylistData = @()
}

if ($PlaylistData) {
    # 1. Scan Folder Lokal
    $LocalFiles = Get-ChildItem -Path $OutputFolder -Filter "*.opus"
    
    # 2. Buat Peta Nomor Urut Lokal
    $LocalIndices = @{}
    foreach ($file in $LocalFiles) {
        if ($file.Name -match "^(\d{3,4})\s") {
            [int]$Index = $matches[1] 
            $LocalIndices[$Index] = $true
        }
    }

    $VerifiedArchive = @()
    $SyncedCount = 0

    # 3. Pencocokan Index -> ID
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
        Write-Host "          $SyncedCount file dikenali (Index Match)." -ForegroundColor Gray
    } else {
        Write-Host " [INFO] Tidak ada file yang cocok." -ForegroundColor Yellow
    }

} else {
    Write-Host " [SKIP] Sinkronisasi dilewati (Playlist Kosong)." -ForegroundColor DarkGray
}

$CountStart = $SyncedCount

# --- 3. TAHAP MAINTENANCE (OPTIONAL DEEP CHECK) ---
if (Test-Path $ErrorFile) { Remove-Item $ErrorFile }
if (Test-Path $ReportFile) { Remove-Item $ReportFile }

Write-Host "`n----------------------------------------------------------" -ForegroundColor DarkGray
Write-Host "OPSI: DEEP SCAN INTEGRITY CHECK" -ForegroundColor Cyan
Write-Host "Cek fisik file. File rusak akan DIHAPUS agar didownload ulang." -ForegroundColor Gray
Write-Host "Waktu estimasi: Lama (tergantung jumlah file)." -ForegroundColor Gray

$UserChoice = Read-Host ">>> Lakukan Deep Scan sekarang? (Y/N) [Default: N]"

if ($UserChoice -eq 'Y' -or $UserChoice -eq 'y') {
    if ($FFmpegExe) {
        Write-Host "`n>>> [CHECK] Memulai 'Deep Scan' integritas file..." -ForegroundColor Magenta
        
        $AllFiles = Get-ChildItem -Path $OutputFolder -Filter "*.opus"
        $TotalFiles = @($AllFiles).Count
        $ScanCount = 0
        $BadFiles = 0

        if ($TotalFiles -eq 0) {
            Write-Host " [INFO] Tidak ada file .opus ditemukan. Deep Scan dilewati." -ForegroundColor Yellow
        } else {
        foreach ($file in $AllFiles) {
            $ScanCount++
            Write-Progress -Activity "Deep Scan Audio" -Status "Cek [$ScanCount / $TotalFiles]: $($file.Name)" -PercentComplete (($ScanCount / $TotalFiles) * 100)

            # FFmpeg Silent Check
            $CheckCmd = Start-Process -FilePath $FFmpegExe -ArgumentList "-v error -i `"$($file.FullName)`" -f null -" -Wait -NoNewWindow -PassThru
            
            if ($CheckCmd.ExitCode -ne 0) {
                Write-Host "`n [RUSAK] File korup terdeteksi: $($file.Name)" -ForegroundColor Red
                
                # 1. Hapus File Fisik
                Remove-Item $file.FullName -Force

                # 2. Hapus ID dari Archive (FIX LOGIC)
                if ($file.Name -match "^(\d{3,4})\s") {
                    [int]$BadIndex = $matches[1]
                    # Cari ID YouTube berdasarkan nomor urut file
                    $BadVideoData = $PlaylistData | Where-Object { [int]$_.playlist_index -eq $BadIndex }
                    
                    if ($BadVideoData) {
                        $BadID = $BadVideoData.id
                        # Baca archive, buang baris yang mengandung ID ini
                        if (Test-Path $ArchiveFile) {
                            $CleanArchive = Get-Content $ArchiveFile | Where-Object { $_ -notmatch "youtube $BadID" }
                            $CleanArchive | Set-Content $ArchiveFile
                            Write-Host "         -> ID dihapus dari Archive (Siap download ulang)." -ForegroundColor Yellow
                        }
                    }
                }
                $BadFiles++
            }
        }
        Write-Progress -Activity "Deep Scan Audio" -Completed
        
        if ($BadFiles -gt 0) {
            Write-Host " [INFO] $BadFiles file rusak telah dihapus & direset dari archive." -ForegroundColor Yellow
        } else {
            Write-Host " [OK] Semua file sehat." -ForegroundColor Green
        }
        }
    } else {
        Write-Host "`n [ERROR] Tidak bisa Scan. File ffmpeg.exe tidak ditemukan!" -ForegroundColor Red
    }
} else {
    Write-Host " [SKIP] Deep Scan dilewati oleh user." -ForegroundColor DarkGray
}
Write-Host "----------------------------------------------------------`n" -ForegroundColor DarkGray

# --- 4. EKSEKUSI DOWNLOAD (ESTAFET 3 RONDE) ---
# Skrip download ini otomatis akan mengambil lagu yang tadi dihapus di tahap Deep Scan
$BaseArgs = "-P ""$OutputFolder"" -x --audio-format opus --audio-quality 0 --embed-thumbnail --embed-metadata --parse-metadata ""playlist_title:%(album)s"" --windows-filenames --trim-filenames 160 -o ""%(playlist_index)s %(artist)s - %(title)s.%(ext)s"" --download-archive ""$ArchiveFile"" --ignore-errors --no-overwrites --continue"

function Run-YtDlp ($ClientName, $ClientArg) {
    Write-Host ">>> [DOWNLOAD] Client: $ClientName ..." -ForegroundColor Green
    $Cmd = "$YtDlp $BaseArgs --extractor-args ""youtube:player-client=$ClientArg"" $URL"
    Invoke-Expression "$Cmd 2>> ""$ErrorFile"""
}

# Ronde 1: Android VR
Run-YtDlp "Android VR" "android_vr"

# Cek Error
$ErrorCheck = if (Test-Path $ErrorFile) { (Get-Content $ErrorFile).Count } else { 0 }

if ($ErrorCheck -gt 0) {
    Write-Host "`n>>> [RETRY] Mencoba metode cadangan..." -ForegroundColor Yellow
    if (Test-Path $ErrorFile) { Clear-Content $ErrorFile }
    # Ronde 2 & 3
    Run-YtDlp "TV Embedded" "tv_embedded"
    Run-YtDlp "Android Standar" "android"
} else {
    Write-Host "`n>>> [INFO] Download Ronde 1 Sukses!" -ForegroundColor Gray
}

# --- 5. LAPORAN AKHIR ---
Write-Host "`n>>> [ANALISIS] Membuat Laporan..." -ForegroundColor Magenta

$SuccessIDs = @()
if (Test-Path $ArchiveFile) {
    $SuccessIDs = Get-Content $ArchiveFile | ForEach-Object { ($_ -split ' ')[1] }
}

$FailedCount = 0
$ReportContent = "=== LAPORAN DOWNLOAD GAGAL ===`r`nTanggal: $(Get-Date)`r`n`r`n"

if ($PlaylistData) {
    foreach ($video in $PlaylistData) {
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
    if (Test-Path $ReportFile) { Remove-Item $ReportFile }
    Write-Host "`n[SEMPURNA] Semua lagu berhasil diamankan!" -ForegroundColor Green
}

# --- 6. STATISTIK ---
if (Test-Path $ArchiveFile) { $CountEnd = @(Get-Content $ArchiveFile).Count } else { $CountEnd = 0 }
$NewDownloads = $CountEnd - $CountStart

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "   STATISTIK SESI" -ForegroundColor Cyan
Write-Host " + Total File Awal (Sync)   : $CountStart" -ForegroundColor Gray
Write-Host " + Lagu Baru Didownload     : $NewDownloads" -ForegroundColor Green
Write-Host " + Total Koleksi Akhir      : $CountEnd" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Tekan Enter untuk menutup..." -ForegroundColor DarkGray
Read-Host