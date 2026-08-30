# Set up bbbbb on macOS

Choose **HTTP** for coding agents, scripts, webhooks, and services. Install the **CLI** only when you want to wrap a finite command.

## Connect a coding agent

1. Open bbbbb on iPhone and create the private inbox.
2. Tell the agent: `Set up bbbbb at bbbbb.app/setup`.
3. Approve its temporary QR code or six-digit fallback on iPhone.
4. Wait for the accepted setup test. The helper stores the private link in Keychain.

The agent can call that HTTP Source directly. No CLI or helper is required.

## CLI — optional command wrapper

1. Install:

   ```sh
   npm install --global @bbbbbapp/cli
   ```

2. Connect and verify:

   ```sh
   bbbbb setup --name "My Mac"
   bbbbb check
   ```

3. Run:

   ```sh
   bbbbb run -- npm test
   ```

If npm is unavailable, use a verified [GitHub Release](https://github.com/xxsang/bbbbb/releases). The owner-only profile stays at `~/.config/bbbbb/source.json`.

## HTTP — store the URL in Keychain

1. Use the coding-agent setup above, or choose **Connect an app or automation** in the app to create a manual HTTP Source.
2. Run:

   ```sh
   security add-generic-password -U -a "$USER" -s bbbbb-http-source -w
   ```

3. Paste the URL only at the hidden `password data` prompt.
4. Send a test without printing the URL:

   ```sh
   BBBBB_SOURCE_URL="$(security find-generic-password -a "$USER" -s bbbbb-http-source -w)"
   export BBBBB_SOURCE_URL
   curl -fsS -X POST "$BBBBB_SOURCE_URL"
   unset BBBBB_SOURCE_URL
   ```

Success creates one update on iPhone.

## Start a coding agent

Inject `BBBBB_SOURCE_URL` only into the agent process, then give it the secret-free instructions from the app. Never paste the exact URL into the prompt.

Prompt:

> Use `BBBBB_SOURCE_URL` without printing or sharing it. Notify me when the task finishes. Send Attention only if I need to act. No progress updates.

An unrestricted shell agent can still inspect its environment. Use a restricted secret injector or isolated sender when that matters.

## If it fails

- `bbbbb check` is not `Ready.`: rerun `bbbbb setup` or inspect the Source on iPhone.
- Keychain item missing: recreate it with the command above.
- URL exposed: replace that Source on iPhone and save the replacement in Keychain.
