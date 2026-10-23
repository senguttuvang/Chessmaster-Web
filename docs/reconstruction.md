# Reproduce from your own media

## Boundaries

Tracked: new host/browser code, synthetic tests, format readers, static analysis
scripts and properly licensed upstream tooling. Local-only: original executables,
archive payloads, extracted images/models/font/lessons/audio, Ghidra outputs,
function metadata, generated C and compiled native/Wasm/web bundles.

`make prepare-media GAME_DIR=/absolute/installation` validates an installed copy
and supported engine hash, copies only the engine into ignored `vendor/original`,
and otherwise reads originals directly without editing them. The ignored
`build/media-inputs.json` records source filenames, sizes and hashes without
recording your absolute path. Profile directories under USERS are not imported.

The expected installed files include THEKING.EXE, CHESSMAS.EXE, GUIRESOU.DLL,
CUSTOMGU.DLL, CM256.DLL, FACES/CMSETS/ANIM DAT/IDX pairs, CM9000.TTF,
CLASSICG.PGN, PERSONAL/*.CMP, TUTORIAL/*.TUT and database/network module files.
This version expects the English names/build used by the original experiment.
It does not execute an installer or bypass copy protection. Unsupported or
incomplete media must produce an actionable error.

## Toolchain

Install Bun, uv, Emscripten, a native compiler, Assimp, Ghidra and a compatible
JDK; use `make setup` for locked Python/JS dependencies. The tested platform is
macOS ARM64, with Ghidra12.2 and JDK25. Point `GHIDRA` at the Ghidra distribution
root and set `JAVA_HOME` for the JDK if your default differs. Example Homebrew
locations on the tested machine:

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home
export GHIDRA=/opt/homebrew/opt/ghidra/libexec
make prepare-media GAME_DIR=/absolute/path/to/your/installation
```

If Ghidra lacks an ARM64 decompiler, `sh tools/build_ghidra_decompiler.sh
"$GHIDRA"` builds it under ignored build output and prints the exact install
command. Do not mistake a successful build for a successful analysis export.

## Pipeline

1. `tools/media.ts` validates required files before staging any payload. It records
   input hashes and runs the established resource/archive/content recovery tools.
2. `recover.py`, `recover_ui.py`, `recover_room_art.py` read local archive indices
   and PE resources. blast handles supported compressed records; Pillow decodes
   images; Assimp converts original meshes. Conversion provenance stays local.
3. `recover_content.py` preserves lesson text/directives and the source PGN.
   `recover_games.ts` validates replay; `content_coverage.ts` reports unsupported
   lesson semantics. `room_evidence.py` and `prepare_room_evidence.ts` create
   local offline evidence, not network connections.
4. `normalize_pe.py` changes section metadata only in an analysis copy.
   Ghidra `ExportFunctions.java` regenerates function ranges/jump-table targets.
   `x86toc.py` translates the user's original executable to ignored generated C.
5. `make native wasm` compiles that generated code with the explicit host.
   `make check-media` runs real engine and browser integration. `make dev` serves
   the recovered app locally with COOP/COEP headers for shared Wasm memory.

Optional analysis scripts can export inferred UI/engine/network pseudocode or
trace the original x86; keep those generated outputs ignored. They are evidence,
not original source. The runtime does not use recovered pseudocode.

## Verification

`make check` is the required media-free gate: synthetic translation tests,
protocol/replay/database/tournament tests, release-boundary tests, typecheck and
build. It does not claim original-game integration passed. `make check-media`
adds the local native/Wasm build, all recovery tests and real headless Chrome
gameplay/room tests on isolated port9061. Missing media is a failure, not a skip.

Before any release, stage only reviewed source and run `bun tools/release/check.ts`
plus a redacted full-history secret scan. The boundary guard rejects original
and generated paths in both staged/tracked files and history. Manually review
source content too: filenames and secret scanners cannot prove ownership.

The hosted experiment at chessmaster9000.com is separate from this source-only
repository. Do not copy its payloads into contributions or use the MIT license
as permission to redistribute game-derived builds.
