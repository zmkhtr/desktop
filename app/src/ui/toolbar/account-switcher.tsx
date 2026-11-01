import * as React from 'react'
import { Account, isDotComAccount } from '../../models/account'
import { IMenuItem, showContextualMenu } from '../../lib/menu-item'
import { ToolbarButton } from './button'
import * as octicons from '../octicons/octicons.generated'

interface IAccountSwitcherProps {
  /** The active account for each endpoint. */
  readonly accounts: ReadonlyArray<Account>
  /** Signed-in accounts which aren't active for their endpoint. */
  readonly parkedAccounts: ReadonlyArray<Account>
  readonly onSwitchAccount: (account: Account) => void
  readonly onManageAccounts: () => void
}

const accountLabel = (account: Account) =>
  account.name && account.name !== account.login
    ? `@${account.login} (${account.name})`
    : `@${account.login}`

/**
 * Get the account shown on the toolbar button: the active GitHub.com account
 * if any, otherwise the first active account.
 */
export function getAccountSwitcherAccount(
  accounts: ReadonlyArray<Account>
): Account | null {
  return accounts.find(isDotComAccount) ?? accounts.at(0) ?? null
}

/**
 * Build the account switcher menu: the signed-in accounts grouped by
 * endpoint with the active one checked, followed by account management.
 */
export function buildAccountSwitcherMenu(
  accounts: ReadonlyArray<Account>,
  parkedAccounts: ReadonlyArray<Account>,
  onSwitchAccount: (account: Account) => void,
  onManageAccounts: () => void
): ReadonlyArray<IMenuItem> {
  const endpoints = [
    ...new Set([...accounts, ...parkedAccounts].map(a => a.endpoint)),
  ]
  const showEndpoints = endpoints.length > 1
  const items = new Array<IMenuItem>()

  for (const endpoint of endpoints) {
    const active = accounts.filter(a => a.endpoint === endpoint)
    const parked = parkedAccounts.filter(a => a.endpoint === endpoint)
    const group = [...active, ...parked]

    if (showEndpoints) {
      if (items.length > 0) {
        items.push({ type: 'separator' })
      }
      items.push({ label: group[0].friendlyEndpoint, enabled: false })
    }

    for (const account of active) {
      items.push({
        label: accountLabel(account),
        type: 'checkbox',
        checked: true,
      })
    }
    for (const account of parked) {
      items.push({
        label: accountLabel(account),
        type: 'checkbox',
        checked: false,
        action: () => onSwitchAccount(account),
      })
    }
  }

  if (items.length > 0) {
    items.push({ type: 'separator' })
  }
  items.push({
    label: __DARWIN__ ? 'Add or Manage Accounts…' : 'Add or manage accounts…',
    action: onManageAccounts,
  })

  return items
}

/**
 * A toolbar button showing the active account, opening a menu to switch
 * between signed-in accounts.
 */
export class AccountSwitcher extends React.Component<IAccountSwitcherProps> {
  public render() {
    const account = getAccountSwitcherAccount(this.props.accounts)
    const otherAccounts =
      this.props.accounts.length + this.props.parkedAccounts.length - 1

    const title = account === null ? 'Signed out' : `@${account.login}`
    const tooltip =
      account === null
        ? 'Sign in to a GitHub account'
        : otherAccounts > 0
        ? `Signed in as ${account.login} on ${account.friendlyEndpoint}. Click to switch accounts.`
        : `Signed in as ${account.login} on ${account.friendlyEndpoint}`

    return (
      <ToolbarButton
        className="account-switcher-button"
        icon={octicons.person}
        title={title}
        description={__DARWIN__ ? 'Current Account' : 'Current account'}
        tooltip={tooltip}
        onClick={this.onClick}
        ariaHaspopup="menu"
      />
    )
  }

  private onClick = () => {
    showContextualMenu(
      buildAccountSwitcherMenu(
        this.props.accounts,
        this.props.parkedAccounts,
        this.props.onSwitchAccount,
        this.props.onManageAccounts
      )
    )
  }
}
