export type MethodDecorator<ClassPrototype, Method> = (target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<Method>) => TypedPropertyDescriptor<Method> | void
