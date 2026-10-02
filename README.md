# Herdr Web gateway

This implementation replaces the design prototype's mock data with a local Herdr gateway and a persistent web client; no login or account setup is required.

**Status: Herdr Web connects to a running Herdr 0.9.3 session and offers whatever Herdr supports, with no validation or approval step.** The gateway only checks the Herdr version and API schema before it enables terminal control and launch.

## Requirements

- Node.js 22 or later, mise-managed pnpm, Linux or macOS.
- Installed Herdr **0.9.3**, JSON API protocol **22**, on each target host.
- Local sessions are discovered automatically; when none exists the app starts Herdr's headless server, without installing Herdr, restarting existing sessions or touching their agents.
- `better-sqlite3` may need a native build toolchain when no package binary is available.

Windows named pipes are not implemented. SSH must support Unix socket forwarding, strict host-key checks, and noninteractive authentication.

## Install and run

```sh
mise install
mise exec -- pnpm install --frozen-lockfile
mise exec -- pnpm run build
mise exec -- pnpm start
```

Open `http://127.0.0.1:4321/`. There is no authentication by default and no password feature yet; do not expose this terminal-access app publicly. The bind address defaults to localhost.

The database defaults to `.data/gateway.sqlite`. Use `HERDR_WEB_DATABASE` to select another private path. SQLite uses WAL and versioned Drizzle metadata migrations in `drizzle/`. It holds thread UUIDs, avatars, runtime terminal anchors, target configuration versions, project locations, and operation journals, not terminal output. Existing databases are preserved. Prompts remain private launch metadata and are not included in browser snapshots.

## Build and run

```sh
mise exec -- pnpm run check
mise exec -- pnpm run build
mise exec -- pnpm start
```

`mise exec -- pnpm run dev` builds and starts the same production host. It immediately connects to Local without requiring a registry, account, secret or `HERDR_WEB_CONNECT` flag; `mise.toml` selects pnpm, and `pnpm-lock.yaml` is the dependency lockfile.

Optional local HTTPS:

```sh
export HERDR_WEB_ORIGIN='https://localhost:4321'
export HERDR_WEB_TLS_CERT='/absolute/path/to/your/local-certificate.pem'
export HERDR_WEB_TLS_KEY='/absolute/path/to/your/local-private-key.pem'
mise exec -- pnpm start
```

Use your own trusted local certificate. Local origins accept `localhost`, `127.0.0.1`, and `[::1]` with the configured port and scheme; writes and WebSockets must use the same origin as the page. Nonlocal hosts must match `HERDR_WEB_ORIGIN` exactly. The default bind address is `127.0.0.1`. Any nonlocal bind requires a trusted HTTPS origin and explicit `HERDR_WEB_TRUSTED_HTTPS=1`; this does not configure a proxy or authorize public exposure. Preserve the Host header and forward both WebSocket upgrades if a trusted proxy is used.

The Fastify host owns one HTTP/TLS port, Astro middleware and static assets, the shared runtime manager, and both WebSocket routes. Astro never creates another runtime manager. No cookies or credentials are required. Writes and upgrades require the exact Origin, and Host checks protect against rebinding; these checks are not authentication. Each browser instance has separate controller leases; losing either socket closes the pair and releases its leases.

## Automatic Local session

An inherited `HERDR_SOCKET_PATH` takes priority, followed by `HERDR_SESSION`. Otherwise the app uses Herdr's `session list --json` to select the running default or the sole running named session. If several named sessions run without a default, start the app from the intended Herdr session instead of guessing which one is current.

When no session is running and no session sockets remain, Local starts `herdr server` detached and waits for readiness. A responding session is only read, never restarted; permission errors, stale sockets, connection refusals and incompatible versions do not trigger replacement. Bootstrap is shared across requests, and an uncertain start is not repeated automatically. Gateway shutdown does not stop Herdr.

An empty session is connected state, not a setup error. Existing project folders are read from native Herdr workspace state. The empty New thread view offers a folder/name form that calls Herdr's `workspace.create` without an existing source workspace, checkout or focus change. Existing sessions also have an Add project action. Repeated requests keep the same operation key; an uncertain mutation is not replayed.

## Approve targets locally

Local needs no registry. To override discovery or configure SSH, set `HERDR_WEB_TARGETS` to a private JSON registry file; an explicit `[]` disables all targets. The browser cannot add hosts, sockets, shell commands or RPC methods. The local workspace form accepts a project directory, which Herdr validates.

```json
[
  {
    "id": "local",
    "name": "Local",
    "session": "default",
    "enabled": true,
    "transport": "local",
    "socket": "/absolute/path/to/herdr.sock",
    "locations": [
      {
        "projectId": "my-project",
        "logicalId": "my-project",
        "path": "/absolute/path/to/my-project",
        "workspaceId": "the-actual-native-workspace-id"
      }
    ]
  }
]
```

Do not copy example native IDs into your registry. Obtain the real IDs only in a genuine managed context. Profile IDs can be native opaque identifiers, including IDs that start with a digit. A local profile can omit `socket` to use the documented configuration/session socket location. An optional `executable` selects the approved target-host Herdr executable; the default is `herdr`. Connection probes check the running JSON protocol, installed CLI version and required bundled schema fields before a target becomes compatible.

Browser project IDs are target-local location keys such as `local:my-project`, not the bare registry `projectId`. Catalogs, threads, icons and launch locations use the same scoped key. `logicalId` groups locations for the same repository across hosts and worktrees without mixing their paths; it defaults to the registry project ID. Set different logical IDs for unrelated repositories that happen to use the same local ID. Catalog query keys include the target, session, configuration version and selected project location.

SSH profiles use `"transport": "ssh"` and require `host` plus the verified absolute remote `socket`. `host` is an approved SSH alias or `user@host`, not a browser-supplied host. The remote socket path supports ASCII letters, digits, underscores, slashes, dots and hyphens; paths that need spaces or colons in the Unix forwarding specification are not supported. Resolve this manually rather than changing quoting or enabling host-key approval. The API uses one persistent, verified Unix socket forward per target. Terminal commands execute the **target host's installed Herdr** over noninteractive SSH, with separately quoted arguments; they do not use `--machine` for terminal sessions. Only the gateway's own SSH/CLI processes and temporary forwarding directory are cleaned up.

Explicit registry profiles require `HERDR_WEB_CONNECT=1`; automatic Local does not. **The production gateway does not require `HERDR_ENV`; it can run outside a pane.** Disabled profiles remain visible but are not probed. A configured profile is not proof of a healthy connection. Failed target and browser connections use bounded exponential retry with jitter.


## Runtime and browser behavior

- The gateway subscribes and waits for the subscription acknowledgement before its first authoritative snapshot.
- Pane-scoped status subscriptions are updated from observed identities; replacement subscribes before the old connection closes, then reconciles again. Browsers share the same upstream state, not one subscription per browser.
- Events invalidate state. They are not replayed over a snapshot, because Herdr exports no shared snapshot/event sequence boundary. Reads are serialized, coalesced, and repeated when an event occurs during a read. `events_lost` forces a new subscription and snapshot.
- Each app instance has two WebSockets: metadata and binary visible-terminal multiplexing. Losing either socket closes both and releases its controller leases. Browser reconnection never replays input.
- Binary headers include stream ID, generation, sequence, dimensions, full-baseline flag and payload length. An xterm write callback returns ACK credit. Per-stream, aggregate and writer byte limits close an overloaded stream rather than dropping an incremental frame. Reconnection starts from a full baseline.
- Terminal output and buffers stay outside React, Zustand, HTTP query caches and SQLite. Normalized provider-scoped Zustand records preserve unchanged row identity. Focus uses scoped pane IDs. TanStack Query is limited to HTTP catalogs and cancels stale reads.
- Astro ClientRouter persists the named App island, updates route props, and keeps sockets and UI state across page changes. It does not replace newer store state with an older SSR bootstrap. Direct `/threads/<full-UUID>` URLs remain server rendered. Native routes require `/sessions/<session>/tabs/<tab>?machine=<machine-id>`; native IDs alone are not globally unique.
- Layouts use Herdr's native pane rectangles, not a fabricated flat split list. A saved thread is a tab alias, not a permanent list of launch-time panes. At least one expected terminal must survive in that same aliased tab before all its current panes can be projected and its anchor set updated. Native splits become visible; closing one pane keeps surviving tab members attached. A pane moved to another tab leaves the original thread's membership; the whole thread alias does not move with it. Loss of all same-tab anchors requires explicit adoption, even if paths, titles or pane IDs look unchanged.
- Bindings also require the saved target fingerprint and configuration version. The fingerprint includes transport, host, socket, session and executable. A repointed profile or changed session cannot silently reuse terminal strings from another runtime; saved threads remain detached for adoption. Old metadata without those binding fields is also detached.
- A detached thread has a native-tab adoption picker. It shows current terminal identities, requires explicit confirmation, and calls `POST /api/threads/<UUID>/adopt` with `{ "machineId": "...", "terminalIds": ["..."] }`. The server serializes a fresh authoritative read and checks complete same-tab membership and conflicts before updating the binding. Adoption does not restart an old prompt.
- Activity time changes on meaningful agent, membership or title changes, not output-frame revisions. Unchanged projections keep their revision between bounded freshness publications.
- Local approved-project icons use a fixed bounded candidate list and reject escaping symlinks. Remote and unconfigured project icons use letter fallbacks; no arbitrary filesystem endpoint exists.

## Terminal input and launch

Herdr Web enables whatever Herdr itself supports. It checks only that the connected Herdr is the supported version and exports the expected API schema (protocol 22, 0.9.3); there is no separate approval, evidence or paid validation step.

- **Input just works.** The active pane requests control by itself and keeps keyboard focus. Keys and pastes anywhere on the page go to the terminal unless a search box or dialog is being edited, and applications that ask for focus reports receive them. There is no control menu; right-click is the browser's own menu.
- **Many tabs, one terminal.** All browser tabs share one Herdr control stream for each pane, and every tab can type. Each tab keeps its own acknowledgements and byte budget, so a slow tab cannot stall another. The tab that last gained focus sets the terminal size, as in tmux.
- **Other Herdr clients.** Herdr allows one `terminal session control` stream per pane. If another Herdr client already holds it, the pane shows a banner with an explicit **Take over** button, which asks before replacing that client. Herdr's own terminal windows are unaffected.
- **Input safety.** Input is accepted only after the tab's full baseline frame was rendered and acknowledged; a resize requires a matching new full baseline. Herdr's CLI does not export source keyboard modes, so fixed key encodings are not a proof of complete native input compatibility. Graphics are not supported by the CLI mirror. While writable, hold Alt for source mouse gestures; plain pointer gestures stay reserved for selection and copy.
- **Launch.** New thread creates a worktree (or a plain tab), starts the harness with Herdr's `agent.start`, waits for the shell prompt and for the agent to be detected, then sends your prompt once. The thread appears in the sidebar immediately with live step labels, and a stopped launch says which step failed. Claude Code, Codex and OpenCode can be launched with `Default` or a custom model name; other installed harnesses are listed with a reason. The catalog probes only the known `claude`, `codex`, `opencode` and `pi` executables on the selected host and never reads credentials.

`POST /api/threads` requires a single-user-scoped UUID `Idempotency-Key`. Repeated payloads return the same operation/thread IDs; different payloads with the same key conflict. Each launch step persists intent before its effect. Worktree creation uses the returned initial tab rather than creating another tab. Returned native IDs are persisted before agent start; readiness belongs to Herdr's start operation; a fresh named-agent identity is checked before the initial prompt. An ambiguous effect or interrupted journal stays `unknown` for manual recovery. The gateway never retries a mutation or prompt blindly, deletes a partial checkout, or stops a target server. Launch requires separate proof for the exact target, project location, harness and native model adapter; a control grant is not a launch grant. Default-only evidence cannot authorize custom models.

Read and health RPC deadlines remain five seconds. Agent start uses Herdr's thirty-second readiness budget plus a five-second transport margin. Worktree creation has a bounded two-minute deadline; plain tab creation has thirty seconds. Longer configured readiness waits cannot exceed Herdr's five-minute limit plus the same transport margin. No request has an infinite deadline. An action that exceeds its deadline remains uncertain in the launch journal and is not repeated automatically.

## Verify offline

Removing Better Auth also removes its optional Drizzle Kit/esbuild dependency chain; the updated lockfile reports zero advisories. No audit suppression or unsupported version override was applied.

```sh
mise exec -- pnpm test
mise exec -- pnpm run check
mise exec -- pnpm run build
mise exec -- pnpm run validate:offline
git diff --check
```

`mise exec -- pnpm test` uses fake socket servers, injected process adapters, owned Node fixtures and DOM event tests; it never calls live Herdr. Tests cover no-account startup, local session selection and guarded creation, native empty sessions, first workspace creation, capability checks, Host/Origin refusal and socket lease teardown. The production-host fixture uses an explicit empty registry on an ephemeral local port and proves SSR, assets, HTTP and both WebSockets share one port. No browser or desktop app is automated.

The offline validator runs only `herdr api schema --json`, or reads an exported schema path:

```sh
mise exec -- pnpm run validate:offline /absolute/path/to/herdr-web-api.schema.json
```

A different CLI/server version is refused until it is checked against this schema. The installed JSON schema does not export CLI terminal frames or keyboard modes; the validator reports that missing information explicitly.
