# Herdr Web

A server-rendered design prototype for a remote Herdr control surface. Each thread and Herdr tab has a direct URL; page changes use normal browser navigation, not a client-side router.

## Run locally

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:4321/`. For a production build, run `npm run check`, `npm run build`, then `npm start`.

## What works in the prototype

- Overview and activity-ordered agent sidebar, grouped by project; search, collapse, and mobile drawer.
- Direct `/threads/:id` and `/sessions/:session/tabs/:tab` pages, with multiple terminal panes.
- xterm-based terminal previews that accept input but **never run commands**.
- New-thread form with agent, project, and worktree choices. Created mock threads persist in `.data/threads.json` across restarts.
- System/light/dark themes and configurable thread, pane, and sidebar shortcuts, saved on this device.
- Real `bot-avatars` and `border-beam` components in places tied to agent or creation state.

## Boundary

No Herdr process or socket is connected. The local mock API does not authenticate users, so keep this prototype bound to localhost. Before remote access, add authentication and WebSocket authorization, replace the mock data adapter, and test Herdr's terminal controller behavior with real panes. Do not expose this server to a public network yet.
