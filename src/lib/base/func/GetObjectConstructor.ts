import {IConstructor} from '../../../interfaces/IConstructor.js'
import {As} from './As.js'

export function GetObjectConstructor<ObjectPrototype extends Object>(target: ObjectPrototype): IConstructor<ObjectPrototype> {
    return As<IConstructor<ObjectPrototype>>(target.constructor)
}

