import {BaseObject} from '../../lib/base/BaseObject.js'
import {ClassDecorator} from '../../types/ClassDecorator.js'
import {LifetimeType} from '../../lib/ioc/Lifetime.js'
import {SetObjectLifetime} from '../../lib/ioc/ObjectLifetime.js'
import {GetObjectType, ObjectType} from '../../lib/base/internal/ObjectType.js'
import {LifetimeLockedException} from '../../exceptions/di/LifetimeLockedException.js'

/**
 * Set how the container shares the instances of a class: `SINGLETON` (one instance, created once by the container
 * registering the class and shared by all its users), `SCOPED` (one instance per scope, a request of an entrypoint), or
 * `TRANSIENT` (a new instance on each request, never cached). Subclasses inherit the lifetime. `BaseObject` is
 * transient, `Provider` scoped, `Component` and `Module` are locked singletons. Prefer the shorthands `@Singleton()`,
 * `@Scoped()` and `@Transient()`.
 * @param lifetime The lifetime: `'SINGLETON'`, `'SCOPED'` or `'TRANSIENT'`.
 * @param lock Whether the subclasses are forbidden to change the lifetime (they may still declare the same one).
 * Default `false`.
 * @returns The class decorator.
 * @throws {LifetimeLockedException} When the class is defined, if a parent class locked another lifetime, or if a
 * provider is given a singleton lifetime (a provider is scoped or transient; use a component for a singleton).
 * @example
 * ```typescript
 * import {BaseObject} from 'lakutata'
 * import {Lifetime} from 'lakutata/decorator/di'
 *
 * //A new counter for each object requesting it
 * @Lifetime('TRANSIENT')
 * export class Counter extends BaseObject {
 *     public value: number = 0
 * }
 * ```
 */
export function Lifetime<ClassConstructor extends typeof BaseObject>(lifetime: LifetimeType, lock: boolean = false): ClassDecorator<ClassConstructor> {
    return (target: ClassConstructor): ClassConstructor => {
        //A provider is a functional unit living in a scope, a long-lived shared object must be a component
        if (lifetime !== 'SCOPED' && lifetime !== 'TRANSIENT' && GetObjectType(target) === ObjectType.Provider)
            throw new LifetimeLockedException('[{0}] A provider can only be scoped or transient, use a component for a singleton', [target.className])
        return SetObjectLifetime(target, lifetime, lock)
    }
}

/**
 * Make the class a singleton: the container registering it creates one instance, on first request, and shares it with
 * all its users (the scopes included) until the container is destroyed. Shorthand of `@Lifetime('SINGLETON', lock)`.
 * @param lock Whether the subclasses are forbidden to change the lifetime (they may still declare the same one).
 * Default `false`.
 * @returns The class decorator.
 * @throws {LifetimeLockedException} When the class is defined, if a parent class locked another lifetime, or if the
 * class is a provider (a provider is scoped or transient; use a component for a singleton).
 * @example
 * ```typescript
 * import {BaseObject} from 'lakutata'
 * import {Singleton} from 'lakutata/decorator/di'
 *
 * //One cache shared by the whole application
 * @Singleton()
 * export class Cache extends BaseObject {
 *     public readonly entries: Map<string, unknown> = new Map()
 * }
 * ```
 */
export function Singleton<ClassConstructor extends typeof BaseObject>(lock: boolean = false): ClassDecorator<ClassConstructor> {
    return Lifetime('SINGLETON', lock)
}

/**
 * Make the class transient: the container creates a new instance on each request (each `getObject()` and each
 * injection), never cached. Shorthand of `@Lifetime('TRANSIENT', lock)`; the default of `BaseObject`.
 * @param lock Whether the subclasses are forbidden to change the lifetime (they may still declare the same one).
 * Default `false`.
 * @returns The class decorator.
 * @throws {LifetimeLockedException} When the class is defined, if a parent class locked another lifetime.
 * @example
 * ```typescript
 * import {Provider} from 'lakutata'
 * import {Transient} from 'lakutata/decorator/di'
 *
 * //Each user of the builder gets its own, with its own state
 * @Transient()
 * export class QueryBuilder extends Provider {
 *     protected readonly clauses: string[] = []
 *
 *     public where(clause: string): this {
 *         this.clauses.push(clause)
 *         return this
 *     }
 * }
 * ```
 */
export function Transient<ClassConstructor extends typeof BaseObject>(lock: boolean = false): ClassDecorator<ClassConstructor> {
    return Lifetime('TRANSIENT', lock)
}

/**
 * Make the class scoped: the container creates one instance per scope (an entrypoint creates a scope for each
 * request), shared by the objects of that scope and destroyed with it; outside a scope, the container registering the
 * class shares one instance. Shorthand of `@Lifetime('SCOPED', lock)`; the default of `Provider`.
 * @param lock Whether the subclasses are forbidden to change the lifetime (they may still declare the same one).
 * Default `false`.
 * @returns The class decorator.
 * @throws {LifetimeLockedException} When the class is defined, if a parent class locked another lifetime.
 * @example
 * ```typescript
 * import {Provider} from 'lakutata'
 * import {Scoped} from 'lakutata/decorator/di'
 *
 * //The objects handling the same request share its transaction
 * @Scoped()
 * export class RequestTransaction extends Provider {
 *     public readonly startedAt: number = Date.now()
 * }
 * ```
 */
export function Scoped<ClassConstructor extends typeof BaseObject>(lock: boolean = false): ClassDecorator<ClassConstructor> {
    return Lifetime('SCOPED', lock)
}
