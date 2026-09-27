import {describe, it} from 'node:test'
import assert from 'node:assert'
import {isClass} from '../../lib/ioc/Utils.js'
import {BaseObject} from '../../lib/base/BaseObject.js'
import {Container} from '../../lib/core/Container.js'
import {IsSubclassOf} from '../../lib/helpers/internal/IsSubclassOf.js'
import {DTO} from '../../lib/dto/DTO.js'
import {Provider} from '../../lib/core/Provider.js'
import {DefineObjectType, ObjectType} from '../../lib/base/internal/ObjectType.js'
import {Scoped} from '../../decorators/di/Lifetime.js'
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

//A controller (from the entrypoint package) is recognized by its object type
@Scoped(true)
@DefineObjectType(ObjectType.Controller)
class MarkedController extends Provider {
    @Configurable(DTO.Any())
    public readonly context: unknown
}

await describe('IoC Test', async function (): Promise<void> {
    await it('isClass() recognizes classes and constructor functions only', async (): Promise<void> => {
        // eslint-disable-next-line @typescript-eslint/no-extraneous-class
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

    await it('IsSubclassOf() gives the same result as DTO.Class() validation', async (): Promise<void> => {
        // eslint-disable-next-line @typescript-eslint/no-extraneous-class
        class Unrelated {
        }

        const values: unknown[] = [BaseObject, SubObject, class extends SubObject {
        }, Unrelated, Date, (): void => undefined, function helper(): void {
        }, new Unrelated(), {}, null, 'BaseObject', 1]
        for (const value of values) assert.equal(IsSubclassOf(value, BaseObject), DTO.isValid(value, DTO.Class(BaseObject)), String(value))
        //The validation engine treats undefined as "not provided" and accepts it, but undefined is no subclass (no call site passes it)
        assert.equal(IsSubclassOf(undefined, BaseObject), false)
    })

    await it('a configured scoped object is owned by its requester, except a controller', async (): Promise<void> => {
        const root: Container = new Container()
        await root.load([ConfiguredProvider, MarkedController])
        const scope: Container = root.createScope()
        const first: ConfiguredProvider = await scope.get(ConfiguredProvider, {context: 1})
        assert.notEqual(await scope.get(ConfiguredProvider, {context: 2}), first)
        //A controller keeps its instance within the request
        const controller: MarkedController = await scope.get(MarkedController, {context: 1})
        assert.equal(await scope.get(MarkedController, {context: 2}), controller)
        assert.equal(controller.context, 1)
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
        } finally {
            rmSync(dir, {recursive: true, force: true})
        }
    })
})

function As<T>(value: unknown): T {
    return value as T
}
