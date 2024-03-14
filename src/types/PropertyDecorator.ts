export type PropertyDecorator<ClassPrototype> = (target: ClassPrototype, propertyKey: string | symbol) => void
