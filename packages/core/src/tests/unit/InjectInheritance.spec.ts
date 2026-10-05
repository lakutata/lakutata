import {describe, it} from 'node:test'
import assert from 'node:assert'
import {BaseObject} from '../../lib/base/BaseObject.js'
import {Component} from '../../lib/core/Component.js'
import {Container} from '../../lib/core/Container.js'
import {Inject} from '../../decorators/di/Inject.js'
import {Configurable} from '../../decorators/di/Configurable.js'
import {DTO} from '../../lib/dto/DTO.js'
import {checkObjectOptions} from '../../lib/base/internal/ObjectOptionsCheck.js'
import {OBJECT_ID} from '../../options/LoadObjectOptions.js'

/**
 * The objects injected: they tell their kind
 */
class Dependency extends BaseObject {
    public get kind(): string {
        return this.constructor.name
    }
}

class Alpha extends Dependency {
}

class Beta extends Dependency {
}

class Gamma extends Dependency {
}

class Base extends Component {
    @Inject('alpha')
    public readonly dependency: Dependency

    @Inject('beta')
    public readonly other: Dependency

    //Injected by the name of the property
    @Inject()
    public readonly alpha: Dependency
}

/**
 * Inherits every injection
 */
class Inheriting extends Base {
}

/**
 * Declares the injection of a property of its parent again
 */
class Middle extends Base {
    @Inject('beta')
    public readonly dependency: Dependency
}

/**
 * Declares nothing: the injections of its parent, not of its grandparent
 */
class Leaf extends Middle {
}

/**
 * Declares the injection again over two levels
 */
class Top extends Middle {
    @Inject('gamma')
    public readonly dependency: Dependency
}

/**
 * A sibling of Middle declaring the injection otherwise
 */
class Sibling extends Base {
    @Inject('gamma')
    public readonly dependency: Dependency
}

/**
 * Declares the injection again by a class, and the injection by the name of the property by a name
 */
class ByClass extends Base {
    @Inject(Gamma)
    public readonly dependency: Dependency

    @Inject('gamma')
    public readonly alpha: Dependency
}

/**
 * Declares the injection again with a transform
 */
class Transformed extends Base {
    @Inject('beta', (injection: Dependency): string => injection.kind.toUpperCase())
    public readonly dependency: any
}

/**
 * Gives an initializer to an injected property of its parent
 */
class Initialized extends Base {
    public readonly dependency: any = 'initializer'
}

/**
 * Injects the cache
 */
class InjectedCache extends Component {
    @Inject('missing')
    public readonly cache: any
}

/**
 * Configures the cache its parent injects: nothing is injected (the object injected by the parent is not registered)
 */
class ConfiguredCache extends InjectedCache {
    @Configurable(DTO.String().optional().default('memory'))
    public readonly cache: any
}

/**
 * Injects the cache again
 */
class InjectedAgainCache extends ConfiguredCache {
    @Inject('alpha')
    public readonly cache: any
}

/**
 * Configures the cache
 */
class ConfigurableCache extends Component {
    @Configurable(DTO.String().optional().default('memory'))
    public readonly cache: any
}

/**
 * Injects the cache its parent configures: the injection is not replaced by the default of the parent
 */
class InjectingCache extends ConfigurableCache {
    @Inject('alpha')
    public readonly cache: any
}

/**
 * Configures the cache again
 */
class ConfiguredAgainCache extends InjectingCache {
    @Configurable(DTO.Number().optional().default(3))
    public readonly cache: any
}

/**
 * Create a component of a container holding the dependencies
 * @param target
 */
async function create<T extends Component>(target: new (...args: any[]) => T): Promise<T> {
    const container: Container = new Container()
    await container.load([
        {class: Alpha, [OBJECT_ID]: 'alpha'},
        {class: Beta, [OBJECT_ID]: 'beta'},
        {class: Gamma, [OBJECT_ID]: 'gamma'},
        Gamma
    ])
    return await container.set(target as any) as T
}

const kinds = (component: Base): string[] => [component.dependency, component.other, component.alpha].map((dependency: any): string => typeof dependency === 'string' ? dependency : dependency.kind)

describe('The injections of the subclasses', (): void => {

    it('are inherited', async (): Promise<void> => {
        assert.deepStrictEqual(kinds(await create(Inheriting)), ['Alpha', 'Beta', 'Alpha'])
    })

    it('declared again inject the object of the subclass, the parent unchanged', async (): Promise<void> => {
        assert.deepStrictEqual(kinds(await create(Middle)), ['Beta', 'Beta', 'Alpha'])
        assert.deepStrictEqual(kinds(await create(Base)), ['Alpha', 'Beta', 'Alpha'])
    })

    it('declared again over several levels take the closest declaration, the siblings do not share theirs', async (): Promise<void> => {
        //A subclass declaring nothing takes the declaration of its parent, not the one of its grandparent
        assert.deepStrictEqual(kinds(await create(Leaf)), ['Beta', 'Beta', 'Alpha'])
        assert.deepStrictEqual(kinds(await create(Top)), ['Gamma', 'Beta', 'Alpha'])
        assert.deepStrictEqual(kinds(await create(Sibling)), ['Gamma', 'Beta', 'Alpha'])
        assert.deepStrictEqual(kinds(await create(Middle)), ['Beta', 'Beta', 'Alpha'])
    })

    it('declared again change the class injected, the name injected and the transform', async (): Promise<void> => {
        const byClass: ByClass = await create(ByClass)
        assert.ok(byClass.dependency instanceof Gamma)
        assert.deepStrictEqual(kinds(byClass), ['Gamma', 'Beta', 'Gamma'])
        assert.strictEqual((await create(Transformed)).dependency, 'BETA')
    })

    it('win over the initializer of the property', async (): Promise<void> => {
        assert.deepStrictEqual(kinds(await create(Initialized)), ['Alpha', 'Beta', 'Alpha'])
    })

    it('declared again as configurable properties are configured only, and the configurable properties declared again as injections are injected only', async (): Promise<void> => {
        //The parent injects, the subclass configures: nothing injected
        assert.strictEqual((await create(ConfiguredCache)).cache, 'memory')
        const configured: ConfiguredCache = await new Container().set(ConfiguredCache as any, {cache: 'redis'}) as ConfiguredCache
        assert.strictEqual(configured.cache, 'redis')
        await assert.rejects(create(InjectedCache), /Unable to inject value for property cache/)
        //The parent configures, the subclass injects: the injection is kept
        assert.ok((await create(InjectingCache)).cache instanceof Alpha)
        assert.strictEqual((await create(ConfigurableCache)).cache, 'memory')
        //Declared again over several levels: the closest declaration
        assert.ok((await create(InjectedAgainCache)).cache instanceof Alpha)
        assert.strictEqual((await create(ConfiguredAgainCache)).cache, 3)
        //The startup check knows the configurable properties only
        const warnings: string[] = []
        const onWarning = (warning: Error): number => warnings.push(warning.message)
        const printers: NodeJS.WarningListener[] = process.listeners('warning')
        process.removeAllListeners('warning')
        process.on('warning', onWarning)
        checkObjectOptions([{class: InjectingCache, cache: 'redis'} as any, {class: ConfiguredCache, cache: 'redis'} as any])
        process.off('warning', onWarning)
        printers.forEach((printer: NodeJS.WarningListener): unknown => process.on('warning', printer))
        assert.deepStrictEqual(warnings, ['The option "cache" of InjectingCache is not a configurable property, it is ignored (its configurable properties: maxListeners)'])
        assert.throws((): void => checkObjectOptions([{class: ConfiguredAgainCache, cache: 'redis'} as any]), /"cache" must be a number/)
    })
})
