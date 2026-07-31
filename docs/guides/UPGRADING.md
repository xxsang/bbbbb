# Upgrade bbbbb

## CLI binary

```sh
npm install --global @bbbbbapp/cli@latest
bbbbb check
```

Release users download and verify the new archive from [GitHub Releases](https://github.com/xxsang/bbbbb/releases), then replace the binary. The Source profile remains at `~/.config/bbbbb/source.json`.

## Earlier versions

V1.1 starts with a clean Source setup. Sources, history, keys, and actions from earlier versions are not imported.

V1.0 users reset or reinstall the iPhone app, delete disposable hosted data, and recreate each HTTP or CLI Source. A developer who wants both sending methods creates two Sources; an HTTP Source is never converted in place to a CLI Source.

Before replacing a hosted deployment, record the source revision, Worker bundle digest, migration-set digest, deployment-manifest digest, and D1 recovery point, then run the full checks against that exact revision. Rollback disables the current deployment; it never relabels or downgrades encrypted rows.
