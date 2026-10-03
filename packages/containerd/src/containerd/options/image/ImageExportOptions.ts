import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {Stream} from 'node:stream'

export class ImageExportOptions extends DTO {
    /**
     * Where the archive is written (an OCI image layout loaded by docker load and nerdctl load): its file or its stream
     */
    @Expect(DTO.Alternatives(DTO.String(), DTO.InstanceOf(Stream)).required())
    public destination: string | NodeJS.WritableStream
}
