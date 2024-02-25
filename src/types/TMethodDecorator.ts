export type TMethodDecorator<ClassPrototype> = (target: ClassPrototype, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<any>) => TypedPropertyDescriptor<any> | void
