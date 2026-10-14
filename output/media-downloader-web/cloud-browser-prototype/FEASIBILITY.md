# Netlify cloud browser feasibility

Verified 2026-10-12 with an isolated draft on the existing Netlify site. Production was not changed.

Official references:

- [Netlify Functions configuration](https://docs.netlify.com/build/functions/configuration/): default 1024 MB and 60-second synchronous execution; increasing memory requires a qualifying paid plan.
- [Netlify's browser prerendering example](https://github.com/netlify/browser-prerendering-example): uses Sparticuz Chromium for Netlify/Lambda compatibility.
- [Sparticuz Chromium](https://github.com/Sparticuz/chromium): Linux-only serverless binary, externalize package in bundlers; 512 MB minimum and 1600 MB recommended.
- [Puppeteer browser compatibility](https://pptr.dev/supported-browsers): Puppeteer 25.11.0 matches Chromium 153. Installed exact versions @sparticuz/chromium 153.0.0 and puppeteer-core 25.11.0.

The resulting function ZIP is 70,988,304 bytes and deployed successfully to the existing free-account site. No additional service or paid memory was enabled.

## Real cloud evidence

Draft endpoint: `https://6accf12f19a40a5fbd15b1b6--anma-media-tool-20261012.netlify.app/.netlify/functions/probe`. POST JSON contains only `pageUrl`.

- Screenshot share `https://v.douyin.com/Z0wh2LKx4MI/`: real Linux Node 22 Chromium obtained target ID 7568826746301189418, native official detail response 200, 33 candidates on cold start. Chromium extraction 4349 ms; launch 4589 ms; total resolution 24155 ms. Warm resolution 14863 ms, 37 candidates.
- Independent public work `https://www.douyin.com/video/7676489080318171889`: native official detail response 200; 22 candidates; 12554 ms on a warm runtime.
- Full screenshot video from the cloud-generated CDN address downloaded with no imported account cookies: 7,301,287 bytes, 1080×1932, H.264/AAC, 18.566667 seconds; byte count matches Content-Length; full ffmpeg decode passed.
- Full independent video downloaded: 1,152,428 bytes, 576×1024, H.264/AAC, 10.083333 seconds; full ffmpeg decode passed.

No fabricated network responses, user Chrome profiles, imported cookies, CAPTCHA solving, stealth patches or signature-generation services were used. Initial prototype used the package's unmodified recommended flags, which include `--disable-web-security`; integrated production source removes that flag and `--allow-running-insecure-content`.

The filtered implementation was reverified in standalone draft `6accf3bd29c59d621fef51e3` through the actual webpage controls, with no extension API shims and no installed extension. Screenshot video cloud resolution took 25,017 ms, returned 37 exact-target candidates and displayed 1080×1932/18.566667-second browser preview. The Save Video button downloaded 7,301,287 bytes and full decode passed. The independent target took 15,452 ms, returned 22 exact-target candidates and displayed 720×1280/10.083333-second preview; Save Video produced 1,398,651 bytes and full decode passed. See standalone `qa/standalone-douyin-ui.json`.

A Bilibili request exposed a distinct CDN inactivity limit: HTTP 504 at about 30.6 seconds with HTML Inactivity Timeout. The official [modern Functions API](https://docs.netlify.com/build/functions/api/) describes a 60-second execution window, but the current live site also truncated a streamed response near 30 seconds. The implementation sends JSON whitespace immediately and every 5 seconds; it now has a 26-second resolver budget and a 25-second final-JSON guard, so slow requests finish with an honest timeout rather than an incomplete whitespace-only body. Public HTTP fallback on eligible non-Bili providers is separately aborted after 8 seconds. Streaming bytes do not represent task success.

Draft3 `6accf8fb0003b415d3ef135f` verified both Douyin targets with the shorter budget: screenshot cold cloud resolution 22,663 ms; independent target 15,422 ms. Both actual website Save Video downloads passed complete decode. The browser playback progressed past 0.5 seconds before real UI screenshots were captured.

Bilibili BV1uK42187Uo is downloadable in an ordinary isolated Windows browser, but the actual Netlify Linux browser's top-level navigation returned HTTP 412. No access checks were bypassed. Cloud Bili extraction is therefore **not verified** and must not be claimed to work universally. The source now returns a truthful PLATFORM_RESTRICTED error immediately on normal top-level Bili HTTP 401/403/412. See standalone `qa/bilibili-netlify-live-qa.json`.

Reports intentionally omit complete signed CDN query strings. Chromium, cookies and pages are newly created per request; only the unchanging binary can be reused in Lambda `/tmp`.

## Implementation boundary

This demonstrates standalone extraction for real publicly accessible platform works. Site login does not grant access to another platform's protected login session. Private, member-only, CAPTCHA-limited, DRM, deleted and other unavailable works must produce an honest unsupported response. A bare Netlify page cannot promise every video from every platform.

Cloud-generated media sometimes uses `*.zjcdn.com`, which is absent from the old site's media allowlist. The standalone policy must allow the validated provider domain, retain per-hop public-address protection and keep usable source fallback. The old Edge proxy rejected zjcdn as expected; direct download verified its actual media signature and complete decode. Proxy/website delivery still requires the standalone draft QA.
