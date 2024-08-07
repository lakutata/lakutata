import {IConstructor} from '../../interfaces/IConstructor.js'

/**
 * Get class's parent constructor
 * @param target
 * @constructor
 */
export function ObjectParentConstructor<ClassConstructor extends Function>(target: ClassConstructor): Function | null
export function ObjectParentConstructor<ClassPrototype extends Object>(target: IConstructor<ClassPrototype>): Function | null
export function ObjectParentConstructor(target: any): Function | null {
    const rootProto: unknown = Symbol.constructor.prototype.constructor.__proto__
    const constructor: Function = (!!target[Symbol.hasInstance] && target.prototype) ? target : target.constructor
    const proto: IConstructor<any> = constructor.prototype.constructor.__proto__
    return proto === rootProto ? null : proto
}
