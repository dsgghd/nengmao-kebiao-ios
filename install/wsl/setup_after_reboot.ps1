# Run AFTER reboot: switch the distro to WSL2 (if possible) and build with xtool.
#
# State so far (already done before this reboot):
#   - Microsoft-Windows-Subsystem-Linux : enabled
#   - VirtualMachinePlatform            : enabled (dism 3010 = reboot required)
#   - distro "NengmaoLinux" imported as WSL1 from ubuntu-22.04 base rootfs
#   - /opt/swift (6.0.3 linux toolchain, 2.5 GB) already extracted inside the distro
#   - %USERPROFILE%\sdks\xtool\xtool-x86_64.AppImage verified by sha256
#
# Usage (elevated PowerShell):
#   powershell -ExecutionPolicy Bypass -File install\wsl\setup_after_reboot.ps1
#
# ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 as ANSI.

$ErrorActionPreference = 'Continue'
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$distro = 'NengmaoLinux'
$env:WSL_UTF8 = '1'

Write-Host '== 1. WSL status ==' -ForegroundColor Cyan
& wsl.exe --status 2>&1 | Out-String | Write-Host
& wsl.exe --list --verbose 2>&1 | Out-String | Write-Host

Write-Host '== 2. Try to move the distro to WSL2 ==' -ForegroundColor Cyan
$ver = (& wsl.exe -d $distro -- bash -c 'uname -r' 2>&1 | Out-String).Trim()
Write-Host "  current kernel: $ver"

if ($ver -like '*Microsoft*' -and $ver -like '4.4*') {
    Write-Host '  still WSL1; attempting conversion to WSL2' -ForegroundColor Yellow
    & wsl.exe --set-version $distro 2 2>&1 | Write-Host
    if ($LASTEXITCODE -ne 0) {
        Write-Host '  conversion failed; installing the WSL2 kernel package and retrying' -ForegroundColor Yellow
        $msi = Join-Path $env:TEMP 'wsl_update_x64.msi'
        if (-not (Test-Path $msi)) {
            try {
                Invoke-WebRequest -Uri 'https://wslstorestorage.blob.core.windows.net/wslblob/wsl_update_x64.msi' -OutFile $msi -UseBasicParsing -TimeoutSec 300
            } catch {
                Write-Host "  kernel package download failed: $($_.Exception.Message)" -ForegroundColor Red
            }
        }
        if (Test-Path $msi) {
            & msiexec.exe /i $msi /quiet /norestart | Out-Null
            Start-Sleep -Seconds 10
            & wsl.exe --set-default-version 2 2>&1 | Write-Host
            & wsl.exe --set-version $distro 2 2>&1 | Write-Host
        }
    }
    $ver = (& wsl.exe -d $distro -- bash -c 'uname -r' 2>&1 | Out-String).Trim()
    Write-Host "  kernel after conversion: $ver"
} else {
    Write-Host '  already on WSL2' -ForegroundColor Green
}

Write-Host '== 3. Build with xtool inside WSL ==' -ForegroundColor Cyan
$repoWsl = '/mnt/' + ($root.Substring(0, 1).ToLower()) + ($root.Substring(2) -replace '\\', '/')
& wsl.exe -d $distro -u root -- bash "$repoWsl/install/wsl/inside_wsl_build.sh"
Write-Host 'Done. See the xtool output above for the .app/.ipa path.' -ForegroundColor Green