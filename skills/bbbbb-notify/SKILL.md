---
name: bbbbb-notify
description: Put one short Activity or Attention update from a coding-agent session, HTTP-capable service, or local or remote command in the user's private bbbbb iPhone inbox. Use when the user asks for an alert or when substantial finite work should be safe to leave unattended. Do not use for remote control or claims that an agent process has exited.
---

# bbbbb Notify

Send one short, secret-free update through a phone-approved protocol-2 Source. The sender chooses when to notify: an update may say work started, succeeded, failed, was cancelled, or needs a decision. HTTP is the default transport; the optional CLI encrypts each event before transmission and can wrap a finite command.

## Quick start

If an approved HTTP Source is available through `BBBBB_SOURCE_URL`, macOS Keychain, Linux Secret Service, or the owner-only fallback file, send without installing the CLI or displaying the URL:

```sh
skills/bbbbb-notify/scripts/send-http.sh \
  --category activity \
  --label "Started" \
  --work "Release checks" \
  --message "Running on the release host"
```

The helper works locally or on a remote POSIX host with `curl`. It never prints the Source URL.

If an approved CLI Source already exists and a finite command's real exit status matters:

```sh
bbbbb run -- npm test
```

The command runs normally, sends one terminal update, and preserves the real exit status.

Setup guides: [macOS](https://bbbbb.app/docs/macos/), [Linux](https://bbbbb.app/docs/linux/), [Windows](https://bbbbb.app/docs/windows/), [HTTP](https://bbbbb.app/docs/http-source/), and [CLI](https://bbbbb.app/docs/cli-source/).

## Who should use this skill

Use this single skill for a **shell-capable coding agent** that should send an Activity or Attention update. It covers both first-time setup and normal use:

1. Reuse an HTTP Source from the environment or a supported local store.
2. Otherwise reuse an existing owner-approved protocol-2 CLI Source when one is ready.
3. For new setup, lead with the HTTP-first bootstrap. Choose the CLI only when the user wants command exit-status wrapping or encryption before transmission.

Do not split this into non-CLI, CLI, and setup skills. HTTP and CLI are two transport choices behind one agent workflow. People running commands themselves use `bbbbb run` directly and do not need this skill. Webhooks and services use their HTTP Source URL directly and do not need this skill.

The skill may guide setup, but it must not silently install software, create a Source, or ask the user to paste a Source URL or profile into the conversation. Follow the host agent's normal permission boundary for installation and external state changes.

## Select the setup path

1. If the HTTP helper can resolve `BBBBB_SOURCE_URL` from the environment, Keychain, Secret Service, or the owner-only file, use it. Do not inspect or print the value.
2. If `BBBBB_SOURCE_PROFILE` or the default `~/.config/bbbbb/source.json` already exists as a regular owner-only `0600` file, use it and run `bbbbb check`.
3. For a new HTTP-first agent setup, open [Connect](https://bbbbb.app/connect/) on the sender, name the Source, and ask the owner to approve its QR or six-digit code on iPhone. No software installation is required.
4. For a new encrypted CLI Source, use the [CLI guide](https://bbbbb.app/docs/cli-source/). Install `@bbbbbapp/cli` from npm when available; otherwise use a matching verified GitHub Release. Do not substitute an older preview. After installation, run `bbbbb setup --name <owner-visible-source>`. Keep the default large terminal QR. The command also shows a six-digit same-phone fallback. Use `--relay <approved-relay>` only for an approved local or self-hosted relay.
5. On native Windows, use the PowerShell and DPAPI path in the Windows guide; `scripts/send-http.sh` is for POSIX shells.
6. For SSH or CI, prefer the HTTP path when the environment already has a secret store. A CLI profile remains appropriate when encryption before transmission or `bbbbb run` is required. Unattended CI never waits for phone approval.
7. Automatic modes never read, print, paste, log, or place the profile, Source URL, QR payload, write credential, or temporary claim material in a prompt or command argument. If the owner explicitly chooses `--store manual`, they may place the URL in any destination they control, including config or code.

## Choose who sends

- **This agent session:** use the default approved CLI Source and finish with one `bbbbb send`, or call `scripts/send-http.sh` when the launcher already injected `BBBBB_SOURCE_URL`.
- **All new agent sessions on one computer:** install this skill in the agent's shared skills directory and let all sessions use the same default owner-approved profile. Each session sends only updates it explicitly chooses to send. bbbbb does not attach to, inspect, or broadcast commands into already-running sessions.
- **A local program:** start it with `bbbbb run -- <command> [args...]` so the real child exit determines the terminal category and label.
- **A remote program:** either run setup and `bbbbb run` on that host, or wrap the SSH client locally with `bbbbb run -- ssh <host> <command>`. The latter reports the SSH command's exit status; it does not remotely control the host.
- **A local or remote HTTP-capable program:** keep an HTTP Source URL wherever its owner chooses, make it available as `BBBBB_SOURCE_URL` or a supported local store, and call `scripts/send-http.sh` whenever that program chooses to create an Activity or Attention event.

“All sessions” means the skill and approved Source are available to every new sender session. It never means one hidden broadcast, retroactive process monitoring, inbox access, or remote execution.

## Arm one agent-task notification

Use notification when the user explicitly requests an alert, the task has three or more planned steps, a background/persistent command starts, or the task is about to make its fifth non-notification tool call. Skip trivial Q&A and quick edits. Send no progress events.

For the CLI path, require `command -v bbbbb`, `bbbbb --version`, a regular `0600` Source profile, and a successful read-only check:

```sh
bbbbb check
```

It must print `Ready.` without creating an event. If a restricted environment blocks HTTPS, request only the configured relay and intended check/send/run operation through that environment's permission mechanism, then retry the read-only check. Do not claim the relay is unavailable from sandboxed evidence alone.

For the HTTP path, require only a URL available through the environment or supported local store, the helper, and `curl`. Do not run `bbbbb setup` or treat a missing CLI as a blocker.

For a finite child command whose actual exit must be observed, start it through:

```sh
bbbbb run -- <command> [args...]
```

The wrapper reports after the child terminates, maps objective exit/cancellation state, and preserves the child's real exit status even if delivery fails.

For the agent-task completion policy, finish every mutation and check, prepare the final handoff, then make this the last action:

```sh
bbbbb send --category <activity|attention> --label "<short state>" --work "<short secret-free subject>" --message "<short secret-free message>"
```

For example, use `--category activity --label Succeeded` when the handoff is ready, or `--category attention --label Decision needed` for a genuine human blocker. An accepted send means the update was durably accepted and the final handoff follows. It does not mean the agent process has exited. Do not run another tool after an accepted final-handoff send.

If only an HTTP Source is available, make the equivalent helper call the last action instead. It must print `Accepted.`. Treat any other exit or output as a delivery failure and do not retry after an accepted response.

For this agent-task policy, use category `attention` only for a genuine human decision, permission, credential, or external-state blocker. Category names are routing signals, not lifecycle claims; `label` carries the sender's state wording. Keep event content free of source code, prompts, credentials, personal data, identifiers, secret-bearing filenames, logs, and private URLs. Emit at most one accepted final-handoff update per task unless the user explicitly requests a different notification schedule.
