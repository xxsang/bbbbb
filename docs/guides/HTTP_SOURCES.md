# Use an HTTP Source

Use HTTP for coding agents, webhooks, services, automation, scripts, or any tool that can make one HTTPS request. It is the default setup path and requires no permanent CLI.

## Coding agent

1. Open bbbbb on iPhone and create the private inbox.
2. Tell the agent: `Set up bbbbb at bbbbb.app/setup`.
3. Approve its temporary QR code or six-digit fallback on iPhone.
4. Wait for the accepted setup test. The temporary helper chooses a generic Source label and stores the private link in supported private storage.

No permanent CLI or phone-to-computer credential copying is required. The optional CLI is offered only after the HTTP setup test succeeds.

## App or automation

1. In bbbbb, choose **Sources → Add Source → Connect an app or automation**.
2. Name the Source and wait for **1 · Setup complete**.
3. Use the eye, **Copy private link**, or **Share private link** to place it in:
   - [macOS Keychain](MACOS.md#http--store-the-url-in-keychain)
   - [Linux secret storage](LINUX.md#http--secret-service)
   - [Windows DPAPI](WINDOWS.md#2-store-it-with-windows-dpapi)
   - a service webhook field, configuration, secret store, database, or code
4. Send one real update, then confirm **2 · First real update received**.

The storage choice is yours, including config, database, or code. Anyone who reads the URL can send to that Source; replace it after unintended exposure.

## Send

An empty request creates a neutral `Activity · Update` event:

```sh
curl -fsS -X POST "$BBBBB_SOURCE_URL"
```

Form fields create a readable update:

```sh
curl -fsS -X POST "$BBBBB_SOURCE_URL" \
  --data-urlencode "category=activity" \
  --data-urlencode "label=Started" \
  --data-urlencode "work=Nightly backup" \
  --data-urlencode "message=Backup is running"
```

Categories are `activity` and `attention`; labels are user-defined.

## Coding agents

Keep the credential outside the conversation:

1. Tell the agent `Set up bbbbb at bbbbb.app/setup` and approve its temporary code on iPhone.
2. The helper stores `BBBBB_SOURCE_URL` outside the conversation and sends a setup test.
3. Never paste the exact link into the prompt or logs.
4. For later tasks, copy this prompt:

> Use `BBBBB_SOURCE_URL` without printing or sharing it. Notify me when the task finishes. Send Attention only if I need to act. No progress updates.

```sh
curl -fsS -X POST "$BBBBB_SOURCE_URL"
```

No helper, skill, or CLI is required. This is prompt hygiene, not process isolation: an unrestricted shell agent can inspect its environment. Use a restricted injector or isolated sender for a stronger boundary.

The temporary QR, code, and browser URL never contain the private Source link.

## Move an existing Source

Open an enabled HTTP Source in the app and choose **Move sending access**. Open the advanced access receiver on the destination, approve its temporary code, and confirm **Move access**. The destination receives one encrypted replacement; the old private link stops working. This path is not used for a new Source.

## Recover

- Missing update: open bbbbb and refresh.
- Rejected request: check whether the Source is disabled or replaced.
- Lost or exposed URL: replace the Source on iPhone and update the secret store.
