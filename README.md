# bbbbb

[English](README.md) | [简体中文](README.zh-CN.md) | [Español](README.es.md) | [日本語](README.ja.md) | [Deutsch](README.de.md) | [Français](README.fr.md) | [Português (Brasil)](README.pt-BR.md)

<p align="center">
  <img src="assets/readme/bbbbb-logo.svg" width="128" alt="bbbbb logo">
</p>

<p align="center">
  <strong>Get notified on your iPhone when your coding agent finishes or needs your help.</strong><br>
  Anything that needs a response stays in your private inbox until you resolve it.
</p>

![Demo: a curl request and a wrapped command each deliver a private update to the bbbbb iPhone inbox](assets/readme/bbbbb-demo.svg)

<p align="center">
  <a href="https://apps.apple.com/us/app/bbbbb-coding-agent-alerts/id6791204016">
    <img src="assets/readme/download-on-the-app-store.svg" height="60" alt="Download on the App Store">
  </a>
</p>

<p align="center">
  <a href="https://bbbbb.app/">Visit bbbbb.app</a>
</p>

bbbbb (“B-five”) also accepts updates from builds, scripts, and web services.

To connect your coding agent, tell it:

> Set up bbbbb at bbbbb.app/setup.

Then approve the connection on your iPhone with a temporary QR code or six-digit code.

Catch up after missed notifications:

- Attention holds questions, failures, approvals, and to-dos until resolved.
- Activity shows other updates.
- Sources send, but never read your inbox or run commands.

## New in v1.5

The app now supports seven languages, with improvements to history saves and CSV exports. The website is available in the same seven languages.

## Quick start

### HTTP, no CLI required

The agent setup above saves an HTTP Source and sends a test message. For other tools, use **Connect an app or automation** on iPhone.

Send through your stored `BBBBB_SOURCE_URL`:

```sh
curl -X POST "$BBBBB_SOURCE_URL"
```

Senders choose the category: Attention may need a response; otherwise use Activity. Keep Source URLs out of prompts and logs.

### Optional CLI

```sh
npm install --global @bbbbbapp/cli
bbbbb setup --name "My Mac"
bbbbb run -- npm test
```

If npm is unavailable, use a verified [GitHub Release](https://github.com/xxsang/bbbbb/releases). See [Install the CLI](docs/guides/CLI_SOURCES.md).

### Coding-agent skill

Install:

```sh
sh scripts/install-bbbbb-notify-skill.sh
```

Prompt:

> Use bbbbb for this task. Notify me when it finishes. Send Attention only if I need to act. No progress updates.

## Guides

| Task | Guide |
| --- | --- |
| Choose a setup | [Installing](docs/guides/INSTALLING.md) |
| Coding agent, webhook, or script | [HTTP Source](docs/guides/HTTP_SOURCES.md) |
| Install the CLI | [CLI Source](docs/guides/CLI_SOURCES.md) |
| macOS, Linux, or Windows | [Platform guides](docs/guides/INSTALLING.md) |
| Self-hosting and operations | [Operations](docs/launch/OPERATIONS.md) |

## Plans and limits

Free includes every core feature: 1,000 updates in any 30-day period. The newest 100 stay encrypted for up to seven days for offline catch-up.

Plus costs US$4.99 once during the first 60 days after launch, including future features. There is no subscription. Core stays free; Plus adds more updates, 30-day catch-up, and export. The regular price is US$6.99 once from October 26, 2026.

Plus raises the rolling limit to 10,000, keeps the newest 500 encrypted updates for up to 30 days, and adds on-device JSON/CSV export.

There is no daily customer quota. Every Inbox has a shared 20-submission-per-minute safety limit, and adding Sources does not add capacity.

## Privacy

CLI events are encrypted before sending; HTTP events are encrypted before storage. Sources can send but cannot read history, and you can check updates after missing a notification.

The developer core is licensed under the [Apache License 2.0](LICENSE). The iPhone app is separate.

<sub>Apple, the Apple logo, and App Store are trademarks of Apple Inc., registered in the U.S. and other countries and regions.</sub>
