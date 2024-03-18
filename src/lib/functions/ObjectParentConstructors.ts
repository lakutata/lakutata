import {ObjectParentConstructor} from './ObjectParentConstructor.js'
import {IConstructor} from '../../interfaces/IConstructor.js'

/**
 * Get class's parent constructors
 * @param target
 * @constructor
 */
export function ObjectParentConstructors<ClassConstructor extends Function>(target: ClassConstructor): Function[]
export function ObjectParentConstructors<ClassPrototype extends Object>(target: IConstructor<ClassPrototype>): Function[]
export function ObjectParentConstructors(target: any): Function[] {
    const parentConstructors: Function[] = []
    let parentConstructor: Function | null = ObjectParentConstructor(target)
    while (parentConstructor) {
        parentConstructors.push(parentConstructor)
        parentConstructor = ObjectParentConstructor(parentConstructor)
    }
    return parentConstructors
}
