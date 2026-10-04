import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

export class ContainerCommitOptions extends DTO {
    /**
     * Commit repoTag, the name of the image of the container with the tag of the commit by default
     */
    @Expect(DTO.String().optional())
    public repoTag?: string

    /**
     * Whether to pause the container before committing
     * @default true
     */
    @Expect(DTO.Boolean().optional().default(true))
    public pauseBeforeCommitting?: boolean

    /**
     * The changes of the configuration of the image committed
     */
    @Expect(DTO.Object({
        cmd: DTO.Array(DTO.String()).optional(),
        entrypoint: DTO.Array(DTO.String()).optional(),
        env: DTO.Object().pattern(DTO.String(), DTO.String().allow('')).optional(),
        workingDir: DTO.String().optional(),
        user: DTO.String().optional(),
        labels: DTO.Object().pattern(DTO.String(), DTO.String().allow('')).optional(),
        exposedPorts: DTO.Array(DTO.String().pattern(/^\d+(\/(tcp|udp|sctp))?$/)).optional()
    }).optional())
    public changes?: { cmd?: string[], entrypoint?: string[], env?: Record<string, string>, workingDir?: string, user?: string, labels?: Record<string, string>, exposedPorts?: string[] }

    @Expect(DTO.String().optional())
    public comment?: string

    @Expect(DTO.String().optional())
    public author?: string
}
