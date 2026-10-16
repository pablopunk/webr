## Workflow

* Run pnpm through mise as `mise exec -- pnpm <command>`. Do not use npm, yarn, bun, or bare pnpm directly.
* Use CI for checks, tests, builds, and installation smoke tests; do not run them locally unless the user explicitly requests it. Report CI results only after verification.
* Leverage existing primitives, formatters, and OS capabilities instead of creating one-off helpers.
* Respect manual file changes to prevent overwrites.
* Commit frequently and use history to guide changes.
* Do not fix symptoms, fix diseases. After two successive symptom patches in the same code path, stop patching and audit the architecture. For rejected visual changes, clarify the target against the user's reference before another edit; a passing build does not verify appearance.
* To measure UI responsiveness, have the user exercise `pnpm dev` (reload the page first), then read `.data/perf.jsonl` (`client.second` stats, `main.stalled`, `slow.*`) instead of guessing.
* To debug focus, input or stream problems, read `trace.log` in the Webr home (`~/.webr` unless `WEBR_HOME` is set) on the machine that runs the server, not the one that runs Herdr: the client logs focus moves, pane states and stream events there and the hub logs binding lapses. Ask the user for the time it happened and read the log instead of reproducing.
* A probe pane beats guessing what Herdr sends an app: `herdr tab create --workspace <id> --cwd /tmp --label probe`, run `printf '\e[?1004h'; cat -v` in it, drive it with the attach stream below, read it with `herdr pane read <pane>`, then `herdr tab close <tab>`.

## Herdr terminal streams

* The attach stream is `herdr terminal session control|observe <terminalId> --cols N --rows N` with NDJSON commands on stdin; Herdr accepts only `terminal.input`, `terminal.resize`, `terminal.scroll`, `terminal.mouse` and `terminal.release`. There is no focus command.
* Herdr emits nothing to the app on attach, resize, mouse move or click. Full frames start with RIS and never replay private modes, so xterm's `modes` (focus reporting, mouse tracking) read false after every baseline; do not gate behavior on them.

## Other rules

- Never use native `<select>`. Reuse the existing UI components: `ComposerCombobox` for searchable lists, and the `theme-control` segmented buttons for a few fixed choices.
