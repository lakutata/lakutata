import {BaseContext, type ContextParams, ContextType} from './BaseContext.js'
import {Expect} from '@lakutata/core/decorator/dto'
import {DTO} from '@lakutata/core'
import {type CLIContextParams} from '../types/CLIContextParams.js'

/**
 * The context of a command run by a CLI adapter (`CommanderCLIEntrypoint`): `this.context` of a controller action
 * declared with `@CLIAction`, when it runs as a command. Its `data` holds the positional arguments and the options of
 * the command, before their validation.
 * @example
 * ```typescript
 * import {Controller, CLIContext} from 'lakutata/com/entrypoint'
 * import {CLIAction} from 'lakutata/decorator/ctrl'
 *
 * class CacheController extends Controller {
 *     //"app cache clear" prints "cache clear: done"
 *     @CLIAction('cache clear')
 *     public async clear(): Promise<string> {
 *         const command: string = this.context instanceof CLIContext ? this.context.command : 'unknown'
 *         return `${command}: done`
 *     }
 * }
 * ```
 */
export class CLIContext<T extends Record<string, any> = {}> extends BaseContext<T> {
    /**
     * Always `ContextType.CLI`.
     */
    @Expect(DTO.String().valid(ContextType.CLI).default(ContextType.CLI))
    public readonly type: ContextType

    /**
     * The command of the action as declared, its controller prefix included (`'user:get <id>'`), not the arguments
     * typed by the user.
     */
    @Expect(DTO.String().required())
    public command: string

    /**
     * Create the context of a command, validating its properties.
     * @param params The command and its data.
     * @throws {InvalidValueException} When a property is invalid or a required one is missing.
     */
    constructor(params: ContextParams<CLIContextParams>) {
        super(params)
    }
}
