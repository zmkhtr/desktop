# Multiple accounts, profiles, and GitHub CLI sync

GitHub Desktop has three ways to work with more than one GitHub account on
the same host (for example a personal and a work account on GitHub.com).

## 1. Multiple accounts in one instance (recommended)

Desktop keeps **one active account per host**. Everything that talks to a
host (API requests, Git over HTTPS, the credential helper, avatars, Copilot)
uses that host's active account, exactly as before. Other accounts on the
same host stay signed in but are *parked*: their credentials stay in the
system keychain and they can be switched to without signing in again.

### Adding an account

1. In your browser, sign in to github.com as the account you want to add
   (GitHub's account switcher is fine).
2. In Desktop open **Settings → Accounts** and choose **Add another
   GitHub.com account**, then complete sign-in in the browser.

The previously active account is parked, not signed out. Signing in to the
same account again just replaces its credential.

### Switching

**Settings → Accounts** lists the active account (marked **Active** when
there are others) and every parked account with **Switch to** and
**Sign out** buttons.

### How it is stored

| What                       | Where                                                            |
| -------------------------- | ---------------------------------------------------------------- |
| Active accounts (no token) | `localStorage['users']` (unchanged format)                       |
| Parked accounts (no token) | `localStorage['parkedUsers']` (new, ignored by older versions)   |
| Tokens                     | Keychain item `GitHub - <endpoint>`, account name = login        |

Keychain items were already keyed by login, so no credential is moved or
rewritten when switching; switching only changes which one is loaded.
Downgrading to an older Desktop keeps the active accounts working and simply
ignores parked ones.

### Limitations

- Only one account per host is active at a time. Repositories that only the
  parked account can access will fail to fetch/push until you switch.
- The commit author is still taken from your Git config (`user.name` /
  `user.email`), not from the active account. Use per-repository Git config or
  `includeIf` for per-account identities.
- SSH remotes are not affected: SSH uses your SSH keys and `~/.ssh/config`,
  not Desktop accounts.
- If a parked account's refresh token expires (unused for a long time), the
  switch fails with a sign-in prompt and the account is removed.

## 2. Separate instances (profiles)

Launching Desktop with `--profile=<name>` runs a fully separate instance with
its own:

- user data directory (`<userData>-<name>`: settings, repository list,
  accounts, logs),
- keychain items (`GitHub (<name>) - <endpoint>`), so signing into the same
  account in two profiles can't invalidate each other's rotating tokens,
- single-instance lock, so profiles run side by side.

Without `--profile` (or with `--profile=default`) nothing changes.

```bash
# macOS (-n starts a new instance even if Desktop is already running)
open -n -a "GitHub Desktop" --args --profile=work

# Windows
"%LocalAppData%\GitHubDesktop\GitHubDesktop.exe" --profile=work

# Linux
github-desktop --profile=work
```

The profile can also be set through the `GITHUB_DESKTOP_PROFILE` environment
variable. Profile names may contain letters, digits, `-` and `_`.

### Limitations

- Browser sign-in and `x-github-client://` links are delivered by the OS to
  one running instance. When signing in to a profile, make sure no other
  Desktop instance is running; once signed in, tokens renew without the
  browser.
- The `github` command line tool opens the default profile.

## 3. GitHub CLI (`gh`) sync

Enable **Settings → Accounts → Keep the active account in sync with the
GitHub CLI**.

- **gh → Desktop:** Desktop watches `gh`'s `hosts.yml` (in `$GH_CONFIG_DIR`,
  `$XDG_CONFIG_HOME/gh`, `%AppData%\GitHub CLI` or `~/.config/gh`). When
  `gh auth switch` changes the active account for a host, Desktop switches to
  the same account if it is signed into it.
- **Desktop → gh:** switching (or signing in) in Desktop runs
  `gh auth switch --hostname <host> --user <login>` if `gh` is signed into
  that account and it isn't already active.

When enabled, Desktop first adopts whatever `gh` currently has active.

### Design notes

- Desktop never reads or writes `gh`'s tokens; it only reads which logins are
  signed in and which is active. `gh` remains in charge of its own
  credentials and `gh auth switch` is the only thing used to change it.
- The two tools use different OAuth apps, so each account must be signed in
  once in **both** Desktop and `gh`. Accounts present in only one of them are
  ignored by the sync.
- Sync is loop-free: applying a change that is already in effect is a no-op
  in both directions.
- `gh` must be on the `PATH` of your login shell (Desktop reads it from the
  shell on macOS and Linux).
- Sync is per Desktop instance; with profiles, enable it in only one profile
  to avoid profiles fighting over the active `gh` account.
