# Authentication

Authenticating to Proton is not straightforward: different flows depending on user settings (2FA, hardware keys), CAPTCHA challenges, and auth tokens not having the necessary scopes. The good news is you only have to log in once; after that, secrets are securely saved in an encrypted vault and tokens are refreshed automatically.

## Security

**Passwords are never logged or stored.** They are used only during the authentication handshake and immediately discarded.

**Tokens are encrypted at rest.** All authentication data (access tokens, refresh tokens, key passwords) is stored in an AES-256-GCM encrypted vault (`sessions/vault.enc`). The encryption key is stored separately in your OS keychain (Linux: Secret Service/GNOME Keyring, macOS: Keychain, Windows: Credential Manager) or in a Docker secret file for headless environments.

## Quick Start

```bash
tamer auth
# Select method:
#   1. browser - Open a window, log in, window closes (recommended)
#   2. login   - Enter Proton credentials (needs Go)
#   3. rclone  - Paste rclone config section
```

After successful authentication, `config.yaml` is updated with your selected method.

---

## Login (Recommended)

Password login via Go SRP or the `/auth` page. Tries Lumo scope first (sync on). CAPTCHA falls back to Drive-scoped tokens (chat only).

Uses Proton's SRP (Secure Remote Password) protocol via a Go binary built from [go-proton-api](https://github.com/henrybear327/go-proton-api).

### Why Login?

- **No browser dependency**: Pure API-based authentication
- **Direct keyPassword access**: Derives the mailbox password needed for encryption

### Setup

Desktop: `tamer auth login` (build the Go binary first with `npm run build:login`).

Docker / Portainer: start only `tamer` and open `http://<host>:3003/auth`. Same form, no extra container.

> **Tip:** If you hit a CAPTCHA, try logging in to Proton in any regular browser from the same IP first. This may clear the challenge for subsequent login attempts.

### Config

```yaml
auth:
  method: login
  login:
    binaryPath: "./dist/proton-auth"
    # Headers to help avoid CAPTCHA
    appVersion: "macos-drive@1.0.0-alpha.1+rclone"
    userAgent: "Mozilla/5.0 ..."
```

### Limitations

- **CAPTCHA**: May trigger CAPTCHA. We then retry without Lumo scope (chat only). Same-IP visit to lumo.proton.me usually clears it.
- **TOTP only**: Only supports TOTP for 2FA (no security keys)

### Troubleshooting

**"proton-auth binary not found"**
- Build it: `cd src/auth/login/go && go build -o ../../../../dist/proton-auth && cd -`

**"Authentication failed"**
- Verify username/password
- Check if 2FA is enabled (will prompt for TOTP)
- Try browser method as fallback

---

## Browser

Default. `tamer auth` opens a window (system Chrome/Edge if present, otherwise Playwright Chromium), you log in to Lumo, tokens are saved, the window closes. No extra browser container to deploy or leave running.

This is the only method that supports full conversation sync, and CAPTCHA / security keys work as in a normal browser.

### Setup

```bash
tamer auth
# or: tamer auth browser
```

Log in in the window that opens. When you reach the Lumo chat, extraction runs and the window closes.

Cookies live in `sessions/browser-profile` (small). The browser binary is whatever is already on the machine.

### Headless / Docker

Start `tamer` and open `http://<host>:3003/auth` in any browser. Type Proton email, password, and 2FA. No Chromium container, no files to copy.

The server starts even without a vault. Chat endpoints return 503 until this page succeeds.

`/auth` logs in as Lumo (`web-lumo`) and fetches your Proton keys, so conversation sync works. If Proton shows a CAPTCHA, it retries as Drive (chat only). Open https://lumo.proton.me once from the same internet, then retry `/auth` for sync.

**Temporary browser sidecar** if CAPTCHA will not clear or you need sync. This is a full Chromium+noVNC container. Start it, log in at `:3001`, extract, then remove it. Do not leave it running.

```yaml
auth:
  method: browser
  browser:
    launch: false
    cdpEndpoint: "http://browser:9222"
```

```bash
docker compose up -d browser
# open http://<host>:3001  -> log in at lumo.proton.me
docker compose run --rm tamer auth browser   # CDP default, Enter
docker compose down browser
docker compose up -d tamer
```

Tamer must stay stopped or unused during extraction only if you wipe `sessions/` first. You do not need to delete tokens if you are replacing the vault.

### Limitations

- **Needs a display** for `launch: true` (normal desktop). Headless servers use CDP or `login`.
- **Re-auth**: if the refresh token is revoked, run `tamer auth` again (window opens; profile may still be logged in).

### Config

```yaml
auth:
  method: browser
  browser:
    cdpEndpoint: "http://localhost:9222"  # or "http://browser:9222" for Docker
```

### Troubleshooting

**"No browser contexts found. Is the browser running?"**
- Verify the browser is running and the CDP endpoint is reachable: `curl http://localhost:9222/json/version`
- If the browser is on a different machine, you may need to forward the port, e.g. with socat: `socat TCP-LISTEN:9222,fork TCP:<remote-host>:<remote-port>`
- Check firewall/network settings

**"Login timeout. Please log in and try again."**
- The browser was reached but you're not logged in to Lumo. Log in to https://lumo.proton.me in the browser, then re-run `tamer auth browser`.

**"No AUTH-\* cookie found for lumo.proton.me"**
- The browser is on the Lumo page but has no valid auth cookies. Try logging out and back in within the browser.

**"Browser session is not authenticated"**
- The browser session exists but the AUTH cookie is missing or expired. Log in again in the browser.

**`tamer auth` succeeds but `tamer` or `tamer server` fails**

Similar issues:
```
WARN: Persisted session blob found but ClientKey fetch failed
WARN: Conversation persistence may not work without ClientKey
```
- Your browser may be maintaining multiple active sessions, confusing the extraction logic. Log out of Proton, clear all browser data for all proton.me domains (account, root, lumo), then log in again and re-run `tamer auth browser`.

---

## Rclone

Use rclone to log in and copy the tokens from its config file. No conversation sync.

### Why Rclone?

- **No Go toolchain**: Just paste config from existing rclone setup
- **CAPTCHA bypass**: rclone handles CAPTCHA during `rclone config`
- **Full keyPassword**: rclone stores the derived mailbox password

### Setup

1. Install rclone
2. Add a "proton drive" remote named "lumo-tamer" as described here: https://rclone.org/protondrive/. If you hit a CAPTCHA, try logging in to Proton in any regular browser from the same IP first. See [rclone remote setup](https://rclone.org/remote_setup/) for extra ways to login into rclone.
3. Test if rclone succeeds: `rclone about lumo-tamer:`
4. Find your rclone config file: `~/.config/rclone/rclone.conf` (Linux/macOS) or `%APPDATA%\rclone\rclone.conf` (Windows)
5. Copy the tokens under lumo-tamer manually or `grep -A 6 "lumo-tamer" rclone.conf`
6. Run `tamer auth rclone`.
7. Paste your rclone config section when prompted.

> **Warning:** This method reuses tokens/keys that are stored insecurely by rclone. Use it as a fallback if the other two methods don't work. If you already use rclone for Proton Drive, add a separate remote for lumo-tamer, as lumo-tamer will refresh tokens and invalidate the ones used by rclone.

### Config Format

Paste the INI section from your rclone config:

```ini
[lumo-tamer]
type = protondrive
client_uid = abc123...
client_access_token = xyz789...
client_refresh_token = def456...
client_salted_key_pass = base64encodedKeyPassword==
```

### Limitations

- **No conversation sync**: Cannot fetch userKeys/masterKeys due to API scope restrictions
- **Manual paste**: Must paste config section each time (not auto-read from file)

### Troubleshooting

**"Remote is not a protondrive type"**
- Ensure you're pasting a protondrive section, not another remote type

**"Missing required fields"**
- Your rclone config may need refresh: `rclone config reconnect lumo-tamer:`

---

## Comparison

| Feature | Login | Browser | Rclone |
|---------|-------|---------|--------|
| Conversation sync | Yes (Lumo-scoped SRP; CAPTCHA falls back to no) | Yes | No |
| keyPassword | Yes | Yes | Yes |
| Token refresh | Automatic | Automatic | Automatic |
| 2FA support | TOTP only | Any | Any (via rclone) |
| CAPTCHA handling | May fail | Browser handles | rclone handles |
| Extra tools needed | Go binary | Browser + CDP | rclone |
| Setup complexity | Medium | Medium | Low |

### Conversation Sync

Conversation sync needs a session with Lumo API scope plus real Proton keys:
- **Browser**: always (cookies from lumo.proton.me)
- **Login / `/auth`**: tries `web-lumo` first and fetches `userKeys` + `masterKeys`. CAPTCHA falls back to Drive-scoped tokens (chat only)
- **Rclone**: no Lumo scope

---

## Token Refresh

All auth methods support automatic token refresh:

```yaml
auth:
  autoRefresh:
    enabled: true        # Enable automatic refresh (default: true)
    intervalHours: 20    # Scheduled refresh interval (default: 20)
    onError: true        # Refresh on 401 errors (default: true)
```

### How It Works

All methods store a `refreshToken` and use Proton's `/auth/refresh` endpoint:
- On a schedule (every `intervalHours`)
- On 401 errors (if `onError: true`)

### Manual Refresh

- **CLI command**: `/refreshtokens`
- **API**: `POST /v1/auth/refresh`

### Troubleshooting

When token refresh fails, make sure that:
- Your browser/lumo tabs used for the `browser` auth method are closed after extraction.
- You don't reuse the same tokens (from `browser` or `rclone`) across different machines.

---

## Auth Status

Check current authentication status:

```bash
tamer auth status
```

Shows:
- Current auth method
- Token validity
- Conversation sync support status
- Any warnings

---

## Logout

Use the `/logout` command in any chat (CLI or API).

```bash
# API
curl -X POST http://localhost:3003/v1/auth/logout \
  -H "Authorization: Bearer your-api-key"
```

This revokes the session on Proton's servers and deletes the local token cache.
