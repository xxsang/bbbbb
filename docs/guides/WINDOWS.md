# Set up bbbbb on Windows

The standalone CLI is not currently distributed for Windows. Use an **HTTP Source** with PowerShell. WSL users may follow the [Linux guide](LINUX.md) inside WSL.

## 1. Connect the Source

Open `https://bbbbb.app/connect/` on this Windows computer, name the Source, and approve its temporary code in bbbbb on iPhone. Then store the collected private link with DPAPI.

## 2. Store it with Windows DPAPI

Run in PowerShell:

```powershell
$dir = Join-Path $env:APPDATA "bbbbb"
New-Item -ItemType Directory -Force $dir | Out-Null
$secret = Read-Host "Paste Source URL" -AsSecureString
[pscredential]::new("bbbbb-http-source", $secret) |
  Export-Clixml (Join-Path $dir "http-source.xml")
Remove-Variable secret
```

The file is encrypted for your current Windows user. Do not copy it to another account or machine.

## 3. Send a test

```powershell
$stored = Import-Clixml (Join-Path $env:APPDATA "bbbbb\http-source.xml")
$sourceUrl = $stored.GetNetworkCredential().Password
Invoke-RestMethod -Method Post -Uri $sourceUrl -Body @{
  category = "activity"
  label = "Test"
  work = "Windows test"
  message = "DPAPI setup works"
}
Remove-Variable sourceUrl, stored
```

Confirm one update appears on iPhone.

## 4. Use it from a coding agent

Inject the DPAPI-protected value into the PowerShell-capable agent process as `BBBBB_SOURCE_URL`.

> Use `BBBBB_SOURCE_URL` without printing or sharing it. Notify me when the task finishes. Send Attention only if I need to act. No progress updates.

No helper or skill is required. An unrestricted shell agent can still inspect its environment; use a restricted secret injector or isolated sender when that matters.

## If it fails

- DPAPI decryption fails: sign in as the Windows user that created the file.
- Request is rejected: replace the Source on iPhone and store the new URL.
- URL was exposed: replace it immediately; do not reuse it.
