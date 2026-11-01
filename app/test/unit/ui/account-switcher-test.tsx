import { describe, it } from 'node:test'
import assert from 'node:assert'
import { Account } from '../../../src/models/account'
import {
  buildAccountSwitcherMenu,
  getAccountSwitcherAccount,
} from '../../../src/ui/toolbar/account-switcher'

const dotCom = 'https://api.github.com'
const ghes = 'https://ghe.example.com/api/v3'

const account = (login: string, endpoint = dotCom, name = '') =>
  new Account(login, endpoint, '', [], '', 1, name)

describe('AccountSwitcher', () => {
  it('shows the active GitHub.com account first', () => {
    const monalisa = account('monalisa')
    assert.equal(
      getAccountSwitcherAccount([account('ent', ghes), monalisa]),
      monalisa
    )
    assert.equal(getAccountSwitcherAccount([]), null)
  })

  it('lists the active account checked and parked accounts to switch to', () => {
    const switched = new Array<string>()
    let managed = 0
    const items = buildAccountSwitcherMenu(
      [account('monalisa', dotCom, 'Mona Lisa')],
      [account('hubot')],
      a => switched.push(a.login),
      () => managed++
    )

    assert.deepEqual(
      items.map(i => [i.label, i.type, i.checked]),
      [
        ['@monalisa (Mona Lisa)', 'checkbox', true],
        ['@hubot', 'checkbox', false],
        [undefined, 'separator', undefined],
        ['Add or Manage Accounts…', undefined, undefined],
      ]
    )
    assert.equal(items[0].action, undefined)
    items[1].action?.()
    items[3].action?.()
    assert.deepEqual(switched, ['hubot'])
    assert.equal(managed, 1)
  })

  it('groups accounts by endpoint when signed into several', () => {
    const items = buildAccountSwitcherMenu(
      [account('monalisa'), account('ent', ghes)],
      [account('hubot')],
      () => {},
      () => {}
    )
    assert.deepEqual(
      items.map(i => i.label ?? i.type),
      [
        'GitHub.com',
        '@monalisa',
        '@hubot',
        'separator',
        'ghe.example.com',
        '@ent',
        'separator',
        'Add or Manage Accounts…',
      ]
    )
    assert.equal(items[0].enabled, false)
  })

  it('only offers account management when signed out', () => {
    const items = buildAccountSwitcherMenu(
      [],
      [],
      () => {},
      () => {}
    )
    assert.deepEqual(
      items.map(i => i.label),
      ['Add or Manage Accounts…']
    )
  })
})
