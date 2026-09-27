import {DTO} from '@lakutata/core'
import type {ActionPattern} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {InvalidPrefixException} from '../exceptions/InvalidPrefixException.js'

/**
 * The prefixes of the actions of a controller
 */
export class PrefixOptions extends DTO {
    /**
     * The path prepended to the routes of the HTTP actions
     */
    @Expect(DTO.String().optional())
    public route?: string

    /**
     * The command prepended to the commands of the CLI actions, joined by ":"
     */
    @Expect(DTO.String().optional())
    public command?: string

    /**
     * The pattern merged into the patterns of the service actions
     */
    @Expect(DTO.Object().optional())
    public pattern?: ActionPattern
}

const CONTROLLER_PREFIX: symbol = Symbol('ENTRYPOINT.CONTROLLER.PREFIX')

/**
 * Set the prefixes of a controller class
 * @param controller
 * @param options
 */
export function SetPrefix(controller: Function, options: PrefixOptions): void {
    Reflect.defineMetadata(CONTROLLER_PREFIX, PrefixOptions.validate(options), controller)
}

/**
 * The prefixes of a controller: the ones of the class or of its nearest parent class declaring them
 * @param controller
 */
export function GetPrefix(controller: Function): PrefixOptions | undefined {
    for (let current: any = controller; current && current !== Function.prototype; current = Object.getPrototypeOf(current)) {
        const prefix: PrefixOptions | undefined = Reflect.getOwnMetadata(CONTROLLER_PREFIX, current)
        if (prefix) return prefix
    }
    return undefined
}

/**
 * Join a route prefix and a route
 * @param prefix
 * @param route
 */
export function PrefixRoute(prefix: string, route: string): string {
    const segments: string[] = [prefix, route].map((part: string): string => part.replace(/^\/+|\/+$/g, '')).filter(Boolean)
    return `/${segments.join('/')}`
}

/**
 * Join a command prefix and a command
 * @param prefix
 * @param command
 */
export function PrefixCommand(prefix: string, command: string): string {
    return command ? `${prefix}:${command}` : prefix
}

/**
 * Merge a pattern prefix into a pattern, a key cannot have different values
 * @param prefix
 * @param pattern
 * @param path
 */
export function PrefixPattern(prefix: ActionPattern, pattern: ActionPattern, path: string = ''): ActionPattern {
    const merged: ActionPattern = {...pattern}
    for (const [key, value] of Object.entries(prefix)) {
        if (!(key in merged)) {
            merged[key] = value
        } else if (value !== null && typeof value === 'object' && merged[key] !== null && typeof merged[key] === 'object') {
            merged[key] = PrefixPattern(value, merged[key], `${path}${key}.`)
        } else if (merged[key] !== value) {
            throw new InvalidPrefixException('The pattern prefix sets "{key}" to {prefix}, the pattern sets it to {pattern}', {
                key: `${path}${key}`,
                prefix: JSON.stringify(value),
                pattern: JSON.stringify(merged[key])
            })
        }
    }
    return merged
}
