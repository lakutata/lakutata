import {IConstructor} from '../interfaces/IConstructor.js'

export type TClassDecorator<Constructor extends IConstructor<any>> = (target: Constructor) => Constructor | void
