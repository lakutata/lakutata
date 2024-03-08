type InferPrototype<ObjectConstruct extends Function> = ObjectConstruct extends new (...args: any[]) => infer ObjectPrototype ? ObjectPrototype : never

export function ObjectPrototype<ObjectConstruct extends Function>(target: ObjectConstruct): InferPrototype<ObjectConstruct> {
    return target.prototype
}
