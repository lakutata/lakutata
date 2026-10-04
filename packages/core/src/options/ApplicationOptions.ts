import {constants} from 'node:os'
import {ModuleOptions} from './ModuleOptions.js'
import {Expect} from '../decorators/dto/Expect.js'
import {DTO} from '../lib/dto/DTO.js'

/**
 * The signals a process can listen to (SIGKILL and SIGSTOP cannot be caught)
 */
const CATCHABLE_SIGNALS: string[] = Object.keys(constants.signals).filter((signal: string): boolean => signal !== 'SIGKILL' && signal !== 'SIGSTOP')

/**
 * The options of an application, given to `Application.run()`: its identity (`id`, `name`), its time zone, mode and
 * shutdown signals, and the objects it declares, as a module does (see {@link ModuleOptions}). They are validated at
 * launch: invalid options are a fatal exception.
 * @example
 * ```typescript
 * import {Application, type ApplicationOptions, Component} from 'lakutata'
 *
 * class Clock extends Component {
 * }
 *
 * const options: ApplicationOptions = {
 *     id: 'clock.app',
 *     name: 'Clock',
 *     timezone: 'Europe/Paris',
 *     mode: 'production',
 *     shutdownSignals: ['SIGTERM'],
 *     components: {
 *         clock: {class: Clock}
 *     },
 *     bootstrap: ['clock']
 * }
 *
 * Application.run(options)
 * ```
 */
export class ApplicationOptions extends ModuleOptions {

    /**
     * The ID of the application (`'shop.app'`): the `process.title`, read by `Application.appId` and stamped on the
     * exceptions. Required.
     */
    @Expect(DTO.String().required())
    public readonly id: string

    /**
     * The name of the application (`'Shop'`), read by `Application.appName`, written in the logs and stamped on the
     * exceptions. Required.
     */
    @Expect(DTO.String().required())
    public readonly name: string

    /**
     * The time zone of the process (an IANA name such as `'Asia/Shanghai'`, written to the `TZ` environment
     * variable), or `'auto'` for the system's. An unknown time zone is warned of and replaced with the system's.
     * @default 'auto'
     */
    @Expect(DTO.String()
        .optional()
        .default('auto'))
    public readonly timezone?: string | 'auto'

    /**
     * The mode the application runs in (`development` or `production`) when the environment gives none: the `MODE`
     * environment variable, then `NODE_ENV`, override it. The mode is written to both variables.
     * @default 'development'
     */
    @Expect(DTO.String()
        .valid('development', 'production')
        .optional())
    public readonly mode?: 'development' | 'production'

    /**
     * The signals ending the application gracefully: its entrypoints stop (the requests running complete), its objects
     * are destroyed, its done handler runs, then it exits with the code 0. A second signal, or a signal received while
     * the application launches, ends the process at once with the code 128 + the number of the signal (143 for SIGTERM,
     * 130 for SIGINT). SIGTERM and SIGINT by default (docker stop, the rolling updates of Kubernetes, systemd, Ctrl+C);
     * false: the signals are not handled by the application (Node.js ends the process at once).
     * @default ['SIGTERM', 'SIGINT']
     */
    @Expect(DTO.Alternatives(
        DTO.Boolean().valid(false),
        DTO.Array(DTO.String().valid(...CATCHABLE_SIGNALS))
    )
        .optional()
        .default((): NodeJS.Signals[] => ['SIGTERM', 'SIGINT']))
    public readonly shutdownSignals?: false | NodeJS.Signals[]

}
