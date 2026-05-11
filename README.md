# TM Timer Web App

Configure the live agenda, assign speakers, and then run the meeting.

## Local development

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
```

The compiled site will be written to `dist/`.

## Deployment to GitHub Pages

The app is configured for deployment to GitHub Pages using the `gh-pages` branch.

### Automated deployment

Run the deployment script:

```powershell
.\deploy.ps1
```

This will:
- Build the project
- Switch to `gh-pages` branch
- Move build files to root
- Commit and push changes
- Switch back to `source` branch

### Manual deployment

1. Build the project: `npm run build`
2. Switch to gh-pages branch: `git checkout gh-pages`
3. Move build files: `mv docs/* .; rmdir docs`
4. Commit: `git add .; git commit -m "Deploy"`
5. Push: `git push origin gh-pages`
6. Switch back: `git checkout source`
