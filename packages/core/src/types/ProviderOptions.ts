import {Provider} from '../lib/core/Provider.js'

export interface BaseProviderOptions {
    class: typeof Provider

    [prop: string]: any
}

export type ProviderOptions<T> = T & BaseProviderOptions

export type ProviderOptionsBuilder<T> = (options: T) => ProviderOptions<T>
