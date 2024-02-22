import {BaseObject} from '../../lib/base/BaseObject.js'
import {TClassDecorator} from '../../types/TClassDecorator.js'

export function Lifetime<ClassConstructor extends typeof BaseObject>(): TClassDecorator<ClassConstructor> {
    return (target: ClassConstructor) => {

    }
}
