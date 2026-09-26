/**
 * Whether the value is a class which extends the base class (the base class itself is not its own subclass)
 * @description Same result as DTO.isValid(value, DTO.Class(base)), without building a validation schema
 * @param value
 * @param base
 * @constructor
 */
export function IsSubclassOf(value: unknown, base: Function): boolean {
    return typeof value === 'function' && !!value.prototype && value.prototype instanceof base
}
