/**
 * The key of the internal method of a NetworkInterface its listeners follow it by: the observer given is called with
 * 'update' after each reading of the interfaces, with 'close' when the NetworkInterface is closed; the function returned
 * removes it
 */
export const OBSERVE: unique symbol = Symbol('lakutata.netif.observe')

/**
 * An observer of a NetworkInterface
 */
export type Observer = (event: 'update' | 'close') => void
