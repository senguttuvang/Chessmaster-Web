# Source-only release contract

User intent: retain complete private recovery evidence as chessmaster-web-internal;
prepare Chessmaster-Web with fresh history, source/tooling, reconstructed thought
process and a requirement that users supply their own media.

No original game payloads, extracted art/text/audio/models/font, generated engine
instructions, decompiled code, old Git objects, private provider configuration or
credentials may enter this repository's refs. Licensed third-party source is
included only with attribution/license terms. New project contributions use MIT;
it does not apply to original game material or generated derivatives.

Acceptance: media-free setup/check works; incomplete media fails explicitly;
one-command local preparation reconstructs assets and translation from a supported
user installation; native/Wasm and full room/game browser checks pass after that
preparation; stage/history guard and full-history secret scans pass; documentation
explains the pipeline and real retrospective decisions without fake old commits.
No automatic production deployment or game-media download. Active private audio
and deployment sessions retain ownership of their work.

The repository is prepared privately. Global policy requires the user to perform
the actual public visibility switch after exact-ref review and any applicable
GitHub Guard allowlist entry is resolved. Do not change visibility through agent
CLI/API/browser automation.
