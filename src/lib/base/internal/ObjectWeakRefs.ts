import {BaseObject} from '../BaseObject.js'
import {As} from '../../helpers/As.js'

const OWR_SYMBOL: symbol = Symbol('OWR')//Object Weak Ref
const OFR_SYMBOL: symbol = Symbol('OFR')//Object Finalization Registry

/**
 * Get object weak refs
 * @param target
 * @constructor
 */
export function GetObjectWeakRefs<ObjectInstance extends BaseObject>(target: any): Set<WeakRef<ObjectInstance>> {
    if (!Reflect.hasOwnMetadata(OFR_SYMBOL, target)) Reflect.defineMetadata(OFR_SYMBOL, new FinalizationRegistry<WeakRef<BaseObject>>((ref: WeakRef<BaseObject>): void => {
        const objectWeakRefs: Set<WeakRef<BaseObject>> = Reflect.getOwnMetadata(OWR_SYMBOL, target) || new Set()
        objectWeakRefs.delete(ref)
        Reflect.defineMetadata(OWR_SYMBOL, objectWeakRefs, target)
    }), target)
    if (!Reflect.hasOwnMetadata(OWR_SYMBOL, target)) Reflect.defineMetadata(OWR_SYMBOL, new Set(), target)
    return Reflect.getOwnMetadata(OWR_SYMBOL, target)
}

/**
 * Append object weak refs
 * @param target
 * @param instance
 * @constructor
 */
export function AppendObjectWeakRefs<ObjectInstance extends BaseObject>(target: any, instance: ObjectInstance): void {
    const refs: Set<WeakRef<ObjectInstance>> = GetObjectWeakRefs<ObjectInstance>(target)
    const ref: WeakRef<ObjectInstance> = new WeakRef(instance)
    As<FinalizationRegistry<WeakRef<ObjectInstance>>>(Reflect.getOwnMetadata(OFR_SYMBOL, target)).register(instance, ref)
    refs.add(ref)
    Reflect.defineMetadata(OWR_SYMBOL, refs, target)
}

/**
 * Clear transient object weak refs
 * @param target
 * @constructor
 */
export function ClearObjectWeakRefs(target: any): void {
    if (!Reflect.hasOwnMetadata(OWR_SYMBOL, target)) return
    Reflect.deleteMetadata(OWR_SYMBOL, target)
}
