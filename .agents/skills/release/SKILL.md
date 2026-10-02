---
name: release
description: Release a new version of @pablopunk/webr to npm. Use when the user says /release, "ship it", "publish", or asks to cut a version.
---

# Release @pablopunk/webr

Publishing is outward-facing: confirm the version bump with the user before tagging or pushing.

1. Start from a clean `main` that is up to date with `origin/main`: `git status --short` is empty, `git fetch && git status -sb`.
2. Verify locally: `mise exec -- pnpm check && mise exec -- pnpm test && mise exec -- pnpm smoke:install`. Stop on any failure.
3. Pick the bump (0.x: `minor` for anything breaking or a new feature, `patch` for fixes). Ask the user if unclear.
4. `npm version <patch|minor> -m "Release %s"` bumps `package.json`, commits and creates the `v<version>` tag.
5. `git push origin main --follow-tags`. Use `rtk proxy git push ...` if a rejection is unclear.
6. The `Publish` workflow (`.github/workflows/publish.yml`) runs on the `v*` tag: check, test, build, smoke test, then `npm publish --provenance` through npm trusted publishing (OIDC, no token or secret). Watch it with `rtk proxy gh run watch`.
7. Verify: `npm view @pablopunk/webr version` shows the new version.

Never move or re-push a tag that CI already ran on. If the release fails, fix forward with a new patch version. `workflow_dispatch` can re-run the workflow without touching tags, but the version in `package.json` must be unpublished.

CI has no Herdr, so `smoke:install` sets a dummy `HERDR_SOCKET_PATH`; it passing on the dev machine proves nothing about CI.

Trusted publishing needs npm 11.5+ (the workflow upgrades it, Node 22 ships 10) and the trusted publisher configured on the package's npmjs.com access page (repo `pablopunk/webr`, workflow `publish.yml`). Bypass-2FA npm tokens stop publishing around January 2027, so do not add an `NPM_TOKEN`.

Manual publish (only if CI is unavailable): run `npm publish --access public` in a real terminal so npm can ask for the authenticator code, or pass `--otp=<code>`. It fails with `EOTP` inside Claude Code's `!` prompt, and the auto-mode classifier blocks the agent from publishing, so the user types it.

After a release, remind the user that `webr plugin install` pulls the plugin folder from GitHub `main`, not from npm, so the plugin is live as soon as `main` is pushed.
