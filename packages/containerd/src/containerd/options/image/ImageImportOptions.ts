import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {Stream} from 'node:stream'

export class ImageImportOptions extends DTO {
    /**
     * The archive imported (an OCI image layout, the archive of docker save or of nerdctl save): its file or its stream
     */
    @Expect(DTO.Alternatives(DTO.String(), DTO.InstanceOf(Stream)).required())
    public source: string | NodeJS.ReadableStream

    /**
     * The name of the images imported, the ones of the archive by default
     */
    @Expect(DTO.String().optional())
    public name?: string

    /**
     * Unpack their layers into the snapshots
     * @default true
     */
    @Expect(DTO.Boolean().optional().default(true))
    public unpack?: boolean
}
