import {DTO} from '../../../lib/core/DTO.js'
import {Expect} from '../../../decorators/dto/Expect.js'
import {Stream} from 'node:stream'

export class ImageExportOptions extends DTO {
    /**
     * Where the image exported to, should be filename or write stream
     */
    @Expect(DTO.Alternatives(DTO.String(), DTO.InstanceOf(Stream)).required())
    public destination: string | NodeJS.WritableStream

    /**
     * Export specific repoTag
     */
    @Expect(DTO.String().optional())
    public repoTag?: string

    /**
     * Create specific repoTag if not exist
     * @default true
     */
    @Expect(DTO.Boolean().optional().default(true))
    public createRepoTagIfNotExists?: boolean
}
