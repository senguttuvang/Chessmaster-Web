# How the reconstruction developed

This is a retrospective reconstructed from the private experiment's code,
specifications, tests and recovery records. The public Git history starts fresh
with reviewed source. It does not contain the private repository's commits or
objects, and no commit dates/authorship are fabricated to look historical.
The source snapshot and input-file hashes are recorded in
[the export manifest](provenance/source-export.json). Original game artifacts
and their private evidence remain outside this repository.

## 1. Preserve and understand the input

The starting point was a Windows installation, not an original source project.
Inventory PE modules, archive headers, indices, resource tables and personality
records without running installers or modifying originals. Retain hashes and
record unknowns. An index naming a file is not proof that its payload exists.
This later mattered for 20-byte narration archive placeholders.

## 2. Make The King play before reconstructing all rooms

The King is the playing engine, separate from Chessmaster's graphical program.
Use Ghidra function boundaries and static x86-to-C translation, adapted from the
Cricket 07 browser recompiler. The C keeps explicit x86 register/memory state;
the host implements only the Windows services reached by tested engine paths.
Compile native first, then Emscripten/Wasm. Unsupported paths trap instead of
silently substituting another engine.

Watcom-generated patterns exposed issues including F2-prefixed copies, segment
operations, unaligned callback tables and setjmp/longjmp continuations. Use
small synthetic instruction tests, original-x86 traces with Unicorn where
available, native protocol tests, and repeated browser searches to distinguish
translation defects from host API defects. Decompiled pseudocode is analysis
evidence; it is not the original source and is not compiled as the engine.

## 3. Recover data and rebuild presentation

Read original PE bitmaps, menus/dialog templates, strings and font resources.
Decode indexed archives with PKWARE-compatible blast where required. Convert
user-supplied DirectX meshes with Assimp and DDS textures with Pillow. Render
the recovered geometry in Three.js, while implementing browser controls in
TypeScript/DOM/CSS. Recovered artwork is different from recovered UI behaviour:
lighting, controls, layout and event timing remain reconstructed.

## 4. Teach and replay separately from legal engine play

Original lesson files contain nested directives, partial/kingless diagrams,
scripted moves and exercises. A lesson interpreter and replay controller must
represent those without forcing them through a legal-chess engine. Preserve
original directives locally; expose unsupported commands and malformed diagrams.
Only hand a valid position to The King on an explicit user action. Parse annotated
PGN into replayable games. Keep browser-local database/tournament state separate
from original proprietary database formats or historical rating rules.

## 5. Reconstruct remaining navigation honestly

Home/Kids reuse recovered artwork and source lessons; Database provides local
PGN workflows; Tournament supplies a local round robin. CM Live presents offline
evidence rather than pretending the old service is back. The interface is still
incomplete, especially lesson presentation, advanced animations and voice timing.
Live Windows observation remains an optional later evidence source.

## 6. Find the missing audio and preserve provenance

The first installation had real WAVs and a populated MOVES archive, but major
narration archives were only placeholders. Separate missing, undecoded and
unintegrated audio; don't describe all three as absent. New two-disc media is
being investigated in the private recovery lane. Transfer reviewed extraction
code and format knowledge here later, not proprietary audio payloads.

## 7. Separate research evidence from a community source release

The original experiment mixed new code with game binaries, generated engine C,
art and lessons. Keep that archive private. Export an explicit list of source
files, preserve upstream licenses, start clean history, and regenerate original
derivatives only from contributor-supplied media. Guard both the current tree
and history. A disclaimer cannot replace this boundary or grant missing rights.

This is binary-informed reconstruction, not a claim of clean-room development,
complete original source recovery, identical engine strength or legal clearance.
