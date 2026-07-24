import {Module} from '../lib/core/Module.js'

export interface BaseModuleOptions {
    class: typeof Module

    [prop: string]: any
}

export type ModuleOptions<T> = T & BaseModuleOptions

export type ModuleOptionsBuilder<T> = (options: T) => ModuleOptions<T>
