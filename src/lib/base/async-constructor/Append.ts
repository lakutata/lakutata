import {IsPromiseLike} from '../../../exports/Utilities'

export function AppendAsyncConstructor<T, U extends any[]>(target: T, asyncConstructor: (...args: U) => PromiseLike<void>, args?: U): void {
    async function applyAsyncConstructor() {
        await Promise.resolve()
        await Reflect.apply(asyncConstructor, target, args !== null && args !== undefined ? args : [])
        delete target['then']
        return target
    }

    if (IsPromiseLike(target)) {
        setThenMethod(target, Promise.resolve(target).then(applyAsyncConstructor))
    } else {
        setThenMethod(target, applyAsyncConstructor())
    }
}

function setThenMethod(target: any, promise: Promise<any>): void {
    target.then = promise.then.bind(promise)
}
