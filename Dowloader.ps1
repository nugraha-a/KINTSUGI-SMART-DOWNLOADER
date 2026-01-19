# ==========================================================
#   KINTSUGI SMART DOWNLOADER (STABLE SYNC EDITION v3.1)
#   Fix: Mencegah "False Positive" new download loop
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
    if (Get-Command "yt-dlp" -ErrorAction SilentlyContinue) { 
        $YtDlp = "yt-dlp" 
    } else { 
        Write-Host " [ERROR] yt-dlp.exe tidak ditemukan!" -ForegroundColor Red
        exit 1
    }
}

# Cek keberadaan FFmpeg
$FFmpegExe = ".\ffmpeg.exe"
if (-not (Test-Path $FFmpegExe)) {
    if (Get-Command "ffmpeg" -ErrorAction SilentlyContinue) { $FFmpegExe = "ffmpeg" } else { $FFmpegExe = $null }
}

# Pastikan folder output ada
if (!(Test-Path $OutputFolder)) { New-Item -ItemType Directory -Path $OutputFolder | Out-Null }

Clear-Host
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   KINTSUGI DOWNLOADER - SYSTEM READY" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# --- 2. TAHAP SINKRONISASI (SMART INDEX MATCHING) ---
Write-Host ">>> [SYNC] Verifikasi file lokal & playlist..." -ForegroundColor Magenta

# Ambil data Playlist (Hanya ID dan Index)
$JsonCmd = "$YtDlp --flat-playlist --dump-json --extractor-args ""youtube:player-client=android_vr"" $URL"

try {
    $PlaylistData = Invoke-Expression $JsonCmd | ConvertFrom-Json
} catch {
    Write-Host " [ERROR] Gagal mengambil data playlist. Skip Sync." -ForegroundColor Red
    $PlaylistData = @()
}

if ($PlaylistData) {
    # 1. Scan Folder Lokal
    $LocalFiles = Get-ChildItem -Path $OutputFolder -Filter "*.opus"
    
    # 2. Buat Peta Nomor Urut Lokal (Regex Lebih Pintar)
    # Mengenali "001 ", "1 ", "01 -", dll.
    $LocalIndices = @{}
    foreach ($file in $LocalFiles) {
        if ($file.Name -match "^(\d+)[ .-]+") {
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

        # Jika file nomor X ada di folder -> Masukkan ID ke Archive
        if ($LocalIndices.ContainsKey($PIndex)) {
            $VerifiedArchive += "youtube $VidID"
            $SyncedCount++
        }
    }

    # 4. Tulis Archive Baru (Hanya jika data valid)
    if ($VerifiedArchive.Count -gt 0) {
        $VerifiedArchive | Out-File -FilePath $ArchiveFile -Encoding UTF8 -Force
        Write-Host " [SUKSES] Database lokal diperbarui." -ForegroundColor Green
        Write-Host "          $SyncedCount file terverifikasi cocok." -ForegroundColor Gray
    } else {
        Write-Host " [INFO] Tidak ada file yang cocok (atau folder kosong)." -ForegroundColor Yellow
    }
} else {
    Write-Host " [SKIP] Sync dilewati." -ForegroundColor DarkGray
}

# Hitung jumlah awal berdasarkan Archive yang baru saja ditulis
if (Test-Path $ArchiveFile) { $CountStart = @(Get-Content $ArchiveFile).Count } else { $CountStart = 0 }

# --- 3. TAHAP MAINTENANCE (DEEP CHECK) ---
if (Test-Path $ErrorFile) { Remove-Item $ErrorFile }
if (Test-Path $ReportFile) { Remove-Item $ReportFile }

Write-Host "`n----------------------------------------------------------" -ForegroundColor DarkGray
Write-Host "OPSI: DEEP SCAN INTEGRITY CHECK" -ForegroundColor Cyan
Write-Host "Cek fisik file. File rusak akan dihapus & didownload ulang." -ForegroundColor Gray
$UserChoice = Read-Host ">>> Lakukan Deep Scan sekarang? (Y/N) [Default: N]"

if ($UserChoice -eq 'Y' -or $UserChoice -eq 'y') {
    if ($FFmpegExe) {
        Write-Host "`n>>> [CHECK] Memulai Deep Scan..." -ForegroundColor Magenta
        
        $AllFiles = Get-ChildItem -Path $OutputFolder -Filter "*.opus"
        $TotalFiles = @($AllFiles).Count 
        $BadFiles = 0
        $ScanCount = 0

        if ($TotalFiles -eq 0) {
            Write-Host " [INFO] Folder kosong. Scan dilewati." -ForegroundColor Yellow
        } else {
            foreach ($file in $AllFiles) {
                $ScanCount++
                Write-Progress -Activity "Deep Scan" -Status "Cek [$ScanCount / $TotalFiles]: $($file.Name)" -PercentComplete (($ScanCount / $TotalFiles) * 100)

                $CheckCmd = Start-Process -FilePath $FFmpegExe -ArgumentList "-v error -i `"$($file.FullName)`" -f null -" -Wait -NoNewWindow -PassThru
                
                if ($CheckCmd.ExitCode -ne 0) {
                    Write-Host "`n [RUSAK] File korup: $($file.Name)" -ForegroundColor Red
                    Remove-Item $file.FullName -Force

                    # Hapus ID dari archive.txt secara real-time
                    if ($file.Name -match "^(\d+)[ .-]+") {
                        [int]$BadIndex = $matches[1]
                        $BadVideoData = $PlaylistData | Where-Object { [int]$_.playlist_index -eq $BadIndex }
                        if ($BadVideoData) {
                            $BadID = $BadVideoData.id
                            if (Test-Path $ArchiveFile) {
                                (Get-Content $ArchiveFile) | Where-Object { $_ -notmatch "youtube $BadID" } | Set-Content $ArchiveFile
                                Write-Host "         -> Status reset (Siap download ulang)." -ForegroundColor Yellow
                            }
                        }
                    }
                    $BadFiles++
                }
            }
            Write-Progress -Activity "Deep Scan" -Completed
            
            if ($BadFiles -gt 0) {
                Write-Host " [INFO] $BadFiles file rusak ditemukan & dihapus." -ForegroundColor Yellow
                # Update CountStart karena ada file yang dihapus dari archive
                $CountStart = $CountStart - $BadFiles
            } else {
                Write-Host " [OK] Semua file sehat." -ForegroundColor Green
            }
        }
    } else {
        Write-Host " [ERROR] ffmpeg.exe tidak ditemukan!" -ForegroundColor Red
    }
} else {
    Write-Host " [SKIP] Deep Scan dilewati." -ForegroundColor DarkGray
}
Write-Host "----------------------------------------------------------`n" -ForegroundColor DarkGray

# --- 4. EKSEKUSI DOWNLOAD (ESTAFET 3 RONDE) ---
# Saya tambahkan %(playlist_index)03d agar nama file konsisten 3 digit (001, 002)
$BaseArgs = "-P ""$OutputFolder"" -x --audio-format opus --audio-quality 0 --embed-thumbnail --embed-metadata --parse-metadata ""playlist_title:%(album)s"" --windows-filenames --trim-filenames 160 -o ""%(playlist_index)s %(artist)s - %(title)s.%(ext)s"" --download-archive ""$ArchiveFile"" --ignore-errors --no-overwrites --continue"

function Run-YtDlp ($ClientName, $ClientArg) {
    Write-Host ">>> [DOWNLOAD] Client: $ClientName ..." -ForegroundColor Green
    $Cmd = "$YtDlp $BaseArgs --extractor-args ""youtube:player-client=$ClientArg"" $URL"
    Invoke-Expression "$Cmd 2>> ""$ErrorFile"""
}

Run-YtDlp "Android VR" "android_vr"

$ErrorCheck = if (Test-Path $ErrorFile) { (Get-Content $ErrorFile).Count } else { 0 }
if ($ErrorCheck -gt 0) {
    Write-Host "`n>>> [RETRY] Mencoba metode cadangan..." -ForegroundColor Yellow
    if (Test-Path $ErrorFile) { Clear-Content $ErrorFile }
    Run-YtDlp "TV Embedded" "tv_embedded"
    Run-YtDlp "Android Standar" "android"
}

# --- 5. LAPORAN & STATISTIK ---
Write-Host "`n>>> [ANALISIS] Final Report..." -ForegroundColor Magenta

$SuccessIDs = @()
if (Test-Path $ArchiveFile) { $SuccessIDs = Get-Content $ArchiveFile | ForEach-Object { ($_ -split ' ')[1] } }
$FailedCount = 0
$ReportContent = "=== LAPORAN DOWNLOAD GAGAL ===`r`nTanggal: $(Get-Date)`r`n`r`n"

if ($PlaylistData) {
    foreach ($video in $PlaylistData) {
        if ($SuccessIDs -notcontains $video.id) {
            $FailedCount++
            $Title = if ($video.title) { $video.title } else { "Unknown" }
            $Artist = if ($video.artist) { $video.artist } elseif ($video.uploader) { $video.uploader } else { "Unknown" }
            Write-Host " [GAGAL] $Artist - $Title" -ForegroundColor Red
            $ReportContent += "[$($video.playlist_index)] $Artist - $Title`r`nLink: https://youtu.be/$($video.id)`r`n-------------------`r`n"
        }
    }
}

if ($FailedCount -gt 0) {
    $ReportContent | Out-File -FilePath $ReportFile -Encoding UTF8
} elseif (Test-Path $ReportFile) {
    Remove-Item $ReportFile
}

if (Test-Path $ArchiveFile) { $CountEnd = @(Get-Content $ArchiveFile).Count } else { $CountEnd = 0 }
$NewDownloads = $CountEnd - $CountStart

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "   STATISTIK SESI" -ForegroundColor Cyan
Write-Host " + Total File Awal          : $CountStart" -ForegroundColor Gray
Write-Host " + Lagu Baru Didownload     : $NewDownloads" -ForegroundColor Green
Write-Host " + Total Koleksi Akhir      : $CountEnd" -ForegroundColor Cyan

if ($FailedCount -gt 0) {
    Write-Host " + Gagal Download           : $FailedCount (Lihat Laporan_Gagal.txt)" -ForegroundColor Red
} else {
    Write-Host " + Gagal Download           : 0" -ForegroundColor Green
}
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Tekan Enter untuk menutup..." -ForegroundColor DarkGray
Read-Host