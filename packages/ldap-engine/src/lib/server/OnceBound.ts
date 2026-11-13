import type {OperationContext} from './Types.js'

/**
 * What a bind does once it succeeds, kept on the context of the bind: the effects of a right password (the bind
 * throttle told, the state the password policy keeps, its warning), applied when the bind succeeds and dropped when it
 * fails, so that a bind refused after its password was checked leaves none; kept along a SASL exchange
 */
export const ONCE_BOUND: unique symbol = Symbol('what a bind does once it succeeds')

/**
 * The effects a bind applies once it succeeds, in their order
 */
export type OnceBoundEffects = ((context: OperationContext) => Promise<void> | void)[]

/**
 * Apply an effect of a bind once the bind succeeds (the time of the last bind, the state a policy keeps), or at once
 * outside a bind (the old password of a Password Modify): a bind refused after it, by an interceptor or a plugin
 * around it, applies none; along a SASL exchange the effects wait for its end. An effect applies a change and never
 * decides the outcome: one failing refuses the bind, the effects after it not applied.
 * @param context The context of the operation.
 * @param effect The effect, given the context of the operation that ends the bind.
 * @example
 * import {onceBound, type LDAPInterceptor, type ServerOutcome} from '@lakutata/ldap-engine'
 *
 * //Count the binds that succeed, not those an interceptor or a plugin refuses after the password was checked
 * let bound: number = 0
 * const counting: LDAPInterceptor = {
 *     name: 'counting',
 *     operations: ['bind'],
 *     around: async (context, request, next): Promise<ServerOutcome> => {
 *         const outcome: ServerOutcome = await next()
 *         if (outcome.resultCode === 0) await onceBound(context, (): void => {
 *             bound++
 *         })
 *         return outcome
 *     }
 * }
 */
export async function onceBound(context: OperationContext, effect: (context: OperationContext) => Promise<void> | void): Promise<void> {
    const queued: OnceBoundEffects | undefined = context.state.get(ONCE_BOUND) as OnceBoundEffects | undefined
    if (queued) queued.push(effect)
    else await effect(context)
}
