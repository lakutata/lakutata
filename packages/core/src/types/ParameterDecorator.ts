/**
 * A parameter decorator typed by the class prototype it decorates: it receives the prototype, the method name and the
 * position of the parameter (from 0).
 */
export type ParameterDecorator<ClassPrototype> = (target: ClassPrototype, propertyKey: string | symbol, parameterIndex: number) => void
