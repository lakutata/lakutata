import {IConstructor} from '../interfaces/IConstructor.js'

/**
 * A class decorator typed by the class it decorates: it receives the constructor, and returns it, a replacement, or
 * nothing.
 */
export type ClassDecorator<Constructor extends IConstructor> = (target: Constructor) => Constructor | void
