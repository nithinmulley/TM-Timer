# TM Timer Web App

This project is now a small React web app intended for browser hosting, including SharePoint-friendly static hosting.

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

## SharePoint hosting notes

1. Build the app with `npm run build`.
2. Upload the contents of `dist/` to a SharePoint document library or another static hosting location available to your SharePoint site.
3. Surface the built app inside SharePoint with an Embed web part, an iframe-friendly page, or a site link depending on your tenant rules.
4. Open the same app URL with `?view=projector` appended if you want the projector screen in a separate browser tab.

## Embedded agenda

The meeting flow is now embedded directly in [`src/meetingFlow.js`](c:/Users/Nithi/Documents/Projects/toastmasters_timer_app/src/meetingFlow.js), so the app no longer depends on `MeetingFlow.txt`.
