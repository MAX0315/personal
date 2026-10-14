# Bundled FFmpeg WebAssembly core

This directory contains the **unmodified single-thread UMD build of `@ffmpeg/core@0.12.10`**. It is loaded locally by `audio-worker.js`. No CDN, remote JavaScript, media upload, SharedArrayBuffer, or cross-origin-isolation setup is required at runtime.

## Provenance and integrity

- Publisher package: https://www.npmjs.com/package/@ffmpeg/core/v/0.12.10
- Exact npm tarball: https://registry.npmjs.org/@ffmpeg/core/-/core-0.12.10.tgz
- npm SHA-512 integrity: `sha512-dzNplnn2Nxle2c2i2rrDhqcB19q9cglCkWnoMTDN9Q9l3PvdjZWd1HfSPjCNWc/p8Q3CT+Es9fWOR0UhAeYQZA==`
- `ffmpeg-core.js` SHA-256: `b266ab5b952555881dd6310663986994a182acb2b7ff25cf10a25f7a37ac2b21`
- `ffmpeg-core.wasm` SHA-256: `9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7`
- Source/build repository release commit: https://github.com/ffmpegwasm/ffmpeg.wasm/commit/71aa99d37c02a7b4c435275ca9ef50e612f6efa1
- Release source archive: https://github.com/ffmpegwasm/ffmpeg.wasm/archive/71aa99d37c02a7b4c435275ca9ef50e612f6efa1.tar.gz
- Release source tree / build scripts: https://github.com/ffmpegwasm/ffmpeg.wasm/tree/71aa99d37c02a7b4c435275ca9ef50e612f6efa1
- FFmpeg source used by the release Dockerfile: https://github.com/FFmpeg/FFmpeg/tree/n5.1.4

The npm package's original `package.json` is included. The matching upstream `UPSTREAM-Dockerfile` lists all enabled libraries, source URLs, and build refs. Upstream uses some mutable branch refs; this package does not claim a reproducible byte-for-byte build from today's branch heads.

## Copyright and licenses

The npm package declares **GPL-2.0-or-later**. The bundled WebAssembly build enables GPL libraries. It must not be described as wholly MIT-licensed merely because the JavaScript wrapper repository contains an MIT license.

- `COPYING.GPLv2`: full GNU GPL version 2 text from FFmpeg n5.1.4.
- `COPYING.LGPLv2.1`: full GNU LGPL version 2.1 text from FFmpeg n5.1.4.
- `LICENSE-FFmpeg.md`: upstream explanation of FFmpeg and optional-library licensing.
- `LICENSE-wrapper-MIT.txt`: upstream ffmpeg.wasm wrapper repository license; does not supersede the core's GPL declaration.
- `licenses/`: upstream license/copyright texts for the enabled dependencies. `licenses/sources.json` records each document URL and the corresponding source repository/ref used in the release Dockerfile. These files retain their upstream copyright notices. zlib's notice is contained in its upstream README.

Retrieved from the official npm registry and upstream source repositories on 2026-09-23. No modifications were made to the bundled core JavaScript or WASM binaries.

## Re-acquisition

Run `npm pack @ffmpeg/core@0.12.10` and extract `package/dist/umd/ffmpeg-core.js`, `package/dist/umd/ffmpeg-core.wasm`, and `package/package.json`. Verify the hashes above. The package archive itself does not contain full license texts, so preserve the license and provenance files in this directory when redistributing this bundled core.
