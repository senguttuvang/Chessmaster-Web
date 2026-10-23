# Contributing

Maintainer development and production releases happen in the private internal
repository. This community repository receives reviewed source-only exports;
it is not the production checkout. Community forks and contributions must retain
the same media boundary. No original-derived payload should be attached to a PR.

Start from the source-only checkout. Install dependencies with `make setup`, then
run `make check` without game media. Synthetic unit tests cover translation
primitives, protocol, lesson directives and browser-local data logic. The release
guard scans tracked paths and every reachable Git commit for prohibited paths.

For integration, supply your own supported installed media to `make prepare-media
GAME_DIR=/path`, then run `make check-media`. Missing media must fail visibly,
never be silently replaced or counted as a passing integration test. Keep local
fixtures and logs in ignored build/recovery paths. Browser tests use isolated9061.

Before submitting:

```sh
git add <reviewed-source-files>
bun tools/release/check.ts
git diff --cached --check
gitleaks git --log-opts=--all --redact --no-banner .
```

Never commit game payloads, original or generated engine instructions, extracted
content, screenshots, CD images, raw audio, fonts/models, user profiles, provider
metadata or credentials. `.gitignore` alone is insufficient: the guard must also
reject accidental force-added files. Keep new fixtures independently authored.
Do not submit proprietary content in issue attachments or PR comments either.
Code and prose can be copyrighted too; original game text disguised as a source
file is not acceptable merely because it passes an extension check. Review it.

The source-only tests and full media integration suite are separate, explicit
gates. Public CI can run the former. A maintainer with lawful media must validate
the latter for changes affecting recovery/gameplay. Report exact commands and
results; do not claim Windows runtime equivalence from browser checks alone.

Contributions to original project code are under MIT. Preserve third-party
licenses. Do not relicense locally generated original-derived outputs. Discuss
unsupported formats and privacy boundaries before expanding extraction scope.
