import {BaseObject} from '../../lib/base/BaseObject.js'
import {TClassDecorator} from '../../types/TClassDecorator.js'
import {LifetimeType} from '../../lib/ioc/Lifetime.js'
import {SetObjectLifetime} from '../../lib/base/internal/ObjectLifetime.js'

/**
 * Class Decorator
 * @param lifetime
 * @param lock
 * @constructor
 */
export function Lifetime<ClassConstructor extends typeof BaseObject>(lifetime: LifetimeType, lock: boolean = false): TClassDecorator<ClassConstructor> {
    return (target: ClassConstructor) => SetObjectLifetime(target, lifetime, lock)
}

/**
 * Class Decorator
 * @param lock
 * @constructor
 */
export function Singleton<ClassConstructor extends typeof BaseObject>(lock: boolean = false): TClassDecorator<ClassConstructor> {
    return Lifetime('SINGLETON', lock)
}

/**
 * Class Decorator
 * @param lock
 * @constructor
 */
export function Transient<ClassConstructor extends typeof BaseObject>(lock: boolean = false): TClassDecorator<ClassConstructor> {
    return Lifetime('TRANSIENT', lock)
}

/**
 * Class Decorator
 * @param lock
 * @constructor
 */
export function Scoped<ClassConstructor extends typeof BaseObject>(lock: boolean = false): TClassDecorator<ClassConstructor> {
    return Lifetime('SCOPED', lock)
}
