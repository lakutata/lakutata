/**
 * A property decorator typed by the class prototype it decorates: it receives the prototype and the property name.
 */
export type PropertyDecorator<ClassPrototype> = (target: ClassPrototype, propertyKey: string | symbol) => void
