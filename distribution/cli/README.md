# bbbbb setup helper and optional CLI

This archive contains the self-contained `bbbbb` command and portable `bbbbb-notify` skill. It does not require Node.js, npm, Bun, or repository access.

Use the executable temporarily for HTTP-first setup:

```sh
./bbbbb setup-http --name "My agent"
```

It stores the Source URL in Keychain, Secret Service, or an owner-only file by default and sends a real test. Use `--store manual` to reveal the URL once for any destination you choose. The executable does not need to remain installed after HTTP setup.

## Install

1. Verify the archive digest against the release `SHA256SUMS` file.
2. Extract the archive.
3. Move `bbbbb` to a directory on `PATH`, preserving its executable bit.

```sh
tar -xzf bbbbb-v1.1.0-<platform>-<architecture>.tar.gz
install -m 0755 bbbbb-v1.1.0-<platform>-<architecture>/bbbbb "$HOME/.local/bin/bbbbb"
bbbbb --version
```

Keep the binary and create a CLI Source only when you want `bbbbb run`, explicit CLI sends, or encryption before transmission:

```sh
bbbbb setup --name "Build server"
```

Setup writes one owner-only protocol-2 Source profile and confirms the Source is ready. The CLI encrypts every event before transmission and cannot read or decrypt inbox history. Run `bbbbb check` for a separate read-only readiness check.

## Upgrade

Verify and extract the new archive, then replace only the binary:

```sh
install -m 0755 ./bbbbb "$HOME/.local/bin/.bbbbb.new"
mv -f "$HOME/.local/bin/.bbbbb.new" "$HOME/.local/bin/bbbbb"
bbbbb --version
bbbbb check
```

The existing Source profile remains in place.

The archive includes `completion-inbox` as a command-name compatibility symlink. New instructions and integrations should use `bbbbb`; both names execute the same protocol-2 CLI.

The macOS executables are not yet Developer ID-signed or notarized. The compiler may retain an ad hoc or Bun runtime signature. Signed and notarized archives are produced as part of the release process.
