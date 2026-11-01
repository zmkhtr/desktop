import { describe, it } from 'node:test'
import assert from 'node:assert'
import * as Path from 'path'
import { mkdtemp, writeFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { Account } from '../../src/models/account'
import {
  GitHubCLIHostsWatcher,
  IGitHubCLIHost,
  getAccountsToActivateFromGitHubCLI,
  getEndpointForGitHubCLIHost,
  getGitHubCLIConfigDirectory,
  getGitHubCLISwitchForAccount,
  parseGitHubCLIHosts,
  readGitHubCLIHosts,
  switchGitHubCLIAccount,
} from '../../src/lib/gh-cli'

const dotCom = 'https://api.github.com'

const account = (login: string, endpoint = dotCom) =>
  new Account(login, endpoint, '', [], '', login.length, login)

describe('gh-cli', () => {
  describe('getGitHubCLIConfigDirectory', () => {
    it('prefers GH_CONFIG_DIR', () => {
      assert.equal(
        getGitHubCLIConfigDirectory(
          { GH_CONFIG_DIR: '/custom', XDG_CONFIG_HOME: '/xdg' },
          'darwin',
          '/home/me'
        ),
        '/custom'
      )
    })

    it('uses XDG_CONFIG_HOME', () => {
      assert.equal(
        getGitHubCLIConfigDirectory({ XDG_CONFIG_HOME: '/xdg' }, 'linux', '/h'),
        Path.join('/xdg', 'gh')
      )
    })

    it('uses AppData on Windows', () => {
      assert.equal(
        getGitHubCLIConfigDirectory({ AppData: 'C:\\AppData' }, 'win32', 'C:'),
        Path.join('C:\\AppData', 'GitHub CLI')
      )
    })

    it('defaults to ~/.config/gh', () => {
      assert.equal(
        getGitHubCLIConfigDirectory({}, 'darwin', '/Users/me'),
        Path.join('/Users/me', '.config', 'gh')
      )
    })
  })

  describe('parseGitHubCLIHosts', () => {
    it('parses multiple accounts and the active one', () => {
      const hosts = parseGitHubCLIHosts(
        [
          'github.com:',
          '    git_protocol: https',
          '    users:',
          '        monalisa:',
          '        hubot:',
          '            oauth_token: gho_secret',
          '    user: hubot',
          '    oauth_token: gho_secret',
          'ghe.example.com:',
          '    users:',
          '        "octo-cat":',
          '    user: "octo-cat"',
          '',
        ].join('\n')
      )
      assert.deepEqual(hosts, [
        {
          host: 'github.com',
          activeLogin: 'hubot',
          logins: ['monalisa', 'hubot'],
        },
        {
          host: 'ghe.example.com',
          activeLogin: 'octo-cat',
          logins: ['octo-cat'],
        },
      ])
      // Tokens are never surfaced.
      assert.ok(!JSON.stringify(hosts).includes('gho_secret'))
    })

    it('parses the single-account format of older gh versions', () => {
      const hosts = parseGitHubCLIHosts(
        'github.com:\r\n  user: monalisa\r\n  git_protocol: ssh\r\n'
      )
      assert.deepEqual(hosts, [
        { host: 'github.com', activeLogin: 'monalisa', logins: ['monalisa'] },
      ])
    })

    it('handles hosts without an active account and comments', () => {
      const hosts = parseGitHubCLIHosts(
        '# managed by gh\ngithub.com:\n    users:\n        monalisa: # first\n'
      )
      assert.deepEqual(hosts, [
        { host: 'github.com', activeLogin: null, logins: ['monalisa'] },
      ])
    })

    it('returns no hosts for an empty file', () => {
      assert.deepEqual(parseGitHubCLIHosts(''), [])
    })
  })

  describe('getEndpointForGitHubCLIHost', () => {
    it('maps hosts to API endpoints', () => {
      assert.equal(getEndpointForGitHubCLIHost('github.com'), dotCom)
      assert.equal(
        getEndpointForGitHubCLIHost('ghe.example.com'),
        'https://ghe.example.com/api/v3'
      )
      assert.equal(
        getEndpointForGitHubCLIHost('acme.ghe.com'),
        'https://api.acme.ghe.com/'
      )
    })
  })

  describe('gh to Desktop', () => {
    const hosts: ReadonlyArray<IGitHubCLIHost> = [
      {
        host: 'github.com',
        activeLogin: 'hubot',
        logins: ['monalisa', 'hubot'],
      },
    ]

    it('activates the parked account that is active in gh', () => {
      const hubot = account('hubot')
      assert.deepEqual(
        getAccountsToActivateFromGitHubCLI(
          hosts,
          [account('monalisa')],
          [hubot]
        ),
        [hubot]
      )
    })

    it('matches logins case-insensitively', () => {
      const hubot = account('HuBot')
      assert.deepEqual(getAccountsToActivateFromGitHubCLI(hosts, [], [hubot]), [
        hubot,
      ])
    })

    it('does nothing when the account is already active', () => {
      assert.deepEqual(
        getAccountsToActivateFromGitHubCLI(hosts, [account('hubot')], []),
        []
      )
    })

    it('ignores gh accounts Desktop is not signed into', () => {
      assert.deepEqual(
        getAccountsToActivateFromGitHubCLI(
          hosts,
          [account('monalisa')],
          [account('hubot', 'https://ghe.example.com/api/v3')]
        ),
        []
      )
    })
  })

  describe('Desktop to gh', () => {
    const hosts: ReadonlyArray<IGitHubCLIHost> = [
      {
        host: 'github.com',
        activeLogin: 'monalisa',
        logins: ['monalisa', 'HuBot'],
      },
    ]

    it('switches gh to the account using gh login casing', () => {
      assert.deepEqual(getGitHubCLISwitchForAccount(hosts, account('hubot')), {
        host: 'github.com',
        login: 'HuBot',
      })
    })

    it('does nothing when gh already has the account active', () => {
      assert.equal(
        getGitHubCLISwitchForAccount(hosts, account('monalisa')),
        null
      )
    })

    it('does nothing when gh is not signed into the account', () => {
      assert.equal(getGitHubCLISwitchForAccount(hosts, account('octo')), null)
      assert.equal(
        getGitHubCLISwitchForAccount(
          hosts,
          account('hubot', 'https://ghe.example.com/api/v3')
        ),
        null
      )
    })

    it('runs gh auth switch with the host and user', async () => {
      const calls = new Array<ReadonlyArray<string>>()
      await switchGitHubCLIAccount(
        { host: 'github.com', login: 'hubot' },
        async args => {
          calls.push(args)
        }
      )
      assert.deepEqual(calls, [
        ['auth', 'switch', '--hostname', 'github.com', '--user', 'hubot'],
      ])
    })
  })

  describe('reading and watching hosts.yml', () => {
    it('reads no hosts when gh is not configured', async () => {
      assert.deepEqual(
        await readGitHubCLIHosts(Path.join(tmpdir(), 'does-not-exist-gh')),
        []
      )
    })

    it('reports changes when gh switches accounts', async t => {
      const dir = await mkdtemp(Path.join(tmpdir(), 'gh-config-'))
      t.after(() => rm(dir, { recursive: true, force: true }))
      const file = Path.join(dir, 'hosts.yml')
      const write = (user: string) =>
        writeFile(
          file,
          `github.com:\n    users:\n        monalisa:\n        hubot:\n    user: ${user}\n`
        )
      await write('monalisa')

      const reports = new Array<string | null>()
      let notify: () => void = () => {}
      const watcher = new GitHubCLIHostsWatcher(
        hosts => {
          reports.push(hosts[0]?.activeLogin ?? null)
          notify()
        },
        dir,
        10
      )
      t.after(() => watcher.dispose())

      const next = () => new Promise<void>(resolve => (notify = resolve))

      let reported = next()
      watcher.scheduleRead()
      await reported
      assert.deepEqual(reports, ['monalisa'])

      reported = next()
      await write('hubot')
      await reported
      assert.equal(reports.at(-1), 'hubot')
    })
  })
})
