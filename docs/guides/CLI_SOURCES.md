# Use a CLI Source

Use the optional CLI on macOS or glibc Linux to wrap a finite command and preserve its exit status. Coding agents and services can use an [HTTP Source](HTTP_SOURCES.md) without installing the CLI.

## Install

Install from npm:

```sh
npm install --global @bbbbbapp/cli
```

If npm is unavailable, download the archive and `SHA256SUMS` from [GitHub Releases](https://github.com/xxsang/bbbbb/releases), verify the checksum, and install the included binary.

## Connect once

```sh
bbbbb setup --name "My Mac"
bbbbb check
```

Approve the QR or six-digit code on iPhone. `bbbbb check` should print `Ready.`.

## Use

```sh
bbbbb run -- npm test
bbbbb send --category attention \
  --label "Decision needed" \
  --work "Production deploy" \
  --message "Approval requested"
```

## Upgrade

```sh
npm install --global @bbbbbapp/cli@latest
bbbbb check
```

Release users verify and replace the binary. The owner-only Source profile stays at `~/.config/bbbbb/source.json`; rerun setup only if the Source was replaced.

No helper or skill is required for ordinary HTTP sends. Add the CLI only when an agent needs `bbbbb run`.
