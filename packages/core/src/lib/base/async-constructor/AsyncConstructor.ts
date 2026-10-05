import {appendAsyncConstructor} from './Append.js'

export class AsyncConstructor extends Object {
    constructor(asyncConstructor: () => PromiseLike<void>) {
        super()
        appendAsyncConstructor(this, asyncConstructor)
    }
}
