/**
 * Support for running separate GitHub Desktop instances ("profiles").
 *
 * Each profile has its own user data directory (settings, repository list,
 * accounts) and its own secure storage entries, so instances launched with
 * different profiles don't interfere with each other. The default profile
 * (no profile given) uses exactly the same locations as before.
 */

/** The environment variable carrying the profile name. */
export const DesktopProfileEnvironmentKey = 'GITHUB_DESKTOP_PROFILE'

/** The command line argument selecting a profile, i.e. `--profile=work`. */
const profileArgPrefix = '--profile='

const validProfileName = /^[a-z0-9][a-z0-9_-]{0,31}$/i

/**
 * Normalize a profile name, returning null for the default profile or an
 * invalid name. Names are restricted so they're safe to use in paths and
 * secure storage keys.
 */
export function parseDesktopProfileName(
  value: string | undefined | null
): string | null {
  const name = value?.trim().toLowerCase()
  if (!name || name === 'default' || !validProfileName.test(name)) {
    return null
  }
  return name
}

/**
 * Get the profile requested on the command line (`--profile=<name>` or
 * `--profile <name>`), falling back to the environment.
 */
export function getDesktopProfileFromArgs(
  argv: ReadonlyArray<string>,
  env: NodeJS.ProcessEnv
): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith(profileArgPrefix)) {
      return parseDesktopProfileName(arg.substring(profileArgPrefix.length))
    }
    if (arg === '--profile' && i + 1 < argv.length) {
      return parseDesktopProfileName(argv[i + 1])
    }
  }
  return parseDesktopProfileName(env[DesktopProfileEnvironmentKey])
}

/** Get the user data directory for a profile from the default directory. */
export function getUserDataPathForProfile(
  defaultPath: string,
  profile: string | null
): string {
  return profile === null ? defaultPath : `${defaultPath}-${profile}`
}

/**
 * The profile this process is running as, or null for the default profile.
 *
 * The main process exports the profile to the environment on startup, which
 * renderer processes inherit.
 */
export function getDesktopProfile(): string | null {
  return parseDesktopProfileName(process.env[DesktopProfileEnvironmentKey])
}
