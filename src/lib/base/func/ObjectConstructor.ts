import {IConstructor} from '../../../interfaces/IConstructor.js'
import {As} from './As.js'

export function ObjectConstructor<ObjectPrototype extends Object>(target: ObjectPrototype): IConstructor<ObjectPrototype> {
    return As<IConstructor<ObjectPrototype>>(target.constructor)
}

