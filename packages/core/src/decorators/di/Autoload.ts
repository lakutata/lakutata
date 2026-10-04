import {BaseObject} from '../../lib/base/BaseObject.js'
import {ClassDecorator} from '../../types/ClassDecorator.js'
import {MarkObjectAsAutoload} from '../../lib/base/internal/ObjectInjection.js'

/**
 * Let the container register the class on first use: when the class is requested (by `getObject(TheClass)` or
 * `@Inject(TheClass)`) and is not registered, it is registered, then resolved, instead of failing. A singleton is
 * registered in the root container (shared by the whole application), a scoped class in the nearest scope (shared
 * within the request), a transient class in the requesting container. The registration has no options: the
 * `@Configurable` properties take the options given to `getObject()`, else their initializers or their schema
 * defaults. The mark is not inherited by subclasses.
 * @returns The class decorator.
 * @example
 * ```typescript
 * import {Component, Provider} from 'lakutata'
 * import {Autoload, Inject, Scoped} from 'lakutata/decorator/di'
 *
 * //Not declared in the application: registered the first time it is injected
 * @Autoload()
 * @Scoped()
 * class RequestClock extends Provider {
 *     public readonly startedAt: number = Date.now()
 * }
 *
 * class Reports extends Component {
 *     @Inject(RequestClock)
 *     protected readonly clock!: RequestClock
 *
 *     public elapsed(): number {
 *         return Date.now() - this.clock.startedAt
 *     }
 * }
 * ```
 */
export function Autoload<ClassConstructor extends typeof BaseObject>(): ClassDecorator<ClassConstructor> {
    return (target: ClassConstructor): ClassConstructor => MarkObjectAsAutoload(target)
}
