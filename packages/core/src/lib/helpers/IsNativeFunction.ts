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
 * Whether a function is native function or not
 * @param target
 * @constructor
 */
export function IsNativeFunction(target: any): boolean {
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