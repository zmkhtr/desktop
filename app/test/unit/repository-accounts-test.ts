import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Account } from '../../src/models/account'
import { Repository } from '../../src/models/repository'
import { GitHubRepository } from '../../src/models/github-repository'
import { Owner } from '../../src/models/owner'
import {
  filterRepositoriesForAccounts,
  getRepositoryOwner,
  getRepositoryOwnerKey,
  parseRepositoryOwners,
  serializeRepositoryOwners,
  updateRepositoryOwners,
} from '../../src/lib/repository-accounts'

const dotCom = 'https://api.github.com'
const ghes = 'https://ghe.example.com/api/v3'

const account = (login: string, endpoint = dotCom) =>
  new Account(login, endpoint, '', [], '', 1, '')

const repository = (id: number, endpoint?: string) =>
  new Repository(
    `/repos/${id}`,
    id,
    endpoint === undefined
      ? null
      : new GitHubRepository(`repo-${id}`, new Owner('octo', endpoint, 1), id),
    false
  )

describe('repository-accounts', () => {
  const monalisa = account('monalisa')
  const hubot = account('hubot')
  const enterprise = account('ent', ghes)

  it('assigns new repositories to the active account for their host', () => {
    const owners = updateRepositoryOwners(
      [repository(1, dotCom), repository(2, ghes), repository(3)],
      new Map(),
      [monalisa, enterprise]
    )
    assert.deepEqual(
      owners,
      new Map([
        [1, getRepositoryOwnerKey(monalisa)],
        [2, getRepositoryOwnerKey(enterprise)],
        // Repositories not on GitHub belong to the GitHub.com account.
        [3, getRepositoryOwnerKey(monalisa)],
      ])
    )
  })

  it('keeps existing owners and forgets removed repositories', () => {
    const owners = new Map([
      [1, getRepositoryOwnerKey(hubot)],
      [9, getRepositoryOwnerKey(hubot)],
    ])
    assert.deepEqual(
      updateRepositoryOwners([repository(1, dotCom)], owners, [monalisa]),
      new Map([[1, getRepositoryOwnerKey(hubot)]])
    )
    assert.equal(
      updateRepositoryOwners(
        [repository(1, dotCom)],
        new Map([[1, getRepositoryOwnerKey(hubot)]]),
        [monalisa]
      ),
      null
    )
  })

  it('assigns nothing while signed out', () => {
    assert.equal(updateRepositoryOwners([repository(1)], new Map(), []), null)
  })

  it('hides repositories of parked accounts only', () => {
    const repos = [repository(1), repository(2), repository(3), repository(4)]
    const owners = new Map([
      [1, getRepositoryOwnerKey(monalisa)],
      [2, getRepositoryOwnerKey(hubot)],
      // Owner signed out completely: stays visible.
      [3, getRepositoryOwnerKey(account('gone'))],
    ])
    assert.deepEqual(
      filterRepositoriesForAccounts(repos, owners, [hubot]).map(r => r.id),
      [1, 3, 4]
    )
    assert.deepEqual(
      filterRepositoriesForAccounts(repos, owners, [monalisa]).map(r => r.id),
      [2, 3, 4]
    )
    assert.equal(filterRepositoriesForAccounts(repos, owners, []), repos)
  })

  it('switching accounts swaps the listed repositories', () => {
    const repos = [repository(1), repository(2)]
    let owners = updateRepositoryOwners([repos[0]], new Map(), [monalisa])
    assert.ok(owners !== null)
    // hubot signs in (monalisa is parked) and adds a repository.
    owners = updateRepositoryOwners(repos, owners, [hubot]) ?? owners
    const visible = (parked: ReadonlyArray<Account>) =>
      filterRepositoriesForAccounts(repos, owners, parked).map(r => r.id)
    assert.deepEqual(visible([monalisa]), [2])
    assert.deepEqual(visible([hubot]), [1])
  })

  it('matches owners case-insensitively', () => {
    const owners = new Map([[1, getRepositoryOwnerKey(account('HuBot'))]])
    assert.equal(
      getRepositoryOwner(repository(1), owners, [monalisa, hubot]),
      hubot
    )
  })

  it('round-trips through storage and ignores garbage', () => {
    const owners = new Map([[4, getRepositoryOwnerKey(monalisa)]])
    assert.deepEqual(
      parseRepositoryOwners(serializeRepositoryOwners(owners)),
      owners
    )
    assert.deepEqual(parseRepositoryOwners('not json'), new Map())
    assert.deepEqual(parseRepositoryOwners('{"x":"a","2":3}'), new Map())
    assert.deepEqual(parseRepositoryOwners(null), new Map())
  })
})
