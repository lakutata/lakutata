import {IConstructor} from '../../interfaces/IConstructor.js'
import {
    DI_TARGET_CONSTRUCTOR_LIFETIME,
    DI_TARGET_CONSTRUCTOR_LIFETIME_LOCK
} from '../../constants/DIMetadataKey.js'
import {LifetimeLockedException} from '../../exceptions/di/LifetimeLockedException.js'
import {LifetimeType} from './Lifetime.js'

/**
 * Get Object's lifetime
 * @param target
 * @constructor
 */
export function GetObjectLifetime<ClassConstructor extends IConstructor>(target: ClassConstructor): LifetimeType {
    return Reflect.getMetadata(DI_TARGET_CONSTRUCTOR_LIFETIME, target)
}

/**
 * Get whether Object's lifetime is locked
 * @param target
 * @constructor
 */
export function GetObjectLifetimeLocked<ClassConstructor extends IConstructor>(target: ClassConstructor): boolean {
    return !!Reflect.getMetadata(DI_TARGET_CONSTRUCTOR_LIFETIME_LOCK, target)
}

/**
 * Set Object's lifetime
 * @param target
 * @param lifetime
 * @param lock
 * @constructor
 */
export function SetObjectLifetime<ClassConstructor extends IConstructor>(target: ClassConstructor, lifetime: LifetimeType, lock: boolean = false): ClassConstructor {
    //A locked lifetime can be declared again, but never changed
    if (GetObjectLifetimeLocked(target) && GetObjectLifetime(target) !== lifetime) throw new LifetimeLockedException('[{0}] Object lifecycle settings cannot be applied because the parent object lifecycle of the current operation object is locked', [target.className])
    if (lock) Reflect.defineMetadata(DI_TARGET_CONSTRUCTOR_LIFETIME_LOCK, true, target)
    Reflect.defineMetadata(DI_TARGET_CONSTRUCTOR_LIFETIME, lifetime, target)
    return target
}
