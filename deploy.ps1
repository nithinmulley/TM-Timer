Write-Host "Installing dependencies..." -ForegroundColor Green
npm install

Write-Host "Building project..." -ForegroundColor Green
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    exit 1
}

Write-Host "Cleaning up build artifacts..." -ForegroundColor Green
if (Test-Path ".vite") {
    Remove-Item ".vite" -Recurse -Force
}

Write-Host "Switching to gh-pages branch..." -ForegroundColor Green
git checkout gh-pages

Write-Host "Moving build files to root..." -ForegroundColor Green
if (Test-Path "docs") {
    Move-Item "docs\*" "." -Force
    Remove-Item "docs" -Recurse -Force
}

Write-Host "Committing changes..." -ForegroundColor Green
git add .
git commit -m "Deploy to GitHub Pages $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"

Write-Host "Pushing to remote..." -ForegroundColor Green
git push origin gh-pages

Write-Host "Switching back to source branch..." -ForegroundColor Green
git checkout source

Write-Host "Deployment complete!" -ForegroundColor Green