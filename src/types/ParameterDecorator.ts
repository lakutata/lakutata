export type ParameterDecorator<ClassPrototype> = (target: ClassPrototype, propertyKey: string | symbol, parameterIndex: number) => void
