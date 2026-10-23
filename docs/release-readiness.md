# Source-only release verification

Prepared 23 October 2026. Functional code checkpoint:
`579025ec` (use Git history for the full object ID).

## Contents and history

The new repository starts from a fresh initial commit and a reviewed source
export. No private archive Git objects or commits were imported. The manifest
records the source snapshot and hashes, while engineering-history.md explains
the retrospective sequence and decisions. The complete recovery archive remains
private under its separate internal name.

Tracked content is source, synthetic tests, licensed upstream tools, original
project documentation and dependency lockfiles. Original executable/media,
extracted art/font/models/audio/text, generated engine C/Wasm, decompilation,
function metadata, recovered JSON and local web builds remain ignored.
Source provenance and rights boundaries are documented; the automated guard
is not a substitute for review of source content or a legal opinion.

## Verification performed

- `make setup` installs locked JS/Python dependencies.
- A fresh Git clone, with no original executable or extracted asset directory,
  passes `make check`: 5 synthetic Python translation tests, 16 Bun tests,
  TypeScript typecheck, Vite build and source/history boundary scan.
- Local preparation reads a user-supplied installation, recovers resources and
  lessons, exports Ghidra function metadata and network analysis, and regenerates
  translated engine C. No generated instructions are copied from the old archive.
- `make check-media` passes 20 Python tests, 17 Bun tests and 24 real headless
  Chrome tests, including original engine replies. Native and Wasm builds,
  typecheck, production build and release guard also pass.
- Guard regressions prove that prohibited paths and binary content disguised as
  source are rejected even after removal from the latest tree.
- Redacted Gitleaks full-history scan of the code checkpoint reports no leaks.
  The new history scan covers approximately539KB, rather than the private
  archive's original-content history. Re-run on the exact final release refs.

Expected warnings: the media-free build cannot resolve original image/font URLs
until the user prepares their media; it is a source/build check, not a playable
asset-free game. The renderer bundle produces Vite's chunk-size warning. Emscripten
reports host rounding and pthread/memory-growth warnings; engine path and playing
strength limitations remain documented, not silently declared equivalent.

## Visibility and external state

The new repository is private during preparation. Global instructions reserve
the actual GitHub visibility switch for the user. After the reviewed PR is
merged, the manual location is:

https://github.com/senguttuvang/Chessmaster-Web/settings

General → Danger Zone → Change repository visibility → Public.

The configured GitHub Guard allowlist was updated to add exactly `Chessmaster-Web`,
then read back. No existing entries were removed; the internal archive was not
allowlisted. The previous baseline and rollback instructions are retained privately.
No credentials, account configuration or baseline contents belong in this repo.

After the manual switch, verify anonymous repository access and GitHub secret
scanning/push-protection availability. Public visibility does not grant rights
to proprietary game content. No social posts or production website changes
were performed as part of this source split.
