# Ayman Smart IPTV — iPhone PWA v1.2.0

This release focuses on playback reliability and slow/buffering IPTV servers on iPhone.

## v1.2.0 streaming changes

- API timeout raised from 15s to 30s, with one automatic retry before showing an error.
- Longer startup grace: 20s for Live and 35s for Movies/Series, avoiding premature stream resets on slower servers.
- Stall watchdog: normal buffering is allowed to recover; the player only switches/reconnects after a sustained stall.
- Remembers the last working stream format for Live / Movies / Series.
- Live prefers native HLS (.m3u8) on iPhone, with TS as compatibility fallback.
- Movies/Series try the server-provided container first, then MP4 and HLS compatibility URLs when available. This improves compatibility but cannot transcode unsupported codecs.
- Smarter reconnect sequence (1.2s, 2.5s, 5s, 8s) and restarts from the best source instead of hammering one failed URL.
- Better preconnect/DNS hints for the IPTV origin.
- App-shell cache bumped to v1.2.0 so an installed Home Screen PWA receives the new player.

## Important iPhone limitation

A PWA uses Apple's native media stack. If a provider only supplies a codec/container iPhone does not decode (for example some MKV/codec combinations), the app cannot transcode it locally. The v1.2 player tries compatible alternate URLs when the IPTV server exposes them. Persistent buffering on the same channel/movie after this update normally points to the IPTV server/route itself rather than the UI.

## Update an existing GitHub Pages install

Replace the old root files with this release, commit, wait for GitHub Pages to deploy, then open the GitHub Pages URL in Safari once and refresh it. Close the Home Screen app completely and reopen it. The service worker uses a new cache name, so v1.2.0 replaces the old shell automatically after activation.

Your existing Cloudflare API Worker and ALLOWED_HOST setting do not need to change.
