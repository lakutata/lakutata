import {DN} from '../dn/DN.js'
import type {PartialAttribute} from '../protocol/Messages.js'
import type {AttributeValue, AttributeValues, Change} from './Connection.js'

/**
 * The bytes of a value: text as UTF-8, a number as its decimal text, a boolean as `TRUE` or `FALSE`
 * @param value The value.
 */
export function valueBytes(value: AttributeValue): Buffer {
    if (Buffer.isBuffer(value)) return value
    if (typeof value === 'boolean') return Buffer.from(value ? 'TRUE' : 'FALSE')
    return Buffer.from(String(value), 'utf8')
}

/**
 * The values of an attribute as bytes
 * @param values One value, several, or none.
 */
export function valuesBytes(values: AttributeValue | AttributeValue[] | undefined): Buffer[] {
    if (values === undefined) return []
    return (Array.isArray(values) ? values : [values]).map(valueBytes)
}

/**
 * The attributes of an entry to add, as the messages carry them
 * @param attributes The attributes, by description, or already as the messages carry them.
 */
export function attributesOf(attributes: AttributeValues | PartialAttribute[]): PartialAttribute[] {
    if (Array.isArray(attributes)) return attributes
    return Object.entries(attributes).map(([type, values]: [string, AttributeValue | AttributeValue[]]): PartialAttribute => ({type: type, values: valuesBytes(values)}))
}

/**
 * The text of a DN given as a DN or as text
 * @param dn The DN.
 */
export function dnText(dn: string | DN): string {
    return dn instanceof DN ? dn.toString() : dn
}

/**
 * The changes of a modify operation, as the messages carry them
 * @param changes One change or several.
 */
export function changesOf(changes: Change | Change[]): {operation: Change['operation'], modification: PartialAttribute}[] {
    return (Array.isArray(changes) ? changes : [changes]).map((change: Change) => ({operation: change.operation, modification: {type: change.attribute, values: valuesBytes(change.values)}}))
}

/**
 * A signal aborted when any of the signals is, with its reason (`AbortSignal.any` exists from Node.js 20.3 only)
 * @param signals The signals; the undefined ones are left out.
 * @returns The signal, and the function removing its listeners.
 */
export function anySignal(signals: (AbortSignal | undefined)[]): {signal: AbortSignal | undefined, dispose: () => void} {
    const present: AbortSignal[] = signals.filter((signal: AbortSignal | undefined): signal is AbortSignal => signal !== undefined)
    if (present.length <= 1) return {signal: present[0], dispose: (): void => undefined}
    const controller: AbortController = new AbortController()
    const listeners: (() => void)[] = []
    for (const signal of present) {
        if (signal.aborted) {
            controller.abort(signal.reason)
            break
        }
        const listener: () => void = (): void => controller.abort(signal.reason)
        signal.addEventListener('abort', listener, {once: true})
        listeners.push((): void => signal.removeEventListener('abort', listener))
    }
    return {signal: controller.signal, dispose: (): void => listeners.forEach((remove: () => void): void => remove())}
}
