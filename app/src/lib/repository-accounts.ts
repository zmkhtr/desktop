import { Account, isDotComAccount } from '../models/account'
import { Repository } from '../models/repository'

/**
 * Which signed-in account each repository belongs to.
 *
 * When several accounts are signed in, the repository list only shows the
 * repositories belonging to active accounts so accounts don't mix. A
 * repository belongs to the account which was active (for its host) when it
 * was added; repositories added before multiple accounts existed belong to
 * the account active at the time this was first set up.
 *
 * Keyed by repository id, the value identifies the account by endpoint and
 * login (see `getRepositoryOwnerKey`).
 */
export type RepositoryOwners = ReadonlyMap<number, string>

/** The local storage key for the repository owners. */
export const repositoryOwnersKey = 'repository-account-owners'

/** Identify an account across token changes and parking. */
export const getRepositoryOwnerKey = (account: Account) =>
  `${account.endpoint}\n${account.login.toLowerCase()}`

/** Parse stored owners, ignoring anything malformed. */
export function parseRepositoryOwners(
  raw: string | null | undefined
): RepositoryOwners {
  const owners = new Map<number, string>()
  if (!raw) {
    return owners
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed !== null && typeof parsed === 'object') {
      for (const [id, owner] of Object.entries(parsed)) {
        const numericId = Number(id)
        if (Number.isInteger(numericId) && typeof owner === 'string') {
          owners.set(numericId, owner)
        }
      }
    }
  } catch {}
  return owners
}

export const serializeRepositoryOwners = (owners: RepositoryOwners) =>
  JSON.stringify(Object.fromEntries(owners))

/**
 * Get the account a newly seen repository belongs to: the active account for
 * the repository's GitHub host, otherwise the active GitHub.com account,
 * otherwise any active account.
 */
export function getDefaultRepositoryOwner(
  repository: Repository,
  accounts: ReadonlyArray<Account>
): Account | null {
  const endpoint = repository.gitHubRepository?.endpoint
  return (
    accounts.find(a => a.endpoint === endpoint) ??
    accounts.find(isDotComAccount) ??
    accounts.at(0) ??
    null
  )
}

/**
 * Assign an owner to every repository which doesn't have one yet, and forget
 * owners of repositories which no longer exist.
 *
 * Returns null when nothing changed. Nothing is assigned while signed out.
 */
export function updateRepositoryOwners(
  repositories: ReadonlyArray<Repository>,
  owners: RepositoryOwners,
  accounts: ReadonlyArray<Account>
): RepositoryOwners | null {
  const updated = new Map<number, string>()
  let changed = false

  for (const repository of repositories) {
    const owner = owners.get(repository.id)
    if (owner !== undefined) {
      updated.set(repository.id, owner)
      continue
    }
    const account = getDefaultRepositoryOwner(repository, accounts)
    if (account !== null) {
      updated.set(repository.id, getRepositoryOwnerKey(account))
      changed = true
    }
  }

  return changed || updated.size !== owners.size ? updated : null
}

/**
 * Whether a repository is shown for the active accounts.
 *
 * Hidden only when it belongs to a parked (signed-in but inactive) account.
 * Repositories without an owner, or whose owner signed out completely, stay
 * visible so they can't get lost.
 */
export function isRepositoryVisibleForAccounts(
  repository: Repository | unknown,
  owners: RepositoryOwners,
  parkedAccounts: ReadonlyArray<Account>
): boolean {
  if (!(repository instanceof Repository)) {
    return true
  }
  const owner = owners.get(repository.id)
  return (
    owner === undefined ||
    !parkedAccounts.some(a => getRepositoryOwnerKey(a) === owner)
  )
}

/** Get the repositories shown for the active accounts. */
export function filterRepositoriesForAccounts<T>(
  repositories: ReadonlyArray<T>,
  owners: RepositoryOwners,
  parkedAccounts: ReadonlyArray<Account>
): ReadonlyArray<T> {
  return parkedAccounts.length === 0
    ? repositories
    : repositories.filter(r =>
        isRepositoryVisibleForAccounts(r, owners, parkedAccounts)
      )
}

/** Get the account a repository belongs to among the signed-in accounts. */
export function getRepositoryOwner(
  repository: Repository,
  owners: RepositoryOwners,
  accounts: ReadonlyArray<Account>
): Account | null {
  const owner = owners.get(repository.id)
  return accounts.find(a => getRepositoryOwnerKey(a) === owner) ?? null
}
