import * as Path from 'path'
import * as Os from 'os'
import { execFile } from 'child_process'
import { readFile } from 'fs/promises'
import { watch, FSWatcher } from 'fs'
import { Account } from '../models/account'
import { getAPIEndpoint } from './api'

/**
 * Integration with the GitHub CLI (`gh`) and its multi-account support.
 *
 * `gh` keeps the accounts signed in for each host, and which of them is
 * active, in `hosts.yml` in its config directory:
 *
 *     github.com:
 *         git_protocol: https
 *         users:
 *             monalisa:
 *             hubot:
 *         user: monalisa
 *
 * Desktop only reads which accounts exist and which is active; it never reads
 * or writes `gh`'s tokens. Switching the active `gh` account is done through
 * `gh auth switch` so `gh` stays in charge of its own credentials.
 */

/** The accounts `gh` is signed into on a host. */
export interface IGitHubCLIHost {
  /** The host name, i.e. `github.com`. */
  readonly host: string
  /** The login of the active account, if any. */
  readonly activeLogin: string | null
  /** The logins of all accounts signed in on the host. */
  readonly logins: ReadonlyArray<string>
}

/** A request to make an account active in `gh`. */
export interface IGitHubCLISwitch {
  readonly host: string
  readonly login: string
}

/** Get the directory `gh` stores its configuration in, mirroring `gh` itself. */
export function getGitHubCLIConfigDirectory(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDirectory: string = Os.homedir()
): string {
  if (env.GH_CONFIG_DIR) {
    return env.GH_CONFIG_DIR
  }
  if (env.XDG_CONFIG_HOME) {
    return Path.join(env.XDG_CONFIG_HOME, 'gh')
  }
  if (platform === 'win32' && env.AppData) {
    return Path.join(env.AppData, 'GitHub CLI')
  }
  return Path.join(homeDirectory, '.config', 'gh')
}

const unquote = (value: string) => {
  const v = value.trim()
  return (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
    ? v.substring(1, v.length - 1)
    : v
}

/** Split a YAML mapping line into its key and (possibly empty) value. */
function parseMappingLine(
  line: string
): { indent: number; key: string; value: string } | null {
  const match = /^( *)("[^"]*"|'[^']*'|[^:#][^:]*?)\s*:(?:\s+(.*))?$/.exec(line)
  if (match === null) {
    return null
  }
  const value = (match[3] ?? '').replace(/\s+#.*$/, '')
  return { indent: match[1].length, key: unquote(match[2]), value }
}

/**
 * Parse the hosts and accounts from `gh`'s `hosts.yml`.
 *
 * This understands the subset of YAML `gh` writes for that file (nested
 * block mappings of scalars) rather than YAML in general. Unknown keys are
 * ignored, tokens are never read.
 */
export function parseGitHubCLIHosts(
  yaml: string
): ReadonlyArray<IGitHubCLIHost> {
  const hosts = new Array<IGitHubCLIHost>()
  let host: {
    host: string
    activeLogin: string | null
    logins: string[]
  } | null = null
  let hostIndent = -1
  let usersIndent = -1
  let userIndent = -1

  const flush = () => {
    if (host !== null) {
      const { activeLogin, logins } = host
      // `gh` before multi-account support (< 2.40) only has `user`.
      if (activeLogin !== null && !logins.includes(activeLogin)) {
        logins.push(activeLogin)
      }
      hosts.push(host)
    }
  }

  for (const rawLine of yaml.split(/\r?\n/)) {
    if (rawLine.trim() === '' || rawLine.trim().startsWith('#')) {
      continue
    }
    const line = parseMappingLine(rawLine)
    if (line === null) {
      continue
    }

    if (line.indent === 0) {
      flush()
      host = { host: line.key, activeLogin: null, logins: [] }
      hostIndent = -1
      usersIndent = -1
      userIndent = -1
      continue
    }
    if (host === null) {
      continue
    }

    if (usersIndent !== -1 && line.indent > usersIndent) {
      // Entries directly below `users:` are logins; deeper ones are their
      // settings (i.e. tokens stored in plain text), which we skip.
      if (userIndent === -1) {
        userIndent = line.indent
      }
      if (line.indent === userIndent) {
        host.logins.push(line.key)
      }
      continue
    }

    if (hostIndent === -1) {
      hostIndent = line.indent
    }
    if (line.indent !== hostIndent) {
      continue
    }

    usersIndent = -1
    userIndent = -1
    if (line.key === 'users') {
      usersIndent = line.indent
    } else if (line.key === 'user' && line.value !== '') {
      host.activeLogin = unquote(line.value)
    }
  }
  flush()

  return hosts
}

/** Get the Desktop API endpoint for a host `gh` is signed into. */
export function getEndpointForGitHubCLIHost(host: string): string {
  return getAPIEndpoint(`https://${host}`)
}

const sameLogin = (x: string, y: string) => x.toLowerCase() === y.toLowerCase()

/**
 * Get the accounts to make active in Desktop so they match the active `gh`
 * accounts.
 *
 * Only accounts already signed into Desktop (parked) can be switched to;
 * active `gh` accounts Desktop doesn't know about are ignored.
 */
export function getAccountsToActivateFromGitHubCLI(
  hosts: ReadonlyArray<IGitHubCLIHost>,
  accounts: ReadonlyArray<Account>,
  parkedAccounts: ReadonlyArray<Account>
): ReadonlyArray<Account> {
  const result = new Array<Account>()
  for (const { host, activeLogin } of hosts) {
    if (activeLogin === null) {
      continue
    }
    const endpoint = getEndpointForGitHubCLIHost(host)
    const active = accounts.find(a => a.endpoint === endpoint)
    if (active !== undefined && sameLogin(active.login, activeLogin)) {
      continue
    }
    const parked = parkedAccounts.find(
      a => a.endpoint === endpoint && sameLogin(a.login, activeLogin)
    )
    if (parked !== undefined) {
      result.push(parked)
    }
  }
  return result
}

/**
 * Get the `gh` switch needed to make the account active in `gh`, or null if
 * `gh` doesn't know the account or it's already active.
 */
export function getGitHubCLISwitchForAccount(
  hosts: ReadonlyArray<IGitHubCLIHost>,
  account: Account
): IGitHubCLISwitch | null {
  const host = hosts.find(
    h => getEndpointForGitHubCLIHost(h.host) === account.endpoint
  )
  if (host === undefined) {
    return null
  }
  if (host.activeLogin !== null && sameLogin(host.activeLogin, account.login)) {
    return null
  }
  const login = host.logins.find(l => sameLogin(l, account.login))
  return login === undefined ? null : { host: host.host, login }
}

/** Read the hosts `gh` is signed into; empty if `gh` isn't set up. */
export async function readGitHubCLIHosts(
  configDirectory = getGitHubCLIConfigDirectory()
): Promise<ReadonlyArray<IGitHubCLIHost>> {
  try {
    const contents = await readFile(
      Path.join(configDirectory, 'hosts.yml'),
      'utf8'
    )
    return parseGitHubCLIHosts(contents)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      log.warn('Unable to read GitHub CLI hosts', e)
    }
    return []
  }
}

/** Run a `gh` command; `gh` is looked up on the PATH. */
export type GitHubCLIRunner = (args: ReadonlyArray<string>) => Promise<void>

const runGitHubCLI: GitHubCLIRunner = args =>
  new Promise((resolve, reject) => {
    execFile(
      __WIN32__ ? 'gh.exe' : 'gh',
      [...args],
      { timeout: 15_000, env: { ...process.env, GH_PROMPT_DISABLED: '1' } },
      (error, _stdout, stderr) =>
        error ? reject(new Error(stderr.trim() || error.message)) : resolve()
    )
  })

/** Make an account active in `gh` using `gh auth switch`. */
export function switchGitHubCLIAccount(
  { host, login }: IGitHubCLISwitch,
  run: GitHubCLIRunner = runGitHubCLI
): Promise<void> {
  return run(['auth', 'switch', '--hostname', host, '--user', login])
}

/**
 * Watch `gh`'s config directory and report the signed in hosts whenever
 * `hosts.yml` changes (i.e. after `gh auth switch` or `gh auth login`).
 *
 * The directory is watched rather than the file since `gh` replaces the file
 * when writing it. If the directory doesn't exist yet, watching is retried
 * periodically.
 */
export class GitHubCLIHostsWatcher {
  private watcher: FSWatcher | null = null
  private debounce: ReturnType<typeof setTimeout> | null = null
  private retry: ReturnType<typeof setInterval> | null = null
  private disposed = false

  public constructor(
    private readonly onChanged: (hosts: ReadonlyArray<IGitHubCLIHost>) => void,
    private readonly configDirectory = getGitHubCLIConfigDirectory(),
    private readonly debounceMs = 250
  ) {
    if (!this.tryWatch()) {
      this.retry = setInterval(() => {
        if (this.tryWatch() && this.retry !== null) {
          clearInterval(this.retry)
          this.retry = null
          this.scheduleRead()
        }
      }, 60_000)
    }
  }

  /** Read `hosts.yml` now and report it. */
  public scheduleRead() {
    if (this.disposed) {
      return
    }
    if (this.debounce !== null) {
      clearTimeout(this.debounce)
    }
    this.debounce = setTimeout(async () => {
      this.debounce = null
      const hosts = await readGitHubCLIHosts(this.configDirectory)
      if (!this.disposed) {
        this.onChanged(hosts)
      }
    }, this.debounceMs)
  }

  public dispose() {
    this.disposed = true
    this.watcher?.close()
    this.watcher = null
    if (this.debounce !== null) {
      clearTimeout(this.debounce)
    }
    if (this.retry !== null) {
      clearInterval(this.retry)
    }
  }

  private tryWatch(): boolean {
    try {
      this.watcher = watch(this.configDirectory, (_event, filename) => {
        if (filename === null || filename.toString() === 'hosts.yml') {
          this.scheduleRead()
        }
      })
      this.watcher.on('error', e => {
        log.warn('Stopped watching GitHub CLI config', e)
        this.watcher?.close()
        this.watcher = null
      })
      return true
    } catch {
      return false
    }
  }
}
