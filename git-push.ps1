
# Bear Cave - GitHub Sync
# Windows PowerShell version

$ErrorActionPreference = "Stop"

$ProjectDir = "C:\Users\Ford\Desktop\Projects\bear-cave"

Write-Host "====================================" -ForegroundColor Cyan
Write-Host "     Bear Cage - GitHub Sync" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan

if (-not (Test-Path $ProjectDir)) {
    Write-Host "ERROR: Project directory not found." -ForegroundColor Red
    exit 1
}

Set-Location $ProjectDir

# Verify repository
git rev-parse --is-inside-work-tree *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Not a Git repository." -ForegroundColor Red
    exit 1
}

# Check GitHub remote
git remote get-url origin *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: GitHub remote not configured." -ForegroundColor Red
    exit 1
}

# Check for changes
$changes = @(git status --porcelain)

if ($changes.Count -gt 0) {
    Write-Host "`nChanged files:" -ForegroundColor Yellow
    git status --short

    $confirm = Read-Host "`nStage and commit all changes? [y/N]"

    if ($confirm -notmatch '^[Yy]$') {
        Write-Host "Cancelled."
        exit 0
    }

    git add -A
    if ($LASTEXITCODE -ne 0) { exit 1 }

    $message = Read-Host "Commit message [Update Bear Cave]"
    if ([string]::IsNullOrWhiteSpace($message)) {
        $message = "Update Bear Cave"
    }

    git commit -m $message
    if ($LASTEXITCODE -ne 0) { exit 1 }
}
else {
    Write-Host "`nNo local changes to commit." -ForegroundColor Green
}

# Push current branch
Write-Host "`nPushing to GitHub..." -ForegroundColor Cyan

git push -u origin HEAD

if ($LASTEXITCODE -ne 0) {
    Write-Host "`nPush failed. Check GitHub authentication or remote changes." -ForegroundColor Red
    exit 1
}

Write-Host "`n====================================" -ForegroundColor Green
Write-Host "  GitHub synchronization complete!" -ForegroundColor Green
Write-Host "====================================" -ForegroundColor Green

Read-Host "`nPress Enter to close"
