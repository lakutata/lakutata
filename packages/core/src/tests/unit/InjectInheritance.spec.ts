import {describe, it} from 'node:test'
import assert from 'node:assert'
import {BaseObject} from '../../lib/base/BaseObject.js'
import {Component} from '../../lib/core/Component.js'
import {Container} from '../../lib/core/Container.js'
import {Inject} from '../../decorators/di/Inject.js'
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
 * Create a component of a container holding the dependencies
 * @param target
 */
async function Create<T extends Component>(target: new (...args: any[]) => T): Promise<T> {
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
        assert.deepStrictEqual(kinds(await Create(Inheriting)), ['Alpha', 'Beta', 'Alpha'])
    })

    it('declared again inject the object of the subclass, the parent unchanged', async (): Promise<void> => {
        assert.deepStrictEqual(kinds(await Create(Middle)), ['Beta', 'Beta', 'Alpha'])
        assert.deepStrictEqual(kinds(await Create(Base)), ['Alpha', 'Beta', 'Alpha'])
    })

    it('declared again over several levels take the closest declaration, the siblings do not share theirs', async (): Promise<void> => {
        //A subclass declaring nothing takes the declaration of its parent, not the one of its grandparent
        assert.deepStrictEqual(kinds(await Create(Leaf)), ['Beta', 'Beta', 'Alpha'])
        assert.deepStrictEqual(kinds(await Create(Top)), ['Gamma', 'Beta', 'Alpha'])
        assert.deepStrictEqual(kinds(await Create(Sibling)), ['Gamma', 'Beta', 'Alpha'])
        assert.deepStrictEqual(kinds(await Create(Middle)), ['Beta', 'Beta', 'Alpha'])
    })

    it('declared again change the class injected, the name injected and the transform', async (): Promise<void> => {
        const byClass: ByClass = await Create(ByClass)
        assert.ok(byClass.dependency instanceof Gamma)
        assert.deepStrictEqual(kinds(byClass), ['Gamma', 'Beta', 'Gamma'])
        assert.strictEqual((await Create(Transformed)).dependency, 'BETA')
    })

    it('win over the initializer of the property', async (): Promise<void> => {
        assert.deepStrictEqual(kinds(await Create(Initialized)), ['Alpha', 'Beta', 'Alpha'])
    })
})
