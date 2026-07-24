type InferPrototype<ObjectConstruct extends Function> = ObjectConstruct extends new (...args: any[]) => infer ObjectPrototype ? ObjectPrototype : never

/**
 * Get object's prototype by its constructor
 * @param target
 * @constructor
 */
export function ObjectPrototype<ObjectConstruct extends Function>(target: ObjectConstruct): InferPrototype<ObjectConstruct> {
    return target.prototype
}
