import type {OperationContext} from './Types.js'

/**
 * What a bind does once it succeeds, kept on the context of the bind (one holder for the bind, carried along a SASL
 * exchange), applied in three parts in this order once it succeeds and dropped when it fails: the state of the server
 * (the bind throttle told, the state the password policy keeps), one failing refusing the bind and stopping the rest;
 * the records (the time of the last bind, those of plugins and interceptors), one failing an error event only; the
 * bind event
 */
export const ONCE_BOUND: unique symbol = Symbol('what a bind does once it succeeds')

/**
 * What a bind does once it succeeds, by part
 */
export interface OnceBound {
    /**
     * The changes of the server's state, in their order
     */
    state: ((context: OperationContext) => Promise<void> | void)[]
    /**
     * The records, in their order
     */
    records: ((context: OperationContext) => Promise<void> | void)[]
    /**
     * The bind event
     */
    event?: () => void
}

/**
 * The holder of a bind's context, undefined outside a bind
 * @param context The context of the operation.
 */
function holderOf(context: OperationContext): OnceBound | undefined {
    return context.state.get(ONCE_BOUND) as OnceBound | undefined
}

/**
 * Change the state of the server once the bind succeeds (the bind throttle told, the state the password policy keeps),
 * or at once outside a bind (the old password of a Password Modify): one failing refuses the bind, the rest not done
 * @param context The context of the operation.
 * @param effect The change, given the context of the operation that ends the bind.
 */
export async function onceBound(context: OperationContext, effect: (context: OperationContext) => Promise<void> | void): Promise<void> {
    const holder: OnceBound | undefined = holderOf(context)
    if (holder) holder.state.push(effect)
    else await effect(context)
}

/**
 * Record a bind once it succeeds, after the server's own state and before the bind event. Call it while the bind is
 * being handled, before the hook that calls it returns: a bind refused afterwards (by an interceptor, a plugin around
 * it, the server) then records nothing, and along a SASL exchange the records wait for its end, those of every step in
 * their order. A record that throws is an `error` event of the server, the bind done and the other records made.
 * Outside a bind, the record is made at once. A call made after the hook has returned is not supported.
 * @param context The context of the operation.
 * @param record The record, given the context of the operation that ends the bind.
 * @example
 * import {afterBind, type LDAPInterceptor, type ServerOutcome} from '@lakutata/ldap-engine'
 *
 * //Count the binds that succeed, not those an interceptor or a plugin refuses after the password was checked
 * let bound: number = 0
 * const counting: LDAPInterceptor = {
 *     name: 'counting',
 *     operations: ['bind'],
 *     around: async (context, request, next): Promise<ServerOutcome> => {
 *         const outcome: ServerOutcome = await next()
 *         if (outcome.resultCode === 0) await afterBind(context, (): void => {
 *             bound++
 *         })
 *         return outcome
 *     }
 * }
 */
export async function afterBind(context: OperationContext, record: (context: OperationContext) => Promise<void> | void): Promise<void> {
    const holder: OnceBound | undefined = holderOf(context)
    if (holder) {
        holder.records.push(record)
        return
    }
    try {
        await record(context)
    } catch (error) {
        context.server.events.emit('error', error)
    }
}

/**
 * Tell the bind event once the bind succeeds, after its records, or at once outside a bind
 * @param context The context of the operation.
 * @param tell What tells it.
 */
export function tellBound(context: OperationContext, tell: () => void): void {
    const holder: OnceBound | undefined = holderOf(context)
    if (holder) holder.event = tell
    else tell()
}
