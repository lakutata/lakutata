import {constants} from 'node:os'
import {ModuleOptions} from './ModuleOptions.js'
import {Expect} from '../decorators/dto/Expect.js'
import {DTO} from '../lib/dto/DTO.js'

/**
 * The signals a process can listen to (SIGKILL and SIGSTOP cannot be caught)
 */
const CATCHABLE_SIGNALS: string[] = Object.keys(constants.signals).filter((signal: string): boolean => signal !== 'SIGKILL' && signal !== 'SIGSTOP')

export class ApplicationOptions extends ModuleOptions {

    /**
     * AppId
     */
    @Expect(DTO.String().required())
    public readonly id: string

    /**
     * AppName
     */
    @Expect(DTO.String().required())
    public readonly name: string

    /**
     * Application timezone
     */
    @Expect(DTO.String()
        .optional()
        .default('auto'))
    public readonly timezone?: string | 'auto'

    /**
     * runtime environment (development or production, default value is development)
     */
    @Expect(DTO.String()
        .valid('development', 'production')
        .optional()
        .default('development'))
    public readonly mode?: 'development' | 'production'

    /**
     * The signals ending the application gracefully: its entrypoints stop (the requests running complete), its objects
     * are destroyed, its done handler runs, then it exits with the code 0. A second signal, or a signal received while
     * the application launches, ends the process at once with the code 128 + the number of the signal (143 for SIGTERM,
     * 130 for SIGINT). SIGTERM and SIGINT by default (docker stop, the rolling updates of Kubernetes, systemd, Ctrl+C);
     * false: the signals are not handled by the application (Node.js ends the process at once)
     */
    @Expect(DTO.Alternatives(
        DTO.Boolean().valid(false),
        DTO.Array(DTO.String().valid(...CATCHABLE_SIGNALS))
    )
        .optional()
        .default((): NodeJS.Signals[] => ['SIGTERM', 'SIGINT']))
    public readonly shutdownSignals?: false | NodeJS.Signals[]

}
