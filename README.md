# Ayman Smart IPTV — iPhone PWA v1.1.0

A free installable IPTV web app for iPhone/iPad. No Apple Developer account and no 7-day signing renewal are required.

## v1.1.0 highlights

- Better iPhone fullscreen layout and safe-area handling
- Best-effort landscape lock where iOS/browser allows it, plus a rotate hint where it does not
- Smarter auto-hiding player controls
- FIT / FILL / ZOOM display modes with saved preference
- Screen Wake Lock while media is playing where supported
- Picture-in-Picture support where iOS exposes it
- Live channel zapping with Previous / Next controls
- Live swipe gestures: swipe horizontally to change channel
- VOD/Series gestures: swipe horizontally to seek; double-tap left/right for -10/+10 seconds
- Faster live startup with HLS -> TS fallback and a startup timeout
- Smart reconnect (1s -> 2s -> 4s) and automatic recovery after network returns
- Saved last section/category and a Play Last shortcut
- Improved Favorites and Continue Watching, including remove/clear controls
- 10-minute API cache and 250 ms search debounce
- Better image loading and mobile layout
- Improved error messages and retry UI
- Encrypted remembered credentials using Web Crypto when available

## Important iPhone limitation

A PWA cannot directly change the iPhone's system brightness or hardware volume. Those remain controlled by iOS / Control Center. v1.1.0 therefore uses gestures for seeking and live channel changes instead of pretending to control system brightness/volume.

## Updating an existing GitHub Pages install

Upload/replace these files in the same GitHub repository:
- `index.html`
- `app.js`
- `styles.css`
- `manifest.webmanifest`
- `sw.js`
- `README.md`

Keep your existing `cloudflare-worker/` and `icons/` folders. The existing Cloudflare Worker URL and `ALLOWED_HOST` variable do not need to change.

After GitHub Pages updates, fully close the Home Screen app and reopen it. If the old version is still cached, open the site once in Safari, refresh, then reopen the Home Screen app.

## Install on iPhone

Open the GitHub Pages URL in Safari, tap Share, choose **Add to Home Screen**, then open Ayman IPTV from the new icon.
