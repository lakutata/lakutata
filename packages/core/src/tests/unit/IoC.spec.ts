import {describe, it} from 'node:test'
import assert from 'node:assert'
import {isClass} from '../../lib/ioc/Utils.js'
import {BaseObject} from '../../lib/base/BaseObject.js'
import {Container} from '../../lib/core/Container.js'
import {isSubclassOf} from '@lakutata/utils/IsSubclassOf'
import {DTO} from '../../lib/dto/DTO.js'
import {Provider} from '../../lib/core/Provider.js'
import {Configurable} from '../../decorators/di/Configurable.js'
import {listModules, type ModuleDescriptor} from '../../lib/ioc/ListModules.js'
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import path from 'node:path'

class SubObject extends BaseObject {
}

class ConfiguredProvider extends Provider {
    @Configurable(DTO.Any())
    public readonly context: unknown
}

await describe('IoC Test', async function (): Promise<void> {
    await it('isClass() recognizes classes and constructor functions only', async (): Promise<void> => {
        class Plain {
        }

        function LegacyConstructor(): void {
        }

        function helper(): void {
        }

        assert.equal(isClass(Plain), true, 'class')
        assert.equal(isClass(SubObject), true, 'derived class')
        assert.equal(isClass(class {
        }), true, 'anonymous class')
        assert.equal(isClass(LegacyConstructor), true, 'capitalized ES5 constructor function')
        assert.equal(isClass(Date), true, 'built-in constructor')
        assert.equal(isClass(helper), false, 'plain function')
        assert.equal(isClass((): void => undefined), false, 'arrow function')
        assert.equal(isClass(async function Capitalized(): Promise<void> {
        }), false, 'async function')
        assert.equal(isClass(As(undefined)), false, 'not a function')
    })

    await it('builds an object without a registration', async (): Promise<void> => {
        const root: Container = new Container()
        const built: SubObject = await root.build(SubObject)
        assert.ok(built instanceof SubObject)
        await root.destroy()
    })

    await it('isSubclassOf() gives the same result as DTO.Class() validation', async (): Promise<void> => {
        class Unrelated {
        }

        const values: unknown[] = [BaseObject, SubObject, class extends SubObject {
        }, Unrelated, Date, (): void => undefined, function helper(): void {
        }, new Unrelated(), {}, null, 'BaseObject', 1]
        for (const value of values) assert.equal(isSubclassOf(value, BaseObject), DTO.isValid(value, DTO.Class(BaseObject)), String(value))
        //The validation engine treats undefined as "not provided" and accepts it, but undefined is no subclass (no call site passes it)
        assert.equal(isSubclassOf(undefined, BaseObject), false)
    })

    await it('a configured scoped object is owned by its requester, unless the shared instance is requested', async (): Promise<void> => {
        const root: Container = new Container()
        await root.load([ConfiguredProvider])
        const scope: Container = root.createScope()
        const first: ConfiguredProvider = await scope.get(ConfiguredProvider, {context: 1})
        assert.notEqual(await scope.get(ConfiguredProvider, {context: 2}), first)
        //The creator of the scope provides the instance shared within the request, configured for it
        const shared: ConfiguredProvider = await scope.getShared(ConfiguredProvider, {context: 3})
        assert.notEqual(shared, first)
        assert.equal(shared.context, 3)
        assert.equal(await scope.get(ConfiguredProvider), shared)
        assert.equal(await scope.getShared(ConfiguredProvider, {context: 4}), shared)
        //Another request has its own shared instance
        const other: Container = root.createScope()
        assert.equal((await other.getShared(ConfiguredProvider, {context: 5})).context, 5)
        await root.destroy()
    })

    await it('listModules() matches files only and resolves absolute paths', async (): Promise<void> => {
        const dir: string = mkdtempSync(path.join(tmpdir(), 'lakutata-list-modules-'))
        try {
            writeFileSync(path.join(dir, 'First.js'), '')
            writeFileSync(path.join(dir, 'Second.js'), '')
            mkdirSync(path.join(dir, 'Folder.js'))
            const names = (modules: ModuleDescriptor[]): string[] => modules.map((module: ModuleDescriptor): string => module.name).sort()
            const relative: ModuleDescriptor[] = listModules('*.js', {cwd: dir})
            assert.deepEqual(names(relative), ['First', 'Second'], 'directories are not matched')
            assert.ok(relative.every((module: ModuleDescriptor): boolean => path.isAbsolute(module.path) && module.path.startsWith(dir)))
            assert.deepEqual(names(listModules(path.join(dir, '*.js'))), ['First', 'Second'], 'absolute pattern')
            //Case sensitive on every platform, as the fast-glob lookup of 2.x
            writeFileSync(path.join(dir, 'Third.JS'), '')
            assert.deepEqual(names(listModules('*.js', {cwd: dir})), ['First', 'Second'], 'the case of the extension')
            assert.deepEqual(names(listModules('*.JS', {cwd: dir})), ['Third'])
        } finally {
            rmSync(dir, {recursive: true, force: true})
        }
    })
})

function As<T>(value: unknown): T {
    return value as T
}
