import {AppendAsyncConstructor} from './Append'

export class AsyncConstructor {
    constructor(asyncConstructor: () => PromiseLike<void>) {
        AppendAsyncConstructor(this, asyncConstructor)
    }
}
