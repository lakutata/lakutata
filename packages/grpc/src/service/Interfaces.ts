//A copy of the checks of lib/Interfaces.ts of @lakutata/entrypoint (its functions are not exported), as for @lakutata/mcp
import type {ChannelRuntime} from '@lakutata/entrypoint/channel'
import type {InterfaceListeningOptions} from '@lakutata/entrypoint'

/**
 * Checks the options of an adapter for the interfaces: whether interfaces are given
 * @param name The name of the adapter function, for the messages.
 * @param options Its options.
 * @param unsupported Why `interface` cannot be given in the configuration of these options, when it cannot.
 * @returns Whether the adapter listens on interfaces.
 * @throws {TypeError} `host` and `interface` together, `strict`, `family` or `onError` without `interface`, `interface`
 * where it cannot be given.
 */
export function listensOnInterfaces(name: string, options: InterfaceListeningOptions & {host?: string}, unsupported?: string): boolean {
    if (options.interface === undefined) {
        const given: string[] = (['strict', 'family', 'onError'] as const).filter((option: string): boolean => (options as Record<string, unknown>)[option] !== undefined)
        if (given.length) throw new TypeError(`${name}: ${given.join(', ')} ${given.length > 1 ? 'are options' : 'is an option'} of interface, which is not given`)
        return false
    }
    if (unsupported) throw new TypeError(`${name}: interface cannot be given ${unsupported}`)
    if (options.host !== undefined) throw new TypeError(`${name}: host and interface cannot be given together (an address, or an interface whatever its addresses)`)
    return true
}

/**
 * Gives an error of the listening to the handler of the options, or writes it to the log of the application
 */
export async function report(runtime: ChannelRuntime<any>, onError: InterfaceListeningOptions['onError'], error: unknown, message: string): Promise<void> {
    if (onError) {
        try {
            return await onError(error)
        } catch (handlerError: unknown) {
            error = handlerError
            message = `The onError handler of an adapter failed (${message})`
        }
    }
    try {
        const logger: any = await runtime.getObject('log')
        logger.error(error, message)
    } catch {
        console.error(`${message}:`, error)
    }
}
