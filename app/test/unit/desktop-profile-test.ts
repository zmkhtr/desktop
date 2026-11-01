import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert'
import {
  DesktopProfileEnvironmentKey,
  getDesktopProfile,
  getDesktopProfileFromArgs,
  getUserDataPathForProfile,
  parseDesktopProfileName,
} from '../../src/lib/desktop-profile'
import { getKeyForEndpoint } from '../../src/lib/auth'

describe('desktop-profile', () => {
  afterEach(() => {
    delete process.env[DesktopProfileEnvironmentKey]
  })

  it('accepts safe profile names', () => {
    assert.equal(parseDesktopProfileName('Work'), 'work')
    assert.equal(parseDesktopProfileName(' personal-2 '), 'personal-2')
  })

  it('treats empty, default and unsafe names as the default profile', () => {
    for (const name of [undefined, null, '', 'default', '../x', 'a b', '-x']) {
      assert.equal(parseDesktopProfileName(name), null, `${name}`)
    }
    assert.equal(parseDesktopProfileName('x'.repeat(33)), null)
  })

  it('reads the profile from arguments before the environment', () => {
    const env = { [DesktopProfileEnvironmentKey]: 'env' }
    assert.equal(
      getDesktopProfileFromArgs(['app', '--profile=work'], env),
      'work'
    )
    assert.equal(
      getDesktopProfileFromArgs(['app', '--profile', 'oss'], env),
      'oss'
    )
    assert.equal(getDesktopProfileFromArgs(['app'], env), 'env')
    assert.equal(getDesktopProfileFromArgs(['app'], {}), null)
  })

  it('keeps the default user data path for the default profile', () => {
    assert.equal(
      getUserDataPathForProfile('/data/GitHub Desktop', null),
      '/data/GitHub Desktop'
    )
    assert.equal(
      getUserDataPathForProfile('/data/GitHub Desktop', 'work'),
      '/data/GitHub Desktop-work'
    )
  })

  it('namespaces secure storage keys per profile only', () => {
    const endpoint = 'https://api.github.com'
    const defaultKey = getKeyForEndpoint(endpoint)
    assert.ok(defaultKey.endsWith(` - ${endpoint}`))
    assert.ok(!defaultKey.includes('('))

    process.env[DesktopProfileEnvironmentKey] = 'work'
    assert.equal(getDesktopProfile(), 'work')
    const profileKey = getKeyForEndpoint(endpoint)
    assert.notEqual(profileKey, defaultKey)
    assert.ok(profileKey.includes('(work)'))
  })
})
