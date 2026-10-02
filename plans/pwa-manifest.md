# Installable app shell (manifest + icons)

Branch: `chore/pwa-manifest`

## What this is
Not a service worker, not offline mode. Just the metadata that makes "Add to Home Screen" on iPhone/Android produce a real app icon and name instead of a Vite logo titled "NBA fantasy league app". 12 users open this from their phones daily.

## Change
- `frontend/public/manifest.webmanifest`: `name: "Fantasy League"`, `short_name`, `start_url: "/"`, `display: "standalone"`, `background_color`/`theme_color` matching the app's light nav, icons 192/512 PNG + `maskable`.
- `frontend/public/icons/`: 192, 512, apple-touch 180. Source: one SVG (basketball on the nav's blue) exported via a tiny node script (`scripts/make-icons.mjs` using `sharp` as a devDependency) so icons are reproducible.
- `frontend/index.html`: `<title>Fantasy League</title>`, `<link rel="manifest">`, `<link rel="apple-touch-icon">`, `<meta name="theme-color">` with `media="(prefers-color-scheme: dark)"` variant, `<meta name="apple-mobile-web-app-capable">`.
- Replace `vite.svg` favicon with the new SVG.

## Verification
- Chrome DevTools → Application → Manifest shows no warnings.
- iPhone Safari share → Add to Home Screen → icon and name correct; opens without browser chrome.

## Out of scope
Service worker / offline caching. Adds update-staleness risk with no user request behind it.
