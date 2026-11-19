# Push this project to GitHub, run the ios-build workflow, download the unsigned IPA.
#
# Usage (from repo root):
#   powershell -ExecutionPolicy Bypass -File tools\github_build.ps1 -Token ghp_xxx
#   powershell -ExecutionPolicy Bypass -File tools\github_build.ps1 -Token ghp_xxx -Repo nengmao-kebiao-ios -Private
#
# Token scopes: classic PAT -> repo + workflow. Fine-grained -> Contents RW, Actions RW, Workflows RW.
#
# What it does:
#   1. GET /user to verify the token
#   2. create the repo (reuse if it exists)
#   3. git init -> remote with token -> commit -> push
#   4. poll the Actions run until it finishes, print failed steps
#   5. download the nengmao-kebiao-ios artifact and unpack NengmaoKeBiao-unsigned.ipa into dist-ipa\
#
# ASCII-only on purpose: Windows PowerShell 5.1 reads .ps1 as ANSI.

param(
    [Parameter(Mandatory = $true)][string]$Token,
    [string]$Repo = 'nengmao-kebiao-ios',
    [switch]$Private,
    [string]$Branch = 'main'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$apiBase = 'https://api.github.com'
$headers = @{
    Authorization          = "Bearer $Token"
    Accept                 = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = '2022-11-28'
    'User-Agent'           = 'nengmao-build-script'
}

function Invoke-GH {
    param([string]$Method, [string]$Path, $Body)
    $req = @{ Method = $Method; Uri = "$apiBase$Path"; Headers = $headers }
    if ($null -ne $Body) {
        $req.Body = ($Body | ConvertTo-Json -Depth 10)
        $req.ContentType = 'application/json'
    }
    return Invoke-RestMethod @req
}

Write-Host '== 1. verify token ==' -ForegroundColor Cyan
$me = Invoke-GH GET '/user'
$owner = $me.login
Write-Host "   logged in as: $owner"

Write-Host '== 2. create repo (reuse if exists) ==' -ForegroundColor Cyan
$fullName = "$owner/$Repo"
try {
    Invoke-GH GET "/repos/$fullName" | Out-Null
    Write-Host "   $fullName already exists"
} catch {
    $isPrivate = [bool]$Private
    Invoke-GH POST '/user/repos' @{ name = $Repo; private = $isPrivate; auto_init = $false } | Out-Null
    Write-Host "   created $fullName"
}

Write-Host '== 3. push code ==' -ForegroundColor Cyan
if (-not (Test-Path (Join-Path $root '.git'))) {
    git init | Out-Null
    git checkout -b $Branch 2>$null | Out-Null
}
git config user.email 'build@local' | Out-Null
git config user.name 'nengmao builder' | Out-Null
git add -A
git commit -m 'build: nengmao kebiao ios snapshot' 2>$null | Out-Null

$remote = "https://x-access-token:$Token@github.com/$fullName.git"
git remote remove origin 2>$null | Out-Null
git remote add origin $remote
git push -u origin "$Branch" --force
if ($LASTEXITCODE -ne 0) { throw 'git push failed' }

Write-Host '== 4. wait for Actions ==' -ForegroundColor Cyan
$run = $null
for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 10
    $runs = Invoke-GH GET "/repos/$fullName/actions/runs?branch=$Branch&per_page=5"
    $run = $runs.workflow_runs | Where-Object { $_.event -eq 'push' } | Select-Object -First 1
    if ($run -and $run.status -ne 'queued' -and $run.status -ne 'in_progress') { break }
    if ($run) { Write-Host "   [$i] status=$($run.status)" }
}

if (-not $run) { throw 'No workflow run found. Is .github/workflows/ios-build.yml pushed to the default branch?' }
Write-Host "   run: $($run.html_url)"
Write-Host "   conclusion: $($run.conclusion)"

if ($run.conclusion -ne 'success') {
    Write-Host '== failing steps ==' -ForegroundColor Yellow
    $jobList = Invoke-GH GET "/repos/$fullName/actions/runs/$($run.id)/jobs"
    foreach ($job in $jobList.jobs) {
        foreach ($step in $job.steps) {
            if ($step.conclusion -eq 'failure') {
                Write-Host "   FAILED: $($step.name)  (job: $($job.name))" -ForegroundColor Red
            }
        }
    }
    Write-Host '   open the run link above for full logs.' -ForegroundColor Yellow
}

Write-Host '== 5. download artifact ==' -ForegroundColor Cyan
$artList = Invoke-GH GET "/repos/$fullName/actions/runs/$($run.id)/artifacts"
$art = $artList.artifacts | Where-Object { $_.name -eq 'nengmao-kebiao-ios' } | Select-Object -First 1
if (-not $art) {
    Write-Host '   artifact not found (build probably failed)' -ForegroundColor Yellow
    exit 1
}

$outDir = Join-Path $root 'dist-ipa'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$zip = Join-Path $outDir 'artifact.zip'
$artUrl = "$apiBase/repos/$fullName/actions/artifacts/$($art.id)/zip"
Invoke-WebRequest -Uri $artUrl -Headers $headers -OutFile $zip -MaximumRedirection 5
Expand-Archive -Path $zip -DestinationPath $outDir -Force

$ipa = Get-ChildItem $outDir -Recurse -Filter '*.ipa' | Select-Object -First 1
if ($ipa) {
    $sizeMb = [math]::Round($ipa.Length / 1MB, 1)
    Write-Host "   IPA: $($ipa.FullName)  ($sizeMb MB)" -ForegroundColor Green
    Write-Host '   next: feed this .ipa to Sideloadly (Windows) with your Apple ID to sign and install.'
} else {
    Write-Host '   no .ipa inside the artifact; check the run log.' -ForegroundColor Yellow
}