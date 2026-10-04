import {Module} from '../lib/core/Module.js'

/**
 * The declaration of a module in the module options: its class, and its options under any other key.
 */
export interface BaseModuleOptions {
    /**
     * The class of the module, a {@link Module} subclass.
     */
    class: typeof Module

    [prop: string]: any
}

/**
 * The declaration of a module whose options are typed: the options `T` with the class.
 */
export type ModuleOptions<T> = T & BaseModuleOptions

/**
 * A function building the declaration of a module from its typed options, adding its class (the packages export
 * such builders for their modules).
 */
export type ModuleOptionsBuilder<T> = (options: T) => ModuleOptions<T>
