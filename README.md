
<p align="center">
  <img src="./assets/brand/icon.png" height="128" />
</p>
<p align="center">
  <i align="center">Control your Herdr agents from anywhere.</i>
</p>

<h1 align="center">webr</h1>

> [!IMPORTANT]
> This repo is a WIP. Expect bugs and breaking changes

![Webr demo](./assets/demo.gif)

## Features

- 📱 **Pair by QR code**: scan a one-time code, approve the device from your computer, and revoke it any time.
- 🔒 **Private HTTPS over Tailscale**: Webr picks up your tailnet address automatically, so it works away from home and unlocks the microphone.
- ⌨️ **Real terminal, touch-friendly**: click in mouse-aware TUIs, flick to scroll, plus a key bar with Ctrl, Tab and arrows that keeps the keyboard open.
- 🎙️ **Dictate from your phone**: tap the mic and your speech is transcribed on your own computer with Parakeet v3, in 25 languages. The model loads only while you use it.
- 🪟 **Infinite horizontal panes**: niri-style, every pane in a thread sits on one endless strip you slide through.
- 👀 **Agents at a glance**: threads grouped by project, with live status and a notification when an agent needs you.
- 🖼️ **Attach files**: paste or drop screenshots, or drop any file up to 5 MB, into a prompt. Uploads use temporary storage, not project directories. Works on remote machines too: webr copies the file over SSH.
- 🚀 **Jump anywhere**: a command palette for threads and actions, and projects and worktrees on remote machines.

## Mobile

Zero config, PWA, with Tailscale automation out of the box.

<table>
  <tr>
    <td colspan="3"><img src="./assets/brand/tailscale.jpg" /></td>
  </tr>
  <tr>
    <td colspan="3"><img src="./assets/brand/dock.jpg" /></td>
  </tr>
  <tr>
    <td><img src="./assets/brand/sidebar.jpg" /></td>
    <td><img src="./assets/brand/typing.jpg" /></td>
    <td><img src="./assets/brand/cmdk.jpg" /></td>
  </tr>
</table>

## Install

```sh
npx @pablopunk/webr install
```

This installs the Herdr plugin, starts Webr and opens the dashboard, with Tailscale HTTPS configured automatically when it's available.

## Update

For a global install, run `webr update`. For an npx install, refresh the plugin with:

```sh
npx @pablopunk/webr@latest install
```


## LICENSE

AGPL-3.0-or-later
