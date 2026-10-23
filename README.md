# Chessmaster-Web

**[Play in your browser](https://chessmaster9000.com/)**

An unofficial, source-only reconstruction of Chessmaster 9000 for modern browsers.
**Bring your own game media.** This repository contains new browser/host code,
licensed porting tools and recovery procedures. It contains no game executable,
extracted artwork, lesson text, voices or translated engine code.

The original The King engine can run locally as WebAssembly after you generate
the required code from your supported installation. Three.js renders the pieces
you extract; chess.js handles legal input and notation. The browser controls and
room navigation are reimplemented. This is an AI-assisted project built with
Codex, inspired by and using tooling from
[Dhaiwat Pandya's Cricket 07 port](https://github.com/Dhaiwat10/cricket07-browser).

The reconstruction includes a playable Game Room, original-data lesson replay,
Library, Home/Kids navigation, local PGN Database and local round-robin Tournament.
CM Live is offline evidence, not a restored online service. Original UI timing,
advanced lesson commands, opening books, tablebases, historical ratings and audio
integration are incomplete. Full engine equivalence/playing strength is unverified.
Unvisited engine paths can trap. No Windows VM is needed for the tested slice.

## Build using your own installation

Verified development platform: macOS ARM64. Install Bun, uv, a C compiler,
Emscripten (emcc on PATH), Ghidra12.2, compatible JDK25 and Assimp (`assimp` on
PATH). Google Chrome is needed for integration tests. Supported engine: The King
3.23, SHA-256 `9bd6c1b16251e3a462c61c63b4811605a6072fbeb2311ebe7c05842dd0bfc236`.
Other editions/engine builds fail explicitly; they are not silently substituted.

```sh
make setup
make check                      # source-only tests, no game files needed

# Supply an extracted/installed copy you own; this does not run its installer.
# Set JAVA_HOME and GHIDRA for your installed JDK/Ghidra as necessary.
make prepare-media GAME_DIR=/absolute/path/to/Chessmaster9000
make check-media                # native + Wasm + full media/browser integration
make dev                        # http://127.0.0.1:9000
```

`prepare-media` validates the input files/build, extracts resources, converts
models, builds content manifests, runs Ghidra on an analysis copy, and translates
the engine locally. It never modifies your installation. An ISO/ZIP alone is not
an installation: extract/install your own discs first. No game download is provided.
See [the detailed procedure](docs/reconstruction.md) for the file boundary and
toolchain, including the macOS ARM64 Ghidra decompiler procedure if needed.

All generated game-derived files live in ignored paths. Do not commit or publish
them, including locally generated C/Wasm, engine executable, recovered JSON,
audio, font, images or models. A locally built web bundle includes those outputs;
hosting it is a separate distribution decision, not authorized by the MIT license.

## History, contribution and rights

Ongoing maintainer work and deployment to `chessmaster9000.com` use a separate
private internal repository. This community copy receives reviewed source-only
exports and has no production deployment configuration.

- [Engineering history](docs/engineering-history.md): development milestones and
  the limits of the filtered source history.
- [Architecture and recovery procedure](docs/reconstruction.md).
- [Contribution and release boundaries](CONTRIBUTING.md).
- [MIT license](LICENSE): this project's original code/docs only.
- [Copyright/trademark notice](COPYRIGHT.md) and [third-party credits](THIRD_PARTY_NOTICES.md).

Chessmaster and original game content belong to Ubisoft and their respective
rights holders. This project is not affiliated with or endorsed by Ubisoft.
