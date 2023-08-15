import 'reflect-metadata'
import {AppendAsyncConstructor} from './Append.js'

export class AsyncConstructor {
    constructor(asyncConstructor: () => PromiseLike<void>) {
        AppendAsyncConstructor(this, asyncConstructor)
    }
}
