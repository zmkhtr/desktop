import { Account } from '../models/account'
import { getDesktopProfile } from './desktop-profile'

/** Get the auth key for the user. */
export function getKeyForAccount(account: Account): string {
  return getKeyForEndpoint(account.endpoint)
}

/** Get the auth key for the endpoint. */
export function getKeyForEndpoint(endpoint: string): string {
  const appName = __DEV__ ? 'GitHub Desktop Dev' : 'GitHub'
  // Instances running a separate profile keep their own credentials, so
  // signing into the same account in two profiles can't invalidate the
  // other's rotating refresh token.
  const profile = getDesktopProfile()
  const name = profile === null ? appName : `${appName} (${profile})`

  return `${name} - ${endpoint}`
}
