$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$deployWorktree = Join-Path $scriptRoot ".gh-pages-worktree"

Write-Host "Installing dependencies..." -ForegroundColor Green
npm install

Write-Host "Building project..." -ForegroundColor Green
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    exit 1
}

Write-Host "Cleaning local build cache..." -ForegroundColor Green
if (Test-Path ".vite") {
    Remove-Item ".vite" -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path $deployWorktree) {
    Write-Host "Removing existing gh-pages worktree..." -ForegroundColor Yellow
    git worktree remove --force $deployWorktree | Out-Null
    Remove-Item $deployWorktree -Recurse -Force -ErrorAction SilentlyContinue
}

git worktree prune | Out-Null

Write-Host "Creating gh-pages worktree..." -ForegroundColor Green
git worktree add --checkout $deployWorktree gh-pages

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to create gh-pages worktree." -ForegroundColor Red
    exit 1
}

Write-Host "Cleaning old deployment files in worktree..." -ForegroundColor Green
Get-ChildItem -Path $deployWorktree -Force | Where-Object { $_.Name -notin '.git' } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Copying build output to worktree..." -ForegroundColor Green
Copy-Item -Path (Join-Path $scriptRoot 'docs\*') -Destination $deployWorktree -Recurse -Force -ErrorAction Stop

Set-Location $deployWorktree

Write-Host "Committing changes..." -ForegroundColor Green
git add -A
if ((git status --porcelain) -ne '') {
    git commit -m "Deploy to GitHub Pages $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
} else {
    Write-Host "No changes to commit." -ForegroundColor Yellow
}

Write-Host "Pushing to remote..." -ForegroundColor Green
git push origin gh-pages --force

Set-Location $scriptRoot

Write-Host "Removing temporary worktree..." -ForegroundColor Green
git worktree remove --force $deployWorktree | Out-Null

Write-Host "Deployment complete!" -ForegroundColor Green