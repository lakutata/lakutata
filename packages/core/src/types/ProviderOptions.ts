import {Provider} from '../lib/core/Provider.js'

/**
 * The declaration of a provider in the module options: its class, and its options under any other key.
 */
export interface BaseProviderOptions {
    /**
     * The class of the provider, a {@link Provider} subclass.
     */
    class: typeof Provider

    [prop: string]: any
}

/**
 * The declaration of a provider whose options are typed: the options `T` with the class.
 */
export type ProviderOptions<T> = T & BaseProviderOptions

/**
 * A function building the declaration of a provider from its typed options, adding its class (the packages export
 * such builders for their providers).
 */
export type ProviderOptionsBuilder<T> = (options: T) => ProviderOptions<T>
