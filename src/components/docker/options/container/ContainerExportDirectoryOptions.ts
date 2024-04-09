import {DTO} from '../../../../lib/core/DTO.js'
import {Expect} from '../../../../decorators/dto/Expect.js'
import {Stream, Writable} from 'node:stream'

export class ContainerExportDirectoryOptions extends DTO {
    /**
     * Resource in the container’s filesystem to archive.
     */
    @Expect(DTO.String().required())
    public path: string

    /**
     * Destination of exported archive
     */
    @Expect(DTO.Alternatives(DTO.String(), DTO.InstanceOf(Stream)).required())
    public destination: string | Writable
}
