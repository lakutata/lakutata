import {describe, it} from 'node:test'
import assert from 'node:assert'
import {ObjectPath} from '../exports/Utils.js'

describe('ObjectPath', (): void => {

    it('gets, sets and tests the nested properties', (): void => {
        const config: Record<string, any> = {db: {hosts: [{name: 'primary', port: 5432}]}}
        assert.strictEqual(ObjectPath.get<number>(config, 'db.hosts[0].port'), 5432)
        ObjectPath.set(config, 'db.user.name', 'admin')
        assert.deepStrictEqual(config.db.user, {name: 'admin'})
        assert.strictEqual(ObjectPath.has(config, 'db.user.name'), true)
    })

    it('refuses the paths through __proto__, constructor or prototype, the prototypes left unchanged', (): void => {
        for (const path of ['__proto__.polluted', 'constructor.prototype.polluted', 'a.__proto__.polluted', 'prototype', 'a[constructor].b', 'x.constructor']) {
            const target: Record<string, any> = {a: {}}
            assert.throws((): void => ObjectPath.set(target, path, 1), TypeError, path)
            //Refused whatever the value, even undefined
            assert.throws((): void => ObjectPath.set(target, path, undefined), TypeError, path)
            assert.deepStrictEqual(target, {a: {}})
        }
        assert.strictEqual(({} as Record<string, unknown>).polluted, undefined)
        assert.strictEqual((Object.prototype as Record<string, unknown>).polluted, undefined)
        //The keys containing these words are allowed
        const target: Record<string, any> = {}
        ObjectPath.set(target, 'constructors.prototypes', 1)
        assert.deepStrictEqual(target, {constructors: {prototypes: 1}})
    })
})
