export type TParameterDecorator<ClassPrototype> = (target: ClassPrototype, propertyKey: string | symbol, parameterIndex: number) => void