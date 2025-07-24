import {Provider} from '../lib/core/Provider.js'

export interface IProviderOptions {
    class: typeof Provider

    [prop: string]: any
}