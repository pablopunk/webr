# Webr

> Control your Herdr agents from anywhere.

> [!IMPORTANT]
> This repo is a WIP. Expect bugs and breaking changes

![Webr demo](./assets/demo.gif)

## Install

```sh
npm install -g webr     # or: pnpm add -g webr, bun add -g webr
```

Requires Node 22+ and a running Herdr. With pnpm 10+, approve the native `better-sqlite3` build when asked (`pnpm approve-builds`).

## Run it 24/7

```sh
webr service install    # starts at login, restarts if it stops
webr service status
webr service uninstall
```

The service uses launchd on macOS, a systemd user unit on Linux (it starts at boot when lingering is allowed), and Task Scheduler on Windows. It runs as you, so it can reach your Herdr session. Logs are in `~/.webr/logs/webr.log` and data in `~/.webr/`.

To run it in a terminal instead: `webr start`.

## Connect other devices

`http://localhost:4321` never asks for a token. Anything else does:

1. Open Webr on the other device and tap **Request access**. It shows a 4-digit code.
2. Webr on your computer shows **Allow iPhone · Safari to connect?** with the same code. Tap **Approve**.

Or go the other way: **Settings → Remote access → Show code** displays a QR and a one-time code. Scan the QR with the other device, or enter the code there. `webr invite` prints the same in a terminal. Codes work once and expire after 5 minutes. Connected devices are listed in Settings, where you can disconnect them.

Pick how devices reach Webr:

| Setup | Command |
| --- | --- |
| Local network | `webr service install --lan` |
| Tailscale | `tailscale serve --bg 4321`, then `webr service install --origin https://<machine>.<tailnet>.ts.net` |
| Another proxy | `webr service install --origin https://webr.example.com` |

A request counts as local only when it comes from the loopback interface, names `localhost` or `127.0.0.1` as its host, and carries no forwarding headers. A proxy must therefore keep the public hostname.

## Add to Home Screen

Webr is installable, so a phone can open it full screen with its own icon.

- **iPhone / iPad (Safari):** open Webr, tap Share, then **Add to Home Screen**.
- **Android (Chrome):** open the menu, then **Install app** or **Add to Home Screen**.

Connect the device first (see above). Webr has no service worker and caches nothing offline: it shows live terminals and must never serve a stale UI, so the installed app needs a connection like the browser does.

Brand icons are generated from `assets/brand/icon.png` with `mise exec -- pnpm icons`.

## Develop

```sh
mise exec -- pnpm dev
mise exec -- pnpm test
```
