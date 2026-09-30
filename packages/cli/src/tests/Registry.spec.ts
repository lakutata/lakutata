import {describe, it} from 'node:test'
import assert from 'node:assert'
import {CompareVersions, NewestVersion} from '../lib/Registry.js'

describe('The versions of the registry', (): void => {

    it('orders the versions as semver does', (): void => {
        const ordered: string[] = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.2.0', '2.0.0-verify.1', '2.0.0']
        assert.deepStrictEqual([...ordered].reverse().sort(CompareVersions), ordered)
        assert.strictEqual(CompareVersions('3.0.0', '3.0.0'), 0)
    })

    it('gives the newest version of a major version, its prereleases when it has no release', (): void => {
        const versions: string[] = ['2.0.126', '3.0.0-beta.2', '3.0.0-beta.10', '4.0.0']
        assert.strictEqual(NewestVersion(versions, 2), '2.0.126')
        assert.strictEqual(NewestVersion(versions, 3), '3.0.0-beta.10')
        assert.strictEqual(NewestVersion([...versions, '3.0.0', '3.1.0-rc.1'], 3), '3.0.0')
        assert.strictEqual(NewestVersion(versions, 5), undefined)
        assert.strictEqual(NewestVersion(versions), '4.0.0')
    })
})
