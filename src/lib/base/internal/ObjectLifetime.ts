import {BaseObject} from '../BaseObject.js'
import {defineMetadata, getMetadata} from 'reflect-metadata/no-conflict'
import {
    DI_TARGET_CONSTRUCTOR_LIFETIME,
    DI_TARGET_CONSTRUCTOR_LIFETIME_LOCK
} from '../../../constants/metadata-keys/DIMetadataKey.js'
import {LifetimeLockedException} from '../../../exceptions/di/LifetimeLockedException.js'
import {LifetimeType} from '../../ioc/Lifetime.js'

/**
 * Get Object's lifetime
 * @param target
 * @constructor
 */
export function GetObjectLifetime<ClassConstructor extends typeof BaseObject>(target: ClassConstructor): LifetimeType {
    return getMetadata(DI_TARGET_CONSTRUCTOR_LIFETIME, target)
}

/**
 * Get whether Object's lifetime is locked
 * @param target
 * @constructor
 */
export function GetObjectLifetimeLocked<ClassConstructor extends typeof BaseObject>(target: ClassConstructor): boolean {
    return !!getMetadata(DI_TARGET_CONSTRUCTOR_LIFETIME_LOCK, target)
}

/**
 * Set Object's lifetime
 * @param target
 * @param lifetime
 * @param lock
 * @constructor
 */
export function SetObjectLifetime<ClassConstructor extends typeof BaseObject>(target: ClassConstructor, lifetime: LifetimeType, lock: boolean = false): ClassConstructor {
    if (getMetadata(DI_TARGET_CONSTRUCTOR_LIFETIME_LOCK, target)) throw new LifetimeLockedException('Object lifecycle settings cannot be applied because the parent object lifecycle of the current operation object is locked')
    if (lock) defineMetadata(DI_TARGET_CONSTRUCTOR_LIFETIME_LOCK, true, target)
    defineMetadata(DI_TARGET_CONSTRUCTOR_LIFETIME, lifetime, target)
    return target
}