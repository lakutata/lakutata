import {As} from './As.js'
import {IConstructor} from '../../interfaces/IConstructor.js'

/**
 * Get object's constructor by its prototype
 * @param target
 * @constructor
 */
export function ObjectConstructor<ObjectPrototype extends Object>(target: ObjectPrototype): IConstructor<ObjectPrototype> {
    return As<IConstructor<ObjectPrototype>>(target.constructor)
}

