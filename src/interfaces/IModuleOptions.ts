import {Module} from '../lib/core/Module.js'

export interface IModuleOptions {
    class: typeof Module

    [prop: string]: any
}