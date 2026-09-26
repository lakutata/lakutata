import {BaseObject} from '../../lib/base/BaseObject.js'
import {ClassDecorator} from '../../types/ClassDecorator.js'
import {LifetimeType} from '../../lib/ioc/Lifetime.js'
import {SetObjectLifetime} from '../../lib/ioc/ObjectLifetime.js'
import {GetObjectType, ObjectType} from '../../lib/base/internal/ObjectType.js'
import {LifetimeLockedException} from '../../exceptions/di/LifetimeLockedException.js'

/**
 * Class Decorator
 * @param lifetime
 * @param lock
 * @constructor
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
 * Class Decorator
 * @param lock
 * @constructor
 */
export function Singleton<ClassConstructor extends typeof BaseObject>(lock: boolean = false): ClassDecorator<ClassConstructor> {
    return Lifetime('SINGLETON', lock)
}

/**
 * Class Decorator
 * @param lock
 * @constructor
 */
export function Transient<ClassConstructor extends typeof BaseObject>(lock: boolean = false): ClassDecorator<ClassConstructor> {
    return Lifetime('TRANSIENT', lock)
}

/**
 * Class Decorator
 * @param lock
 * @constructor
 */
export function Scoped<ClassConstructor extends typeof BaseObject>(lock: boolean = false): ClassDecorator<ClassConstructor> {
    return Lifetime('SCOPED', lock)
}
