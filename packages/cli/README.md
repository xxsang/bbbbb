# @bbbbbapp/cli

The optional command wrapper and Source setup CLI for bbbbb.

```sh
npm install --global @bbbbbapp/cli
```

Create a phone-approved HTTP Source without retaining the CLI:

```sh
bbbbb setup-http --name "My agent"
```

Automatic mode stores the Source URL in macOS Keychain, Linux Secret Service, or an owner-only file. Use `--store manual` to show it once for any destination you choose.

Install and retain the binary only when you want the commands below.

```sh
bbbbb setup --name "My Mac"
bbbbb check
bbbbb send --category activity --label Started --work "tests" --message "running"
bbbbb run -- make test
```

Setup writes an owner-only Source profile containing only a public encryption key, fixed Source identity, and independent write credential. The CLI cannot read or decrypt inbox history.
