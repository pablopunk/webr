# Webr

> Control your Herdr agents from anywhere.

> [!IMPORTANT]
> This repo is a WIP. Expect bugs and breaking changes

![Webr demo](./assets/demo.gif)

## Start Webr with Herdr

```sh
webr plugin install [--lan] [--port <port>] [--origin <url>]
```

The Herdr plugin starts Webr whenever the Herdr server starts, using the `webr` on your PATH (or `npx @pablopunk/webr` if there is none). Settings are saved once at install time; check on it with `webr plugin status` and remove it with `webr plugin uninstall`.

| | Plugin | `webr service` |
| --- | --- | --- |
| Starts | when the Herdr server starts | at login, restarts if it crashes |
| Use it | on a machine where you run Herdr | on a headless machine with no Herdr session at login |

Use one or the other, not both. Installing the plugin warns when the service is also installed.

Webr logs to `~/.local/state/herdr/plugins/pablopunk.webr/webr.log`.

### Developing Webr

`pnpm dev` links the plugin to your checkout only if you already installed it, so Herdr starts your checkout instead of the global `webr`. When dev stops, the installed plugin is restored. It never installs the plugin for you.
