import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Account } from '../../src/models/account'
import { AccountsStore } from '../../src/lib/stores'
import { InMemoryStore, AsyncInMemoryStore } from '../helpers/stores'
import { getKeyForAccount } from '../../src/lib/auth'
import {
  deserializeAccountCredential,
  serializeAccountCredential,
} from '../../src/lib/account-credential'
import { AccountRequiresSignInError } from '../../src/lib/credential-sessions'
import {
  IGitHubCLIHost,
  getAccountsToActivateFromGitHubCLI,
  getGitHubCLISwitchForAccount,
} from '../../src/lib/gh-cli'

const dotCom = 'https://api.github.com'
const ghes = 'https://ghe.example.com/api/v3'

const account = (login: string, token: string, endpoint = dotCom, id = 1) =>
  new Account(login, endpoint, token, [], '', id, login.toUpperCase())

const logins = (accounts: ReadonlyArray<Account>) => accounts.map(a => a.login)

function createStores() {
  return { data: new InMemoryStore(), secure: new AsyncInMemoryStore() }
}

async function storedToken(secure: AsyncInMemoryStore, a: Account) {
  const credential = deserializeAccountCredential(
    await secure.getItem(getKeyForAccount(a), a.login)
  )
  return credential?.accessToken ?? null
}

describe('AccountsStore with multiple accounts', () => {
  it('parks the active account when another account on the endpoint signs in', async () => {
    const { data, secure } = createStores()
    const store = new AccountsStore(data, secure)
    const monalisa = account('monalisa', 'token-m', dotCom, 1)
    const hubot = account('hubot', 'token-h', dotCom, 2)

    await store.addAccount(monalisa)
    await store.addAccount(hubot)

    assert.deepEqual(logins(await store.getAll()), ['hubot'])
    assert.deepEqual(logins(await store.getParkedAccounts()), ['monalisa'])
    // Parked accounts keep their credential in secure storage, but not in
    // the data store or in memory.
    assert.equal(await storedToken(secure, monalisa), 'token-m')
    assert.equal((await store.getParkedAccounts())[0].token, '')
    assert.ok(!data.getItem('parkedUsers').includes('token-m'))
  })

  it('does not park accounts on other endpoints or the same login', async () => {
    const { data, secure } = createStores()
    const store = new AccountsStore(data, secure)
    await store.addAccount(account('monalisa', 'token-1'))
    await store.addAccount(account('enterprise', 'token-e', ghes, 3))
    await store.addAccount(account('monalisa', 'token-2'))

    assert.deepEqual(logins(await store.getAll()), ['monalisa', 'enterprise'])
    assert.deepEqual(await store.getParkedAccounts(), [])
  })

  it('switches between accounts without signing in again', async () => {
    const { data, secure } = createStores()
    const store = new AccountsStore(data, secure)
    const monalisa = account('monalisa', 'token-m', dotCom, 1)
    const hubot = account('hubot', 'token-h', dotCom, 2)
    await store.addAccount(monalisa)
    await store.addAccount(hubot)

    const active = await store.switchToAccount(monalisa)
    assert.equal(active.login, 'monalisa')
    assert.equal(active.token, 'token-m')
    assert.deepEqual(logins(await store.getAll()), ['monalisa'])
    assert.deepEqual(logins(await store.getParkedAccounts()), ['hubot'])
    assert.equal(await storedToken(secure, hubot), 'token-h')

    // The active account's token is what API and Git operations get.
    const fresh = await store.getAccountWithFreshToken(active)
    assert.equal(fresh.token, 'token-m')

    const back = await store.switchToAccount(hubot)
    assert.equal(back.token, 'token-h')
    assert.deepEqual(logins(await store.getParkedAccounts()), ['monalisa'])
  })

  it('switching to the active account is a no-op', async () => {
    const { data, secure } = createStores()
    const store = new AccountsStore(data, secure)
    await store.addAccount(account('monalisa', 'token-m'))
    const active = await store.switchToAccount(account('monalisa', ''))
    assert.equal(active.token, 'token-m')
    assert.deepEqual(await store.getParkedAccounts(), [])
  })

  it('rejects switching to an account that is not signed in', async () => {
    const { data, secure } = createStores()
    const store = new AccountsStore(data, secure)
    await assert.rejects(store.switchToAccount(account('nobody', '')))
  })

  it('persists active and parked accounts across restarts', async () => {
    const { data, secure } = createStores()
    const store = new AccountsStore(data, secure)
    await store.addAccount(account('monalisa', 'token-m', dotCom, 1))
    await store.addAccount(account('hubot', 'token-h', dotCom, 2))
    await store.switchToAccount(account('monalisa', ''))

    const restarted = new AccountsStore(data, secure)
    const [active] = await restarted.getAll()
    assert.equal(active.login, 'monalisa')
    assert.equal(active.token, 'token-m')
    assert.deepEqual(logins(await restarted.getParkedAccounts()), ['hubot'])

    const switched = await restarted.switchToAccount(account('hubot', ''))
    assert.equal(switched.token, 'token-h')
  })

  it('restores refreshable credentials when switching back', async () => {
    const { data, secure } = createStores()
    const renewals = new Array<string>()
    const store = new AccountsStore(data, secure, async (_url, refresh) => {
      renewals.push(refresh)
      return {
        accessToken: 'renewed-m',
        refreshToken: 'refresh-m2',
        expiresAt: Date.now() + 8 * 60 * 60_000,
      }
    })
    const monalisa = account('monalisa', 'token-m', dotCom, 1)
    await store.addAccount(monalisa, {
      accessToken: 'token-m',
      refreshToken: 'refresh-m',
      expiresAt: 0,
    })
    await store.addAccount(account('hubot', 'token-h', dotCom, 2))

    const active = await store.switchToAccount(monalisa)
    assert.ok(store.isRefreshable(active))
    const fresh = await store.getAccountWithFreshToken(active)
    assert.equal(fresh.token, 'renewed-m')
    assert.deepEqual(renewals, ['refresh-m'])
    assert.equal(await storedToken(secure, monalisa), 'renewed-m')
  })

  it('forgets a parked account whose credential is gone', async () => {
    const { data, secure } = createStores()
    const store = new AccountsStore(data, secure)
    const monalisa = account('monalisa', 'token-m', dotCom, 1)
    await store.addAccount(monalisa)
    await store.addAccount(account('hubot', 'token-h', dotCom, 2))
    await secure.deleteItem(getKeyForAccount(monalisa), 'monalisa')

    await assert.rejects(
      store.switchToAccount(monalisa),
      AccountRequiresSignInError
    )
    assert.deepEqual(await store.getParkedAccounts(), [])
    // The active account is untouched.
    assert.deepEqual(logins(await store.getAll()), ['hubot'])
  })

  it('removes a parked account and its credential only', async () => {
    const { data, secure } = createStores()
    const store = new AccountsStore(data, secure)
    const monalisa = account('monalisa', 'token-m', dotCom, 1)
    const hubot = account('hubot', 'token-h', dotCom, 2)
    await store.addAccount(monalisa)
    await store.addAccount(hubot)

    const removed = await store.removeParkedAccount(monalisa)
    assert.equal(removed?.token, 'token-m')
    assert.deepEqual(await store.getParkedAccounts(), [])
    assert.equal(await storedToken(secure, monalisa), null)
    assert.equal(await storedToken(secure, hubot), 'token-h')
    assert.equal(await store.removeParkedAccount(monalisa), null)
  })

  it('keeps parked accounts when the active account signs out', async () => {
    const { data, secure } = createStores()
    const store = new AccountsStore(data, secure)
    const monalisa = account('monalisa', 'token-m', dotCom, 1)
    const hubot = account('hubot', 'token-h', dotCom, 2)
    await store.addAccount(monalisa)
    await store.addAccount(hubot)

    await store.removeAccount(hubot)
    assert.deepEqual(await store.getAll(), [])
    assert.deepEqual(logins(await store.getParkedAccounts()), ['monalisa'])

    const active = await store.switchToAccount(monalisa)
    assert.equal(active.token, 'token-m')
  })

  it('loads data written by versions without multiple accounts', async () => {
    const { data, secure } = createStores()
    const monalisa = account('monalisa', '', dotCom, 1)
    data.setItem('users', JSON.stringify([monalisa]))
    await secure.setItem(
      getKeyForAccount(monalisa),
      'monalisa',
      serializeAccountCredential({ accessToken: 'token-m' })
    )

    const store = new AccountsStore(data, secure)
    assert.deepEqual(logins(await store.getAll()), ['monalisa'])
    assert.deepEqual(await store.getParkedAccounts(), [])
    // `users` keeps the format older versions read.
    const users = JSON.parse(data.getItem('users'))
    assert.equal(users.length, 1)
  })

  it('ignores parked entries duplicating the active account', async () => {
    const { data, secure } = createStores()
    const monalisa = account('monalisa', '', dotCom, 1)
    data.setItem('users', JSON.stringify([monalisa]))
    data.setItem('parkedUsers', JSON.stringify([monalisa, monalisa]))
    await secure.setItem(
      getKeyForAccount(monalisa),
      'monalisa',
      serializeAccountCredential({ accessToken: 'token-m' })
    )
    const store = new AccountsStore(data, secure)
    assert.deepEqual(await store.getParkedAccounts(), [])
  })
})

describe('bidirectional GitHub CLI sync', () => {
  const ghHosts = (active: string): ReadonlyArray<IGitHubCLIHost> => [
    { host: 'github.com', activeLogin: active, logins: ['monalisa', 'hubot'] },
  ]

  it('follows gh auth switch and settles without switching back', async () => {
    const { data, secure } = createStores()
    const store = new AccountsStore(data, secure)
    await store.addAccount(account('monalisa', 'token-m', dotCom, 1))
    await store.addAccount(account('hubot', 'token-h', dotCom, 2))

    // `gh auth switch --user monalisa`
    let hosts = ghHosts('monalisa')
    for (const a of getAccountsToActivateFromGitHubCLI(
      hosts,
      await store.getAll(),
      await store.getParkedAccounts()
    )) {
      await store.switchToAccount(a)
    }
    const [active] = await store.getAll()
    assert.equal(active.login, 'monalisa')
    // Desktop doesn't need to tell gh anything: it is already in sync.
    assert.equal(getGitHubCLISwitchForAccount(hosts, active), null)

    // Switching in Desktop asks gh to switch...
    const switched = await store.switchToAccount(account('hubot', ''))
    const change = getGitHubCLISwitchForAccount(hosts, switched)
    assert.deepEqual(change, { host: 'github.com', login: 'hubot' })

    // ...and gh's resulting change to hosts.yml doesn't switch Desktop again.
    hosts = ghHosts('hubot')
    assert.deepEqual(
      getAccountsToActivateFromGitHubCLI(
        hosts,
        await store.getAll(),
        await store.getParkedAccounts()
      ),
      []
    )
  })
})
