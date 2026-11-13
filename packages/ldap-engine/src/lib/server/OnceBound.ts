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
 * Apply an effect of a right password once the bind succeeds, or at once outside a bind (the old password of a
 * Password Modify). An effect applies a change and never decides the outcome: one failing refuses the bind.
 * @param context The context of the operation.
 * @param effect The effect, given the context of the operation that ends the bind.
 */
export async function onceBound(context: OperationContext, effect: (context: OperationContext) => Promise<void> | void): Promise<void> {
    const queued: OnceBoundEffects | undefined = context.state.get(ONCE_BOUND) as OnceBoundEffects | undefined
    if (queued) queued.push(effect)
    else await effect(context)
}
