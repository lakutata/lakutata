import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {ContainerTTYConsoleSizeOptions} from './ContainerTTYConsoleSizeOptions.js'

export class ContainerTTYOptions extends DTO {
    /**
     * Command to run, as a string or array of strings.
     * @default '/bin/sh'
     */
    @Expect(DTO.Alternatives(DTO.String(), DTO.Array(DTO.String()).min(1)).optional())
    public cmd?: string | string[]

    /**
     * Initial console size
     */
    @Expect(ContainerTTYConsoleSizeOptions.optional())
    public consoleSize?: ContainerTTYConsoleSizeOptions

    /**
     * Its environment variables, added to the ones of the container (TERM=xterm by default)
     */
    @Expect(DTO.Object().pattern(DTO.String(), DTO.String().allow('')).optional())
    public env?: Record<string, string>

    /**
     * Its working directory, the one of the container by default
     */
    @Expect(DTO.String().optional())
    public workingDir?: string

    /**
     * Its user (user, user:group, uid, uid:gid), the one of the container by default
     */
    @Expect(DTO.String().optional())
    public user?: string
}
