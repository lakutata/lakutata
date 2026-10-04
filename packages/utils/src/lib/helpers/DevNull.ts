/**
 * Accept any arguments and do nothing with them: a sink for the values deliberately ignored (a caught error, an unused
 * callback argument), which keeps the linters quiet.
 * @param _args The values to ignore, any number of them of any type.
 * @example
 * ```typescript
 * import {DevNull} from 'lakutata/utils'
 *
 * try {
 *     JSON.parse('not json')
 * } catch (error) {
 *     //The malformed input is ignored on purpose
 *     DevNull(error)
 * }
 * ```
 */
export function DevNull(..._args: any[]): void {
    //Do nothing
    return void (0)
}