import {IBaseObjectConstructor} from '../../interfaces/IBaseObjectConstructor.js'
import {Component} from '../core/Component.js'
import {ConsoleLogger} from '../../components/ConsoleLogger.js'

export type DefaultComponentOptions = {
    class: IBaseObjectConstructor<Component>
    [key: string]: any
}

const defaultComponents: Map<string, DefaultComponentOptions> = new Map<string, DefaultComponentOptions>([
    ['log', {class: ConsoleLogger}]
])

/**
 * Set a component every application registers unless it is configured,
 * used by the packages which provide the implementation of a built-in component
 * @param name
 * @param options
 */
export function SetDefaultComponent(name: string, options: DefaultComponentOptions): void {
    defaultComponents.set(name, options)
}

/**
 * Get the default components
 */
export function GetDefaultComponents(): Record<string, DefaultComponentOptions> {
    return Object.fromEntries([...defaultComponents].map(([name, options]: [string, DefaultComponentOptions]): [string, DefaultComponentOptions] => [name, {...options}]))
}

/**
 * Get the class of a default component
 * @param name
 */
export function GetDefaultComponentClass(name: string): IBaseObjectConstructor<Component> | undefined {
    return defaultComponents.get(name)?.class
}
