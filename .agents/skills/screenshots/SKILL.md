---
name: screenshots
description: Regenerate the README screenshots (sidebar, typing, cmdk, tailscale) from the latest Webr UI using a fake Herdr and made-up projects and agents. Use when the user asks to refresh, redo, or regenerate screenshots, or says "new screenshots".
---

# Webr screenshots

Run `mise exec -- pnpm screenshots` from the repo root. It builds the app, starts a fully fake setup, captures four scenes, and writes `sidebar.jpg`, `typing.jpg`, `cmdk.jpg` and `tailscale.jpg` into `assets/brand/`. `dock.jpg` is a static image and is never touched.

Options: `--only <scene>` (repeatable), `--skip-build`, `--out <dir>`. Use `--out` to preview before replacing the README images.

Needs `agent-browser` on the PATH. Nothing real is read: no real Herdr, projects, Tailscale or database. The user's real data never appears in an image.

## How it works

- `fake-herdr.ts` is a Unix socket server that speaks the Herdr protocol (22) and serves `snapshot.ts`. The `herdr` stub in the temp `bin/` runs `herdr-cli.ts`, which answers `--version`, the API schema and `terminal session` streams. Stubs for `claude`, `codex` and friends make the harness picker light up, and a `tailscale` stub provides the fake `my-mac.tail1234.ts.net` address.
- `seed.ts` runs the real `reconcile` against the fake socket, then backdates thread times and adds devices and activity. Webr itself starts with `WEBR_HOME`, `HOME` and `HERDR_SOCKET_PATH` pointing into a temp dir, so it is the unmodified app.
- `screen.ts` draws each fake terminal as ANSI at whatever size the client asks for. The stub also echoes typed text, so the typing scene uses real keystrokes.
- Phone scenes render at 430px wide, scale 942/430, then `compose.ts` adds the iOS status bar and keyboard from `frames/`. The frames were cut from the original device screenshots with `extract-frames.ts`. Re-running that script on the new images would crop the new images, so only do it with the originals from git history.

## Changing the content

- Projects, threads, transcripts and agent names: `demo.ts`. Harness names the app knows are `claude`, `codex`, `opencode` and `pi`.
- Scenes and click steps: `scenes.ts`. Prefer selectors without spaces, because `agent-browser click` splits on them. Use `Browser.clickText` for visible text.
- For manual poking, run `mise exec -- pnpm screenshots:serve` and open the printed URL.

## Gotchas

- Chromium runs with `--disable-3d-apis`. With WebGL on, xterm glyphs render at twice the size in headless screenshots.
- `touch-device.js` fakes `(pointer: coarse)` so the terminal key bar appears. A real touch emulation resets the custom viewport.
- Rebuild before capturing, or the images show a stale UI. The command does this unless `--skip-build` is passed.
- After capturing, look at every image before committing. The README references them by these exact names.
