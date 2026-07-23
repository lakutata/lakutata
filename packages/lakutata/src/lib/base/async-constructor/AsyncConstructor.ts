import {AppendAsyncConstructor} from './Append.js'

export class AsyncConstructor extends Object {
    constructor(asyncConstructor: () => PromiseLike<void>) {
        super()
        AppendAsyncConstructor(this, asyncConstructor)
    }
}
