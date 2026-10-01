# Herdr Web gateway

This implementation replaces the design prototype's default mock data with an authenticated gateway and a persistent web client.

**Release status: reviewed code fixes are implemented and tested offline; the whole integration is not live-validated.** Approved targets can connect read-only from a standalone supervised gateway. Control and launch paths consume target-specific, signed and locally approved validation evidence; no boolean environment flag enables those capabilities. No valid live evidence was produced in this execution. Do not use the current user's agent for validation.

## Requirements

- Node.js 22 or later, npm, Linux or macOS.
- Installed Herdr **0.9.3**, JSON API protocol **22**, on each target host.
- An existing target session; the gateway does not install Herdr, start or restart its server, approve an SSH host key, or create a remote daemon.
- `better-sqlite3` may need a native build toolchain when no package binary is available.

Windows named pipes are not implemented. SSH must support Unix socket forwarding, strict host-key checks, and noninteractive authentication.

## Install and provision the only account

```sh
npm ci
export BETTER_AUTH_SECRET="$(openssl rand -hex 32)"
export HERDR_WEB_EVIDENCE_KEY="$(openssl rand -hex 32)"
export HERDR_WEB_EMAIL='your-address@example.com'
read -s HERDR_WEB_PASSWORD
export HERDR_WEB_PASSWORD
npm run provision
unset HERDR_WEB_PASSWORD
```

Enter a password with at least 16 characters. Keep the same authentication and evidence keys for subsequent runs in a private environment file outside source control. The local provisioning command runs the authentication migration, creates the allowed account, and refuses to replace an existing allowed account. Public signup is disabled. An unprovisioned host does not start; the first network visitor cannot claim ownership.

The database defaults to `.data/gateway.sqlite`. Use `HERDR_WEB_DATABASE` to select another private path. SQLite uses WAL and versioned Drizzle metadata migrations in `drizzle/`. The database holds authentication sessions, full thread UUIDs, avatars, runtime terminal anchors, target configuration versions, project locations, and the launch journal. It does not hold terminal output. Prompts remain private launch metadata and are not included in browser metadata snapshots.

## Build and run

```sh
npm run check
npm run build
npm start
```

Open `http://127.0.0.1:4321/login` manually. With no target registry the app shows no machines or threads, not demo data. `npm run dev` builds and starts the same authenticated host; it is not Astro's separate unauthenticated development server.

Cookies are always Secure, HttpOnly, and SameSite=Strict. Some browsers permit Secure cookies on local HTTP; if your browser does not, use local HTTPS instead of weakening the cookies:

```sh
export HERDR_WEB_ORIGIN='https://localhost:4321'
export HERDR_WEB_TLS_CERT='/absolute/path/to/your/local-certificate.pem'
export HERDR_WEB_TLS_KEY='/absolute/path/to/your/local-private-key.pem'
npm start
```

Use your own trusted local certificate and open the exact origin. The hostname, port, and scheme must match `HERDR_WEB_ORIGIN`. The default bind address is `127.0.0.1`. Any nonlocal bind requires a trusted HTTPS origin and explicit `HERDR_WEB_TRUSTED_HTTPS=1`; this does not configure a proxy or authorize public exposure. Preserve the exact Host header and forward both WebSocket upgrades if a trusted proxy is used.

The Fastify host owns one HTTP/TLS port, Astro middleware and static assets, Better Auth, the shared runtime manager, and both WebSocket routes. Astro never creates another runtime manager. All app routes, catalogs, operation records, icons, and WebSocket upgrades require the allowed account. Writes and upgrades also require the exact Origin. Host checks protect against rebinding. Logout revokes existing paired sockets and their leases within the bounded session check interval.

## Approve targets locally

Set `HERDR_WEB_TARGETS` to a private JSON registry file. There is no browser endpoint to add arbitrary hosts, sockets, paths, shell commands, or RPC methods.

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

To connect the production application, set `HERDR_WEB_TARGETS` to the approved registry and explicitly set `HERDR_WEB_CONNECT=1`, then start the gateway. **The production gateway does not require `HERDR_ENV`; it can run as a supervised process outside a pane.** Disabled profiles remain visible but are not probed. Without connection opt-in, enabled profiles remain disconnected. A configured or enabled profile is not proof of a healthy connection. Failed target and browser connections use bounded exponential retry with jitter, not a permanent short polling loop.

The separate agent/live-validation safety rule still requires a genuinely inherited `HERDR_ENV=1` before any live validation command. Do not set that variable to bypass the validator.

## Runtime and browser behavior

- The gateway subscribes and waits for the subscription acknowledgement before its first authoritative snapshot.
- Pane-scoped status subscriptions are updated from observed identities; replacement subscribes before the old connection closes, then reconciles again. Browsers share the same upstream state, not one subscription per browser.
- Events invalidate state. They are not replayed over a snapshot, because Herdr exports no shared snapshot/event sequence boundary. Reads are serialized, coalesced, and repeated when an event occurs during a read. `events_lost` forces a new subscription and snapshot.
- Each app instance has two authenticated WebSockets: metadata and binary visible-terminal multiplexing. Losing either socket closes both and releases its controller leases. Browser reconnection never replays input.
- Binary headers include stream ID, generation, sequence, dimensions, full-baseline flag and payload length. An xterm write callback returns ACK credit. Per-stream, aggregate and writer byte limits close an overloaded stream rather than dropping an incremental frame. Reconnection starts from a full baseline.
- Terminal output and buffers stay outside React, Zustand, HTTP query caches and SQLite. Normalized provider-scoped Zustand records preserve unchanged row identity. Focus uses scoped pane IDs. TanStack Query is limited to HTTP catalogs and cancels stale reads.
- Astro ClientRouter persists the named App island, updates route props, and keeps sockets and UI state across page changes. It does not replace newer store state with an older SSR bootstrap. Direct `/threads/<full-UUID>` URLs remain server rendered. Native routes require `/sessions/<session>/tabs/<tab>?machine=<machine-id>`; native IDs alone are not globally unique.
- Layouts use Herdr's native pane rectangles, not a fabricated flat split list. A saved thread is a tab alias, not a permanent list of launch-time panes. At least one expected terminal must survive in that same aliased tab before all its current panes can be projected and its anchor set updated. Native splits become visible; closing one pane keeps surviving tab members attached. A pane moved to another tab leaves the original thread's membership; the whole thread alias does not move with it. Loss of all same-tab anchors requires explicit adoption, even if paths, titles or pane IDs look unchanged.
- Bindings also require the saved target fingerprint and configuration version. The fingerprint includes transport, host, socket, session and executable. A repointed profile or changed session cannot silently reuse terminal strings from another runtime; saved threads remain detached for adoption. Old metadata without those binding fields is also detached.
- A detached thread has a native-tab adoption picker. It shows current terminal identities, requires explicit confirmation, and calls authenticated `POST /api/threads/<UUID>/adopt` with `{ "machineId": "...", "terminalIds": ["..."] }`. The server serializes a fresh authoritative read and checks complete same-tab membership and conflicts before updating the binding. Adoption does not restart an old prompt.
- Activity time changes on meaningful agent, membership or title changes, not output-frame revisions. Unchanged projections keep their revision between bounded freshness publications.
- Local approved-project icons use a fixed bounded candidate list and reject escaping symlinks. Remote and unconfigured project icons use letter fallbacks; no arbitrary filesystem endpoint exists.

## Input and launch limits

Real targets are **read-only unless matching complete live evidence is approved locally**. The fixture path exercises control conflicts, explicit takeover, resize, Unicode, paste validation, release, sequence recovery, and disconnect teardown. The gateway controller lock protects its own leases and Herdr's direct controller path; it is not a global input lock over unrelated native or JSON API clients.

Control, takeover and release actions are in the command palette and a compact terminal context menu, not permanent terminal header bars. The pilot captures deliberate keyboard, Unicode, IME and plain-text paste events through a small input capture field. Application shortcuts still work there and are dispatched only once; composer and search editing keys are not intercepted. It never forwards arbitrary xterm `onData`, device replies, terminal clipboard requests, or terminal-supplied links. Input is limited to 8 KiB of UTF-8 bytes. Paste rejects control characters and embedded bracketed-paste delimiters.

Input requires both an accepted control open and a rendered full baseline. Awaiting the initial, replacement or resize baseline disables input; a resize requires a matching new full baseline. Once that baseline is verified, ordinary output parsing does not pause established input, even when incremental frames are queued. Output ACK credits and byte limits remain independent of input eligibility. Release, revoked authorization and connection loss disable input. Old events and ACK callbacks cannot authorize another generation. Input is not queued for later replay. Observer viewports reopen when their size changes; observers do not resize or independently scroll the source. Source dimensions determine xterm dimensions, with cropping/padding permitted.

Herdr's CLI does not export source keyboard modes. Fixed pilot key encodings are not proof of complete native input compatibility. A future Herdr semantic key/paste CLI extension could resolve this; no such feature is assumed here. Graphics are not supported by the CLI mirror. Plain pointer gestures and Shift gestures are reserved for selection/copy. While writable, hold Alt for source mouse gestures or source wheel scrolling; routing Alt is consumed and Ctrl is forwarded as a mouse modifier. Read-only viewers do not send these gestures. Shift-right-click retains the browser menu; the terminal menu also has an explicit Copy selection action. Do not enable writes based only on the offline fixtures.

The catalog probes only the known `claude`, `codex`, `opencode` and `pi` executables on the selected host. It does not read credentials, import another host's catalog, or fabricate a model inventory. Installed executables remain viewable with a reason when launch is not verified. Model choices come from exact, actually tested launch grants for that project and harness. A grant for one custom model never authorizes other custom IDs, and a custom-model grant does not implicitly authorize Default. The native argv adapter supports Claude, Codex and OpenCode; other adapters are not launch-enabled.

`POST /api/threads` requires an account-scoped UUID `Idempotency-Key`. Repeated payloads return the same operation/thread IDs; different payloads with the same key conflict. Each launch step persists intent before its effect. Worktree creation uses the returned initial tab rather than creating another tab. Returned native IDs are persisted before agent start; readiness belongs to Herdr's start operation; a fresh named-agent identity is checked before the initial prompt. An ambiguous effect or interrupted journal stays `unknown` for manual recovery. The gateway never retries a mutation or prompt blindly, deletes a partial checkout, or stops a target server. Launch requires separate proof for the exact target, project location, harness and native model adapter; a control grant is not a launch grant. Default-only evidence cannot authorize custom models.

Read and health RPC deadlines remain five seconds. Agent start uses Herdr's thirty-second readiness budget plus a five-second transport margin. Worktree creation has a bounded two-minute deadline; plain tab creation has thirty seconds. Longer configured readiness waits cannot exceed Herdr's five-minute limit plus the same transport margin. No request has an infinite deadline. An action that exceeds its deadline remains uncertain in the launch journal and is not repeated automatically.

## Capability evidence and local approval

`src/server/validation/evidence.ts` defines the signed evidence contract. Evidence binds protocol 22, version 0.9.3, target fingerprint, issue/expiry times and complete required check sets. Control uses `literal-pilot-v1` with explicit `literal-transport` scope; it does not claim source-mode-aware correctness in every harness. Launch uses a separate `model-argv-v1` grant for an exact harness, scoped project/path and exact tested model. Partial, expired, modified, legacy blanket-custom or wrong-target evidence fails closed. Controls are revoked when approved evidence expires or is removed. Native control CLI and create/start/prompt paths are wired behind these checks.

Use the private `HERDR_WEB_EVIDENCE_KEY` from setup for both the live validator and the gateway. This signing key is not the authentication secret and must not appear in source control, logs or browser data. Its presence alone grants nothing. The guarded validator signs a private receipt automatically only after every selected check passes. Use `--approve` to approve that measured receipt as part of the same operator command, or approve/revoke it separately:

```sh
npm run validation:approve -- <approved-target-id> /absolute/path/to/signed-live-evidence.json
npm run validation:revoke -- <approved-target-id>
```

Approval checks the signature, identity, expiry and required grant checks, then persists the receipt in the private metadata database. There is no browser approval endpoint or bypass flag, and the validator never accepts a supplied successful checklist or ownership manifest. Fixture/injected transports cannot issue live receipts, even when their measured tests pass. Old receipts with blanket `modelMode` grants no longer pass the schema. The launch safety check `durable-intent-once` measures one journaled client request per effect; it is not a claim of server-side exactly-once delivery after a lost response.

## Verify offline

Authentication requests have a bounded in-memory rate limit. This limit resets when the one gateway process restarts; it does not replace a strong password or private network access.

Dependency review still reports four moderate advisories through the unused optional Drizzle Kit peer and its old esbuild loader in the retained lock graph. A clean isolated resolution with the same direct package versions omitted that optional tooling and reported no advisories, but ordinary pruning of this retained graph did not remove it. No unsupported esbuild override, unstable major or audit suppression was applied. The gateway does not invoke Drizzle Kit or its development server. Report the actual audit result rather than treating the unused path as an audit pass.

```sh
npm test
npm run check
npm run build
npm run validate:offline
git diff --check
```

`npm test` uses fake socket servers, fake target/process adapters, owned Node fixtures and DOM event tests; it never calls live Herdr. Tests check standalone approved connections without `HERDR_ENV`, capability consumption on fake targets, tab lineage, profile reconfiguration, scoped locations, baseline input barriers and explicit UI events. Retry recovery uses a deterministic fake clock and fixed jitter instead of a wall-clock polling deadline. It includes an authenticated end-to-end gateway fixture and a real production-host start with an empty registry on an ephemeral local port. That production test builds Astro and proves SSR, static assets, HTTP and both WebSocket routes share the same port. No real browser or desktop app is automated.

The offline validator runs only `herdr api schema --json`, or reads an exported schema path:

```sh
npm run validate:offline -- /absolute/path/to/herdr-web-api.schema.json
```

A different CLI/server version requires validation again. The installed JSON schema does not export CLI terminal frames or keyboard modes; the validator reports that missing proof explicitly.

## Run automated live validation in the existing session

Save the approved registry above at a private path and load the same keys used during provisioning. Run this **from a genuine Herdr terminal in the selected existing session**, not from an unmanaged shell, and do not set `HERDR_ENV` yourself:

```sh
export HERDR_WEB_TARGETS='/absolute/private/targets.json'
npm run validate:live -- --target local --consent --approve
```

One existing session is enough. This command creates a uniquely labelled, no-focus disposable workspace and private target-side Python recorder, not a second session. The selected Local socket must match the actual managed caller session. SSH uses exactly one approved target/session and strict noninteractive host-key checks. Python 3 must already be installed on the target on Linux/macOS; missing Python, incompatible schema or unsupported platform fails without installation. No server is started, stopped or restarted.

The recorder observes actual PTY input bytes and dimensions. Tests cover full baseline and sequence, raw ordered keys, UTF-8, whole multiline bracketed paste, queue limits, physical resize, SGR mouse/wheel reports, two owned controller conflicts/takeover, release/disconnect and duplicate output-derived cursor replies. Takeover is permitted only between controllers this run opened on its new terminal. Every test checks fresh owned terminal identity. Source keyboard modes remain unavailable from the rendered CLI stream, so the resulting control grant is explicitly literal transport only.

The command does **not** launch a paid or tool-bearing agent by default. To request one selected harness/model test in its own linked checkout, use explicit additional flags:

```sh
npm run validate:live -- --target local --consent --launch --harness claude --model Default --project my-project --approve
```

Use `--launch-only` instead of `--launch` if you want only the independent launch grant. `--harness`, `--model` and `--project` are mandatory for a launch test. Only that exact model is granted, and no other installed harness is launched. The validator uses worktree.create's initial tab/root pane, Herdr's own start readiness, a fresh named occupant and one benign encoded-token prompt. A settled decoded reply is required; the token is not supplied as plain prompt text, so echo of the submitted prompt cannot pass the output check. Approval questions are never answered. Unknown create/start/prompt outcomes are never repeated.

Successful actual runs write a signed 0600 receipt and a durable 0600 ownership journal under `.data/validation` (or an explicitly selected private `--out` directory). Injected/fake runs are labelled fixture and never write a live receipt. Any incomplete selected proof produces no receipt and reports the missing checks. Cleanup uses only returned, verified, runner-created identities in reverse order, never group close, force worktree removal, branch deletion or broad file deletion. Changed/ambiguous ownership or a dirty linked checkout is preserved with recovery IDs and the journal path. Preexisting/caller panes and agents are never selected for control, prompts, process reads or cleanup.

After successful approval, start the standalone gateway with the same registry and keys:

```sh
export HERDR_WEB_CONNECT=1
npm run build
npm start
```

The gateway itself does not require a managed pane. Local/SSH actual live execution has **not** been performed in this coding session, because its genuine managed context is absent. The new runner has deterministic injected failure/success tests and an actual owned recorder-process/PTY test, not fabricated Herdr live proof. Remote icons still use fallbacks, general source-mode-aware keyboard/graphics support remains outside the literal pilot, and manual browser acceptance is still required. Please validate login, persisted navigation, themes, responsive layout and the preserved heading manually.
