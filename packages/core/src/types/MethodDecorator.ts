/**
 * A method decorator typed by the class prototype and the method it decorates: it receives the prototype, the method
 * name and its property descriptor, and returns the descriptor to use, or nothing to keep it.
 */
export type MethodDecorator<ClassPrototype, Method, Property = string | symbol> = (target: ClassPrototype, propertyKey: Property, descriptor: TypedPropertyDescriptor<Method>) => TypedPropertyDescriptor<Method> | void
