import {Component} from '../lib/core/Component.js'

export interface BaseComponentOptions {
    class: typeof Component

    [prop: string]: any
}

export type ComponentOptions<T> = T & BaseComponentOptions

export type ComponentOptionsBuilder<T> = (options: T) => ComponentOptions<T>
