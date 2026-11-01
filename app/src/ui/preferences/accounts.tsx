import * as React from 'react'
import {
  Account,
  isDotComAccount,
  isEnterpriseAccount,
} from '../../models/account'
import { IAvatarUser } from '../../models/avatar'
import { lookupPreferredEmail } from '../../lib/email'
import { assertNever } from '../../lib/fatal-error'
import { Button } from '../lib/button'
import { Row } from '../lib/row'
import { DialogContent, DialogPreferredFocusClassName } from '../dialog'
import { Avatar } from '../lib/avatar'
import { CallToAction } from '../lib/call-to-action'
import { getHTMLURL } from '../../lib/api'
import { Checkbox, CheckboxValue } from '../lib/checkbox'

interface IAccountsProps {
  readonly accounts: ReadonlyArray<Account>
  /** Signed-in accounts which aren't active for their endpoint. */
  readonly parkedAccounts: ReadonlyArray<Account>
  readonly syncWithGitHubCLI: boolean
  /** The profile this instance runs as, null for the default profile. */
  readonly desktopProfile: string | null

  readonly onDotComSignIn: () => void
  readonly onEnterpriseSignIn: () => void
  readonly onLogout: (account: Account) => void
  readonly onSwitchAccount: (account: Account) => void
  readonly onLogoutParked: (account: Account) => void
  readonly onSyncWithGitHubCLIChanged: (enabled: boolean) => void
}

enum SignInType {
  DotCom,
  Enterprise,
}

export class Accounts extends React.Component<IAccountsProps, {}> {
  public render() {
    const { accounts, parkedAccounts } = this.props
    const dotComAccount = accounts.find(isDotComAccount)
    const parkedDotComAccounts = parkedAccounts.filter(isDotComAccount)

    return (
      <DialogContent className="accounts-tab">
        {this.renderProfile()}
        <h2>GitHub.com</h2>
        {dotComAccount
          ? this.renderAccount(dotComAccount, SignInType.DotCom)
          : parkedDotComAccounts.length === 0
          ? this.renderSignIn(SignInType.DotCom)
          : null}
        {parkedDotComAccounts.map(a => this.renderParkedAccount(a))}
        {dotComAccount || parkedDotComAccounts.length > 0 ? (
          <Button onClick={this.props.onDotComSignIn}>
            Add another GitHub.com account
          </Button>
        ) : null}

        <h2>GitHub Enterprise</h2>
        {this.renderMultipleEnterpriseAccounts()}

        {this.renderGitHubCLISyncSetting()}
      </DialogContent>
    )
  }

  private renderProfile() {
    const { desktopProfile } = this.props
    if (desktopProfile === null) {
      return null
    }
    return (
      <div className="settings-description">
        <p>
          This window runs the <strong>{desktopProfile}</strong> profile, with
          its own accounts, repositories, and settings.
        </p>
      </div>
    )
  }

  private renderGitHubCLISyncSetting() {
    return (
      <div className="github-cli-sync">
        <h2>GitHub CLI</h2>
        <Checkbox
          label="Keep the active account in sync with the GitHub CLI"
          value={
            this.props.syncWithGitHubCLI ? CheckboxValue.On : CheckboxValue.Off
          }
          onChange={this.onSyncWithGitHubCLIChanged}
          ariaDescribedBy="github-cli-sync-description"
        />
        <div id="github-cli-sync-description" className="settings-description">
          <p>
            Switching accounts here also runs <code>gh auth switch</code>, and
            switching with <code>gh auth switch</code> switches GitHub Desktop
            to that account. Each account has to be signed in both here and in
            the GitHub CLI.
          </p>
        </div>
      </div>
    )
  }

  private onSyncWithGitHubCLIChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.props.onSyncWithGitHubCLIChanged(event.currentTarget.checked)
  }

  private renderMultipleEnterpriseAccounts() {
    const enterpriseAccounts = this.props.accounts.filter(isEnterpriseAccount)
    const parkedEnterpriseAccounts =
      this.props.parkedAccounts.filter(isEnterpriseAccount)

    return (
      <>
        {enterpriseAccounts.map(account => {
          return this.renderAccount(account, SignInType.Enterprise)
        })}
        {parkedEnterpriseAccounts.map(a => this.renderParkedAccount(a))}
        {enterpriseAccounts.length === 0 &&
        parkedEnterpriseAccounts.length === 0 ? (
          this.renderSignIn(SignInType.Enterprise)
        ) : (
          <Button onClick={this.props.onEnterpriseSignIn}>
            Add GitHub Enterprise account
          </Button>
        )}
      </>
    )
  }

  private renderParkedAccount(account: Account) {
    return (
      <Row
        className="account-info parked"
        key={`${account.endpoint}/${account.login}`}
      >
        <div className="user-info-container">
          <Avatar
            accounts={this.props.accounts}
            user={{
              name: account.name,
              email: lookupPreferredEmail(account),
              avatarURL: account.avatarURL,
              endpoint: account.endpoint,
            }}
          />
          <div className="user-info">
            <div className="account-title">
              {account.name && account.name !== account.login
                ? `@${account.login} (${account.name})`
                : `@${account.login}`}
            </div>
            <div className="endpoint">
              {isEnterpriseAccount(account)
                ? getHTMLURL(account.endpoint)
                : 'Signed in, not active'}
            </div>
          </div>
        </div>
        <div className="account-actions">
          <Button onClick={this.switchAccount(account)}>
            {__DARWIN__ ? 'Switch To' : 'Switch to'}
          </Button>
          <Button onClick={this.logoutParked(account)}>
            {__DARWIN__ ? 'Sign Out' : 'Sign out'}
          </Button>
        </div>
      </Row>
    )
  }

  private switchAccount = (account: Account) => {
    return () => {
      this.props.onSwitchAccount(account)
    }
  }

  private logoutParked = (account: Account) => {
    return () => {
      this.props.onLogoutParked(account)
    }
  }

  private renderAccount(account: Account, type: SignInType) {
    const avatarUser: IAvatarUser = {
      name: account.name,
      email: lookupPreferredEmail(account),
      avatarURL: account.avatarURL,
      endpoint: account.endpoint,
    }

    // The DotCom account is shown first, so its sign in/out button should be
    // focused initially when the dialog is opened.
    const className =
      type === SignInType.DotCom ? DialogPreferredFocusClassName : undefined

    const hasOtherAccounts = this.props.parkedAccounts.some(
      a => a.endpoint === account.endpoint
    )

    return (
      <Row
        className="account-info"
        key={`${account.endpoint}/${account.login}`}
      >
        <div className="user-info-container">
          <Avatar accounts={this.props.accounts} user={avatarUser} />
          <div className="user-info">
            {isEnterpriseAccount(account) ? (
              <>
                <div className="account-title">
                  {account.name === account.login
                    ? `@${account.login}`
                    : `@${account.login} (${account.name})`}
                </div>
                <div className="endpoint">
                  {getHTMLURL(account.endpoint)}
                  {hasOtherAccounts ? (
                    <span className="active-account-badge">Active</span>
                  ) : null}
                </div>
              </>
            ) : (
              <>
                <div className="name">{account.name}</div>
                <div className="login">
                  @{account.login}
                  {hasOtherAccounts ? (
                    <span className="active-account-badge">Active</span>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </div>
        <Button onClick={this.logout(account)} className={className}>
          {__DARWIN__ ? 'Sign Out' : 'Sign out'}
        </Button>
      </Row>
    )
  }

  private onDotComSignIn = () => {
    this.props.onDotComSignIn()
  }

  private onEnterpriseSignIn = () => {
    this.props.onEnterpriseSignIn()
  }

  private renderSignIn(type: SignInType) {
    const signInTitle = __DARWIN__ ? 'Sign Into' : 'Sign into'
    switch (type) {
      case SignInType.DotCom: {
        return (
          <CallToAction
            actionTitle={signInTitle + ' GitHub.com'}
            onAction={this.onDotComSignIn}
            // The DotCom account is shown first, so its sign in/out button should be
            // focused initially when the dialog is opened.
            buttonClassName={DialogPreferredFocusClassName}
          >
            <div>
              Sign in to your GitHub.com account to access your repositories.
            </div>
          </CallToAction>
        )
      }
      case SignInType.Enterprise:
        return (
          <CallToAction
            actionTitle={signInTitle + ' GitHub Enterprise'}
            onAction={this.onEnterpriseSignIn}
          >
            <div>
              If you are using GitHub Enterprise at work, sign in to it to get
              access to your repositories.
            </div>
          </CallToAction>
        )
      default:
        return assertNever(type, `Unknown sign in type: ${type}`)
    }
  }

  private logout = (account: Account) => {
    return () => {
      this.props.onLogout(account)
    }
  }
}
