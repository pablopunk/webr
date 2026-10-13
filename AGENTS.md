## Workflow

* Run pnpm through mise as `mise exec -- pnpm <command>`. Do not use npm, yarn, bun, or bare pnpm directly.
* Use CI for checks, tests, builds, and installation smoke tests; do not run them locally unless the user explicitly requests it. Report CI results only after verification.
* Leverage existing primitives, formatters, and OS capabilities instead of creating one-off helpers.
* Respect manual file changes to prevent overwrites.
* Commit frequently and use history to guide changes.
* Do not fix symptoms, fix diseases. After two successive symptom patches in the same code path, stop patching and audit the architecture. For rejected visual changes, clarify the target against the user's reference before another edit; a passing build does not verify appearance.
* To measure UI responsiveness, have the user exercise `pnpm dev` (reload the page first), then read `.data/perf.jsonl` (`client.second` stats, `main.stalled`, `slow.*`) instead of guessing.

## Other rules

- Never use native `<select>`. Reuse the existing UI components: `ComposerCombobox` for searchable lists, and the `theme-control` segmented buttons for a few fixed choices.
