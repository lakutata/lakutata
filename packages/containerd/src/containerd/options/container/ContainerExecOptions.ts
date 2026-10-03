import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

export class ContainerExecOptions extends DTO {
    /**
     * Command to run: its arguments, or a command line of /bin/sh
     */
    @Expect(DTO.Alternatives(DTO.String(), DTO.Array(DTO.String()).min(1)).required())
    public cmd: string | string[]

    /**
     * Its environment variables, added to the ones of the container
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

    /**
     * Its standard input
     */
    @Expect(DTO.Alternatives(DTO.String().allow(''), DTO.Binary()).optional())
    public stdin?: string | Buffer

    /**
     * Milliseconds it runs at most (killed after)
     */
    @Expect(DTO.Number().integer().positive().optional())
    public timeout?: number
}
