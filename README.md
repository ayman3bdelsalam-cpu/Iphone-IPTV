# Ayman Smart IPTV — iPhone PWA v1.0.0

Free iPhone/iPad web app version of Ayman Smart IPTV. No Apple Developer account, App Store, IPA signing, or 7-day refresh is required.

## Features

- Xtream Codes login
- Live TV, Movies, Series and episodes
- Categories, global search, favorites, Continue Watching
- Native iPhone video playback (HLS first, TS fallback for Live)
- FIT / FILL / ZOOM with saved preference
- Auto-hidden player controls
- Screen Wake Lock when supported by iOS
- Picture-in-Picture when supported by the device/browser
- Audio-track and subtitle selectors when exposed by Safari
- Smart reconnect: 1s → 2s → 4s
- 5-minute API/list cache, 250–300ms search debounce
- Resume saved every 45 seconds and when leaving the player
- Login can be remembered locally using Web Crypto (AES-GCM)
- Offline app shell via Service Worker
- Same Ayman Smart IPTV visual identity as the LG/Android build

## Publish free with GitHub Pages

1. Create a new repository, e.g. `AymanIPTV-iPhone`.
2. Upload **the contents of this folder** to the repository root (do not upload the ZIP itself).
3. Go to **Settings → Pages**.
4. Under **Build and deployment → Source**, choose **GitHub Actions**.
5. Open **Actions → Deploy iPhone PWA**. It should deploy automatically after the upload; if not, choose **Run workflow**.
6. When the workflow is green, open the deployment URL shown by GitHub.

## Install on iPhone

Open the GitHub Pages URL in **Safari** → Share → **Add to Home Screen** → enable **Open as Web App** if shown → Add.

## If login says Failed to fetch / CORS

Many Xtream servers allow TVs/apps but block browser JavaScript API requests. The PWA includes a small optional Cloudflare Worker proxy for **API JSON only**. Video is still streamed directly from the IPTV server.

1. Create a free Cloudflare Worker.
2. Paste `cloudflare-worker/worker.js` into it.
3. Add a Worker variable named `ALLOWED_HOST` with only your IPTV server hostname, for example `example.com` (no `https://`, no port).
4. Deploy the Worker.
5. In Ayman IPTV → Connection settings, paste the Worker URL, for example `https://your-worker.workers.dev`.

The Worker intentionally proxies only `/player_api.php` and only the hostname you allow, so it is not an open public proxy.

## iPhone limitations

Apple does not give PWAs the same orientation control as native App Store apps on every iOS version. The player tries to request landscape, shows a rotate hint when needed, and fills the available standalone app viewport. Full native video fullscreen/PiP behavior ultimately follows the iOS version and device settings.

A raw `.ts` live stream may not be playable by Safari on every server. The app tries `.m3u8` first and then `.ts`. For best iPhone compatibility, the IPTV provider should expose HLS (`m3u8`).
