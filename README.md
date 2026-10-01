# Herdr Web

A server-rendered design prototype for a remote Herdr control surface. Each thread and Herdr tab has a direct URL; page changes use normal browser navigation, not a client-side router.

## Run locally

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:4321/`. For a production build, run `npm run check`, `npm run build`, then `npm start`.

## What works in the prototype

- Activity-ordered agent sidebar with animated avatars, project-grouped and flat thread layouts, collapse, and a mobile drawer.
- Project icons come from a small set of likely image locations in each local repository; missing icons use the project's letter and color.
- Each thread keeps its own avatar: the first 18 use distinct shapes, then the shapes repeat with distinct colors and animation timing.
- Direct `/threads/:id` and `/sessions/:session/tabs/:tab` pages, with multiple terminal panes.
- xterm-based terminal previews that accept input but **never run commands**.
- New-thread prompt with machine, project, harness, model, and worktree choices. Local is the default. Each mock machine has its own project paths, harnesses, and model suggestions; models also accept custom names. Created threads persist in `.data/threads.json` across restarts.
- Compact Base UI comboboxes offer searchable machine, project, harness, and model menus with full names, keyboard navigation, and custom model entry; the toolbar uses short labels and keeps send controls together on small screens.
- ⌘K command palette for navigation, theme, layout, focus, and new-thread actions.
- System/light/dark themes and configurable thread, pane, and sidebar shortcuts, saved on this device.

## Boundary

No Herdr process or socket is connected. The local mock API does not authenticate users, so keep this prototype bound to localhost. Before remote access, add authentication and WebSocket authorization, replace the mock data adapter, and test Herdr's terminal controller behavior with real panes. Do not expose this server to a public network yet.

## Machine integration notes

The machine catalog in `src/lib/machines.ts` is sample data, not a list of real connections or installed tools; even Local is mocked. The Build machine shows different choices, and the offline example cannot be selected. Machine and harness changes reset the model to Default. Projects unavailable on the selected machine are excluded; switching machines keeps the project only when it is available there. Remote project icons use letter fallbacks until remote asset discovery exists.

[Herdr machine docs](https://herdr.dev/docs/connecting-machines/) describe saved SSH profiles, each targeting one remote session. `herdr machine list --json` lists profiles, not proof that a connection is healthy. Real launch eligibility must use fresh connection state. Disabled, reconnecting, and Attention machines must not accept launches.

Remote commands use the prefix `herdr --machine <profile-id>` for every operation, with the saved profile's session; do not combine it with `--session` or `--remote`. Workspace, tab, pane, and agent IDs are scoped to a server, so a real adapter must key routes and lookups by machine as well as ID. Prototype thread UUIDs remain globally distinct, and each thread saves its machine ID; older threads default to Local.

The reviewed [agent automation docs](https://herdr.dev/docs/agent-automation/) document `agent start --kind ... -- <agent-args...>`, but no general installed-harness or model-catalog endpoint. Supported agent kinds and detection manifests are not proof that executables are installed. A real adapter must discover tools and model configuration on the selected host and translate model choices into each harness's native launch arguments; it must not use the web server's local catalog for remote hosts. This prototype starts no processes and makes no SSH connections.
