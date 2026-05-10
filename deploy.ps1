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

Write-Host "Switching to gh-pages branch..." -ForegroundColor Green
git checkout gh-pages

if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to checkout gh-pages branch." -ForegroundColor Red
    exit 1
}

Write-Host "Cleaning old deployment files..." -ForegroundColor Green
Get-ChildItem -Force | Where-Object { $_.Name -notin '.git', '.gitignore', 'CNAME', 'README.md' } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Copying build output to branch root..." -ForegroundColor Green
Copy-Item -Recurse "docs\*" "." -Force -ErrorAction Stop

if (Test-Path "docs") {
    Remove-Item "docs" -Recurse -Force -ErrorAction SilentlyContinue
}

if (Test-Path "dist") {
    Remove-Item "dist" -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Committing changes..." -ForegroundColor Green
git add -A
git commit -m "Deploy to GitHub Pages $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"

Write-Host "Pushing to remote..." -ForegroundColor Green
git push origin gh-pages

Write-Host "Switching back to source branch..." -ForegroundColor Green
git checkout source

Write-Host "Deployment complete!" -ForegroundColor Green