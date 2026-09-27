import {describe, it} from 'node:test'
import assert from 'node:assert'
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {Container} from '@lakutata/core'
import {Cacher} from '../exports/Cacher.js'

describe('Cacher', (): void => {

    it('caches in memory', async (): Promise<void> => {
        const container: Container = new Container()
        const cacher: Cacher = await container.set(Cacher)
        await cacher.set('a', {x: 1})
        assert.deepStrictEqual(await cacher.get('a'), {x: 1})
        await cacher.multipleSet([{key: 'b', value: 2}, {key: 'c', value: 3}])
        assert.deepStrictEqual(await cacher.multipleGet(['b', 'c', 'missing']), [2, 3, undefined])
        assert.ok(await cacher.del('a'))
        assert.strictEqual(await cacher.get('a'), undefined)
        await cacher.clear()
        assert.strictEqual(await cacher.get('b'), undefined)
        await container.destroy()
    })

    it('expires the entries', async (): Promise<void> => {
        const container: Container = new Container()
        const cacher: Cacher = await container.set(Cacher, {ttl: 50})
        await cacher.set('a', 1)
        assert.strictEqual(await cacher.get('a'), 1)
        await new Promise((resolve: (value: void) => void): unknown => setTimeout(resolve, 80))
        assert.strictEqual(await cacher.get('a'), undefined)
        await container.destroy()
    })

    it('caches in files', async (): Promise<void> => {
        const directory: string = await mkdtemp(path.join(tmpdir(), 'cacher-'))
        const container: Container = new Container()
        const cacher: Cacher = await container.set(Cacher, {stores: {type: 'file', filename: path.join(directory, 'cache.json'), writeDelay: 0}})
        await cacher.set('a', 'file value')
        assert.strictEqual(await cacher.get('a'), 'file value')
        await container.destroy()
        await rm(directory, {recursive: true, force: true})
    })
})
