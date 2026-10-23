# Credits and third-party notices

- **Chessmaster 9000:** original Ubi Soft/Ubisoft developers, artists, teachers,
  performers and contributors. Their original game content is not bundled here.
- **The King:** Johan de Koning's original chess engine. It is not replaced by
  Stockfish or chess.js; the local workflow translates the user's own executable.
- **Dhaiwat Pandya:** [Cricket 07 browser port](https://github.com/Dhaiwat10/cricket07-browser),
  the inspiration and starting point for the static recompiler. Vendored code
  and local Watcom adaptations retain the
  [upstream MIT license](vendor/cricket-recompiler/LICENSE) and
  [revision provenance](vendor/cricket-recompiler/UPSTREAM.md).
- **Mark Adler:** blast decompression. Preserve the copyright and distribution
  terms embedded in [blast.h](vendor/blast/blast.h).
- **Three.js:** MIT-licensed 3D rendering; no original game geometry is included.
- **chess.js:** BSD-2-Clause-licensed legality/notation library; not the playing engine.
- **Effect:** MIT-licensed application utilities.
- **Bun, Vite, TypeScript, Playwright, Python, Emscripten, Ghidra, Capstone,
  Unicorn, pefile, Pillow and Assimp:** development, analysis, testing, compilation
  and conversion tools, each under its own distribution terms.

Package dependencies are versioned in bun.lock and uv.lock. Their installed
distributions retain full license texts. The root MIT license does not replace
any third-party license. Any redistributed dependency bundle must retain its
required notices. Licenses do not extend to EA's or Ubisoft's game content.
