# Set up bbbbb on Linux

Choose **HTTP** for coding agents, SSH hosts, scripts, webhooks, and services. Install the **CLI** only when you want to wrap a finite command.

## Connect a coding agent

1. Open bbbbb on iPhone and create the private inbox.
2. On the Linux desktop, open `https://bbbbb.app/connect/` and name the Source.
3. Approve its temporary QR or six-digit code on iPhone.
4. Store the collected private link in Secret Service or an owner-only file.

The agent can call that HTTP Source directly. No CLI or helper is required. For a headless server, choose **Connect an app or automation** in the app to create a manual HTTP Source, then place its private link through your existing secure channel.

## CLI — optional command wrapper

1. Install:

   ```sh
   npm install --global @bbbbbapp/cli
   ```

2. Connect, verify, and run:

   ```sh
   bbbbb setup --name "Build server"
   bbbbb check
   bbbbb run -- ./nightly-build.sh
   ```

If npm is unavailable, use a verified [GitHub Release](https://github.com/xxsang/bbbbb/releases). The profile defaults to `~/.config/bbbbb/source.json` and must be a regular `0600` file.

## HTTP — Secret Service

With `secret-tool` installed:

```sh
read -rs -p "Paste Source URL: " BBBBB_SOURCE_URL; echo
printf %s "$BBBBB_SOURCE_URL" | secret-tool store --label="bbbbb HTTP Source" application bbbbb source http
unset BBBBB_SOURCE_URL
```

Send a test:

```sh
BBBBB_SOURCE_URL="$(secret-tool lookup application bbbbb source http)" \
  sh -c 'curl -fsS -X POST "$BBBBB_SOURCE_URL"'
```

## HTTP — headless fallback

On a server without Secret Service:

```sh
install -d -m 700 ~/.config/bbbbb
read -rs -p "Paste Source URL: " BBBBB_SOURCE_URL; echo
printf %s "$BBBBB_SOURCE_URL" > ~/.config/bbbbb/http-source-url
chmod 600 ~/.config/bbbbb/http-source-url
unset BBBBB_SOURCE_URL
```

Load it only for the sender process:

```sh
BBBBB_SOURCE_URL="$(cat ~/.config/bbbbb/http-source-url)" \
  sh -c 'curl -fsS -X POST "$BBBBB_SOURCE_URL"'
```

Avoid shell startup files and agent prompts by default. Manual mode may place the URL in config or code when that is the owner's deliberate choice.

## Start a coding agent

Inject `BBBBB_SOURCE_URL` only into the agent process. Never paste the exact URL into the prompt.

> Use `BBBBB_SOURCE_URL` without printing or sharing it. Notify me when the task finishes. Send Attention only if I need to act. No progress updates.

No helper or skill is required. For SSH, place a manual **Connect an app or automation** Source through your existing secret channel, or wrap `ssh` locally with the CLI.
