import {Component} from '../lib/core/Component.js'

/**
 * The declaration of a component in the module options: its class, and its options under any other key.
 */
export interface BaseComponentOptions {
    /**
     * The class of the component, a {@link Component} subclass.
     */
    class: typeof Component

    [prop: string]: any
}

/**
 * The declaration of a component whose options are typed: the options `T` with the class.
 */
export type ComponentOptions<T> = T & BaseComponentOptions

/**
 * A function building the declaration of a component from its typed options, adding its class (the packages export
 * such builders for their components).
 */
export type ComponentOptionsBuilder<T> = (options: T) => ComponentOptions<T>
