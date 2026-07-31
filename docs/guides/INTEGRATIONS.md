# Integrations

Use bbbbb when a discrete update matters but continuous monitoring does not. The sender chooses when to create an Activity or Attention event; bbbbb does not stream logs, answer prompts, or control the machine.

## Coding agents

Open bbbbb on iPhone and create the private inbox. On the agent’s computer, open `https://bbbbb.app/connect/`, name the Source, and approve its temporary QR or six-digit code on iPhone. The computer collects the first private Source link directly.

Store the collected link as `BBBBB_SOURCE_URL` in the environment or secret-injection mechanism used to launch the agent.

Do not put the exact URL in the prompt. Use:

> Use `BBBBB_SOURCE_URL` without printing or sharing it. Notify me when the task finishes. Send Attention only if I need to act. No progress updates.

The agent can send directly:

```sh
curl -fsS -X POST "$BBBBB_SOURCE_URL"
```

No helper, skill, or CLI is required. The owner may store the URL in any destination they control, including config, a database, or code. Anyone with the value can send to that Source.

This keeps the credential out of model context and ordinary output, but it is not strong isolation. An agent with unrestricted shell access can inspect its environment. Use a restricted secret injector or isolated sender if the agent must be technically unable to read the credential.

For the standard agent-task policy, use category `attention` only when a real human decision, permission, credential, or external-state change blocks completion.

Each session sends only updates it explicitly owns. bbbbb does not attach to already-running sessions or broadcast commands into them.

## Shell and experiments

```sh
bbbbb run -- ./long-experiment.sh
```

Exit `0` becomes `Activity · Succeeded`, a nonzero exit becomes `Attention · Failed`, and a terminating signal becomes `Activity · Cancelled`. The child exit status is preserved.

## Remote server or SSH

Install with npm, or use a verified GitHub Release:

```sh
npm install --global @bbbbbapp/cli
```

Run setup in the SSH terminal, then keep the resulting profile owner-only:

```sh
BBBBB_SOURCE_PROFILE=/home/deploy/.config/bbbbb/source.json bbbbb check
BBBBB_SOURCE_PROFILE=/home/deploy/.config/bbbbb/source.json bbbbb run -- ./nightly-build.sh
```

You can also keep the Source on the local computer and wrap an SSH invocation:

```sh
bbbbb run -- ssh build.example ./nightly-build.sh
```

This reports the SSH process's final exit status. It does not install anything remotely or give bbbbb control of the server.

## HTTP Source

Choose this path when a service already has a webhook field or can make an HTTP request. No CLI installation is needed.

1. In the iPhone app, tap **Sources → Add Source**, name the Source, and wait for its automatic test to pass.
   Choose **Webhook or service** for this app-created manual path.
2. Copy its private Source link directly into one of these destinations:
   - a service's destination or webhook URL field;
   - an OS secret manager or verified git-ignored `.env` file named `BBBBB_SOURCE_URL` on a local computer or SSH server;
   - a service or deployment secret named `BBBBB_SOURCE_URL`.
3. Make the value available as `$BBBBB_SOURCE_URL` when a script runs, then send a request whenever that sender chooses.

Protected storage is recommended, but owners may keep the value in source code, config, a database, or another destination when that matches their threat model. Anyone who can read it can send to that Source. Agent-authored output and automatic setup must still avoid prompts, command output, screenshots, tickets, and logs unless the owner explicitly requests the manual value.

An empty request creates `Activity · Update`:

```sh
curl -fsS -X POST "$BBBBB_SOURCE_URL"
```

Use form fields for a short, readable update:

```sh
curl -fsS -X POST "$BBBBB_SOURCE_URL" \
  --data-urlencode "category=activity" \
  --data-urlencode "label=Started" \
  --data-urlencode "work=Nightly backup" \
  --data-urlencode "message=Backup is running"
```

Or send bounded JSON from a service that supports custom webhook bodies:

```json
{"category":"attention","label":"Decision needed","work":"Production deploy","message":"Approval requested"}
```

Each accepted request appears once in Attention or Activity. Do not put the Source URL in the JSON body; it belongs in the request URL. Avoid logs and screenshots by default.

Do not paste the URL into the command or the conversation.
