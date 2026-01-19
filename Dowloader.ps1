# ==========================================================
#   KINTSUGI SMART DOWNLOADER (v8.0 - LITE MODE)
#   Fitur: No-Sync, Archive Trust, FFmpeg Deep Scan
# ==========================================================

# 1. SETUP
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# 2. KONFIGURASI
$OutputFolder = "C:\Users\it\Music\Kintsugi"
$ArchiveFile  = "$OutputFolder\archive.txt"
$ErrorFile    = "$OutputFolder\error_log.txt"
$RunLog       = "$OutputFolder\run_log.txt"
$URL          = "https://www.youtube.com/playlist?list=PLP_tyyJ-U_wvhzmzj7ciDDRC99alMEYiC"
$YtDlp        = ".\yt-dlp.exe"

# Cek Tools
if (-not (Test-Path $YtDlp)) { Write-Host " [ERROR] yt-dlp.exe hilang!" -ForegroundColor Red; Read-Host; exit }
$FFmpegExe = ".\ffmpeg.exe"
if (-not (Test-Path $FFmpegExe)) { if (Get-Command "ffmpeg" -ErrorAction SilentlyContinue) { $FFmpegExe = "ffmpeg" } else { $FFmpegExe = $null } }

# Buat Folder
if (!(Test-Path $OutputFolder)) { New-Item -ItemType Directory -Path $OutputFolder | Out-Null }

Clear-Host
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   KINTSUGI DOWNLOADER - SYSTEM READY (LITE MODE)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# --- SKIP SYNC SESUAI REQUEST ---
Write-Host ">>> [SYNC] Dilewati (Menggunakan Archive Lokal)..." -ForegroundColor DarkGray
if (Test-Path $ArchiveFile) { 
    $CountStart = @(Get-Content $ArchiveFile).Count 
    Write-Host "    - Archive Lokal Terbaca: $CountStart entri." -ForegroundColor Gray
} else {
    Write-Host "    - Archive belum ada. Akan dibuat saat download." -ForegroundColor Yellow
    $CountStart = 0
}

# --- 3. TAHAP MAINTENANCE (DEEP CHECK) ---
if (Test-Path $ErrorFile) { Remove-Item $ErrorFile }
if (Test-Path $RunLog) { Remove-Item $RunLog }

Write-Host "`n----------------------------------------------------------" -ForegroundColor DarkGray
Write-Host "OPSI: DEEP SCAN INTEGRITY CHECK" -ForegroundColor Cyan
$UserChoice = Read-Host ">>> Lakukan Deep Scan sekarang? (Y/N) [Default: N]"

if ($UserChoice -eq 'Y' -or $UserChoice -eq 'y') {
    if ($FFmpegExe) {
        Write-Host "`n>>> [CHECK] Memulai Deep Scan..." -ForegroundColor Magenta
        $AllFiles = Get-ChildItem -Path $OutputFolder -Filter "*.opus"
        $TotalFiles = @($AllFiles).Count 
        $BadFiles = 0; $ScanCount = 0

        if ($TotalFiles -eq 0) { Write-Host " [INFO] Folder kosong." -ForegroundColor Yellow }
        else {
            foreach ($file in $AllFiles) {
                $ScanCount++
                Write-Progress -Activity "Deep Scan" -Status "[$ScanCount / $TotalFiles] $($file.Name)" -PercentComplete (($ScanCount / $TotalFiles) * 100)
                
                # Cek Fisik File
                $CheckCmd = Start-Process -FilePath $FFmpegExe -ArgumentList "-v error -i `"$($file.FullName)`" -f null -" -Wait -NoNewWindow -PassThru
                
                if ($CheckCmd.ExitCode -ne 0) {
                    Write-Host "`n [RUSAK] File korup: $($file.Name)" -ForegroundColor Red
                    
                    # Hapus File Fisik
                    Remove-Item $file.FullName -Force
                    
                    # Coba hapus dari archive secara 'Blind' (Cari ID dari metadata file jika bisa, jika tidak skip)
                    # Karena kita skip sync, kita tidak bisa menjamin update archive 100%
                    Write-Host "         -> File dihapus. (ID Archive perlu reset manual jika download gagal)" -ForegroundColor Gray
                    
                    $BadFiles++
                }
            }
            Write-Progress -Activity "Deep Scan" -Completed
            if ($BadFiles -gt 0) { Write-Host " [INFO] $BadFiles file rusak dihapus." -ForegroundColor Yellow }
            else { Write-Host " [OK] Semua file sehat." -ForegroundColor Green }
        }
    } else { Write-Host " [ERROR] ffmpeg.exe tidak ditemukan!" -ForegroundColor Red }
} else { Write-Host " [SKIP] Deep Scan dilewati." -ForegroundColor DarkGray }
Write-Host "----------------------------------------------------------`n" -ForegroundColor DarkGray

# --- 4. EKSEKUSI DOWNLOAD ---
# Kita langsung gas download. Jika IP masih diblokir, error akan muncul di sini (tapi bukan fatal crash)
$BaseArgs = "-P ""$OutputFolder"" -x --audio-format opus --audio-quality 0 --embed-thumbnail --embed-metadata --parse-metadata ""playlist_title:%(album)s"" --windows-filenames --trim-filenames 160 -o ""%(playlist_index)03d %(artist)s - %(title)s.%(ext)s"" --download-archive ""$ArchiveFile"" --ignore-errors --no-overwrites --continue"

function Run-YtDlp ($ClientName, $ClientArg) {
    Write-Host ">>> [DOWNLOAD] Client: $ClientName ..." -ForegroundColor Green
    # Pipe output ke log file untuk statistik
    $Cmd = "$YtDlp $BaseArgs --extractor-args ""youtube:player-client=$ClientArg"" $URL"
    Invoke-Expression "$Cmd 2>> ""$ErrorFile"" | Tee-Object -FilePath ""$RunLog"" -Append"
}

# Coba Android VR (Paling Cepat)
Run-YtDlp "Android VR" "android_vr"

# Cek jika error banyak, coba switch ke Web
$ErrorCheck = if (Test-Path $ErrorFile) { (Get-Content $ErrorFile).Count } else { 0 }
if ($ErrorCheck -gt 2) { 
    Write-Host "`n>>> [RETRY] Android VR banyak error. Mencoba mode Web..." -ForegroundColor Yellow
    if (Test-Path $ErrorFile) { Clear-Content $ErrorFile }
    Run-YtDlp "Web Browser" "web"
}

# --- 5. STATISTIK SESI ---
Write-Host "`n>>> [ANALISIS] Selesai." -ForegroundColor Magenta

$RealNewDownloads = 0
if (Test-Path $RunLog) {
    # Hitung sukses download fisik
    $DownloadEvents = Select-String -Path $RunLog -Pattern "\[download\] Destination:"
    $RealNewDownloads = $DownloadEvents.Count
    Remove-Item $RunLog
}

if (Test-Path $ArchiveFile) { $CountEnd = @(Get-Content $ArchiveFile).Count } else { $CountEnd = 0 }

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "   STATISTIK SESI" -ForegroundColor Cyan
Write-Host " + Total Koleksi Lokal      : $CountEnd" -ForegroundColor Gray
Write-Host " + Lagu Baru Didownload     : $RealNewDownloads" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Tekan Enter untuk menutup..." -ForegroundColor DarkGray
Read-Host