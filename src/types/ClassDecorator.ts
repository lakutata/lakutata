import {IConstructor} from '../interfaces/IConstructor.js'

export type ClassDecorator<Constructor extends IConstructor> = (target: Constructor) => Constructor | void
