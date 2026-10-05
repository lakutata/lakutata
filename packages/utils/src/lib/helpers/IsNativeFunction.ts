// Used to resolve the internal `[[Class]]` of values
const toString = Object.prototype.toString

// Used to resolve the decompiled source of functions
const fnToString = Function.prototype.toString

// Used to detect host constructors (Safari > 4; really typed array specific)
const reHostCtor = /^\[object .+?Constructor\]$/

// Compile a regexp using a common native method as a template.
// We chose `Object#toString` because there's a good chance it is not being mucked with.
const reNative = RegExp('^' +
    // Coerce `Object#toString` to a string
    String(toString)
        // Escape any special regexp characters
        .replace(/[.*+?^${}()|[\]\/\\]/g, '\\$&')
        // Replace mentions of `toString` with `.*?` to keep the template generic.
        // Replace thing like `for ...` to support environments like Rhino which add extra info
        // such as method arity.
        .replace(/toString|(function).*?(?=\\\()| for .+?(?=\\\])/g, '$1.*?') + '$'
)

/**
 * Tell whether a value is a native function, implemented by the JavaScript engine or Node.js rather than in
 * JavaScript: its source, as `Function.prototype.toString` gives it, is `function name() { [native code] }`. The
 * built-ins (`Math.max`, `Array`) are native, and so are all the bound functions (`fn.bind(null)`), whatever they bind:
 * the runtime gives them the same source, so a bound function cannot be told apart reliably from a built-in. The
 * functions, the arrow functions and the classes written in JavaScript are not. A function's own `toString` cannot
 * fake the result. An object whose `Object.prototype.toString` tag ends with `Constructor` (`[object
 * HTMLElementConstructor]`, a host object of some environments) is also native.
 * @param target The value to test, of any type; a value which is neither a function nor an object gives `false`.
 * @returns `true` when the value is a native function, `false` otherwise.
 * @example
 * ```typescript
 * import {isNativeFunction} from 'lakutata/utils'
 *
 * console.log(isNativeFunction(Math.max), isNativeFunction((): number => 1), isNativeFunction(class Point {}))
 * //true false false
 * ```
 */
export function isNativeFunction(target: any): boolean {
    const type = typeof target
    return type == 'function'
        // Use `Function#toString` to bypass the value's own `toString` method
        // and avoid being faked out.
        ? reNative.test(fnToString.call(target))
        // Fallback to a host object check because some environments will represent
        // things like typed arrays as DOM methods which may not conform to the
        // normal native pattern.
        : (target && type == 'object' && reHostCtor.test(toString.call(target))) || false
}