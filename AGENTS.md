# Chessmaster-Web source-only reconstruction

Use Beads (bd) for execution; cmweb is the local prefix. No cross-machine Beads sync has been verified. Follow active user instructions and the inherited engineering workflow.

Never commit original game files, extracted text/art/audio/fonts/models, generated engine code, decompilation or build outputs. Keep those in ignored paths. Source-only make check must work without game data. make check-media explicitly requires the user's own supported installation. Do not replace The King with another engine or swallow missing media/errors.

Work in a session-exclusive feature worktree, keep the public-release guard and source/license provenance current, run exact local checks, self-review and integrate through GitHub PR. Do not fabricate historic commits; docs/engineering-history.md explains the reconstruction retrospectively. Contributor media or private archive history must never be imported into Git.
