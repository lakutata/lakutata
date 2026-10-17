import {Signature} from 'dbus-sdk'

/**
 * The names of the interfaces and of the errors: dot-separated elements
 */
const INTERFACE_NAME: RegExp = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/

/**
 * The names of the members: the methods, the properties and the signals
 */
const MEMBER_NAME: RegExp = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * The object paths, their elements may be variables of a template ("/com/example/Devices/{sn}")
 */
const PATH_TEMPLATE: RegExp = /^\/$|^(\/([A-Za-z0-9_]+|\{[A-Za-z_][A-Za-z0-9_]*}))+$/

/**
 * Check the name of an interface
 * @param name
 */
export function checkInterfaceName(name: string): string {
    if (typeof name !== 'string' || name.length > 255 || !INTERFACE_NAME.test(name)) throw new TypeError(`Invalid DBus interface name "${name}": dot-separated elements of letters, digits and "_", such as "com.example.Device"`)
    return name
}

/**
 * Check the well-known name of a service. D-Bus allows "-" in the bus names, but the names of the errors are prefixed by
 * the name of the service, and an error name may not hold it
 * @param name
 */
export function checkServiceName(name: string): string {
    if (typeof name !== 'string' || name.length > 255 || !INTERFACE_NAME.test(name)) throw new TypeError(`Invalid DBus service name "${name}": dot-separated elements of letters, digits and "_", such as "com.example.DeviceService" (it prefixes the names of the errors, which may not hold "-")`)
    return name
}

/**
 * Check a D-Bus signature holding a single complete type (the type of a property, of a signal's data, of a result)
 * @param signature
 * @param what what the type is of, for the message
 */
export function checkSingleType(signature: string, what: string): string {
    let types: number
    try {
        types = Signature.parse(signature).length
    } catch (error: unknown) {
        throw new TypeError(`Invalid DBus signature "${signature}" of ${what}: ${(error as Error).message}`, {cause: error})
    }
    if (types !== 1) throw new TypeError(`Invalid DBus signature "${signature}" of ${what}: a single complete type, such as "s" or "a{sv}"`)
    return signature
}

/**
 * Check the name of a member
 * @param name
 * @param kind
 */
export function checkMemberName(name: string, kind: string): string {
    if (typeof name !== 'string' || name.length > 255 || !MEMBER_NAME.test(name)) throw new TypeError(`Invalid DBus ${kind} name "${name}": letters, digits and "_", not starting with a digit`)
    return name
}

/**
 * Check an object path, or a template of object paths
 * @param path
 */
export function checkPathTemplate(path: string): string {
    if (typeof path !== 'string' || !PATH_TEMPLATE.test(path)) throw new TypeError(`Invalid DBus object path "${path}": "/" separated elements of letters, digits and "_", or variables such as "{sn}"`)
    return path
}

/**
 * A template of object paths
 */
export type PathTemplate = {
    readonly template: string
    readonly variables: string[]
    readonly static: boolean
    match(path: string): Record<string, string> | undefined
}

/**
 * Compile a template of object paths
 * @param template
 */
export function compilePathTemplate(template: string): PathTemplate {
    const variables: string[] = []
    const expression: RegExp = new RegExp(`^${checkPathTemplate(template).replace(/\{([A-Za-z_][A-Za-z0-9_]*)}/g, (matched: string, name: string): string => {
        variables.push(name)
        return '([A-Za-z0-9_]+)'
    })}$`)
    return {
        template: template,
        variables: variables,
        static: !variables.length,
        match: (path: string): Record<string, string> | undefined => {
            const matched: RegExpExecArray | null = expression.exec(path)
            return matched ? Object.fromEntries(variables.map((name: string, index: number): [string, string] => [name, matched[index + 1]])) : undefined
        }
    }
}

/**
 * The name of the DBus error of an exception: its errno, or its name
 * @param error
 */
export function errorName(error: unknown): string {
    const {errno, name} = (error && typeof error === 'object' ? error : {}) as { errno?: unknown, name?: unknown }
    const candidate: string = String(errno ?? name ?? 'Error')
    //A dotted name is a full DBus error name, the others are prefixed by the service name
    if (INTERFACE_NAME.test(candidate)) return candidate
    const element: string = candidate.replace(/[^A-Za-z0-9_]/g, '_')
    //An element of an error name starts with a letter
    return /^[A-Za-z]/.test(element) ? element : `E${element}`
}
