# Chessmaster-Web source-only reconstruction

## Maintainer ownership

All ongoing maintainer development, reverse engineering, audio recovery and
production releases belong in the private `chessmaster-web-internal` repository
and session-exclusive worktrees there. This repository is a reviewed source-only
community export. Do not migrate active development or production configuration
here. Public contributors may use their own forks/media; maintainer integration
and subsequent reviewed exports follow the internal source of truth.

`chessmaster9000.com` is built/deployed from the private internal repository only.
There is no production deployment pipeline in this source-only export.

Use Beads (bd) for execution; cmweb is the local prefix. No cross-machine Beads sync has been verified. Follow active user instructions and the inherited engineering workflow.

Never commit original game files, extracted text/art/audio/fonts/models, generated engine code, decompilation or build outputs. Keep those in ignored paths. Source-only make check must work without game data. make check-media explicitly requires the user's own supported installation. Do not replace The King with another engine or swallow missing media/errors.

Work in a session-exclusive feature worktree, keep the public-release guard and source/license provenance current, run exact local checks, self-review and integrate through GitHub PR. Do not fabricate historic commits. The existing development history retains reviewed source changes with original authorship and dates. Older revisions can depend on omitted local data or configuration; use the current tree for the supported source-only build. Contributor media and unreviewed archive history must never enter Git.
