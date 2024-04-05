import {DTO} from '../../../lib/core/DTO.js'
import {Expect} from '../../../decorators/dto/Expect.js'
import {Stream} from 'node:stream'

export class ImageImportOptions extends DTO {

    @Expect(DTO.Alternatives(DTO.String(), DTO.InstanceOf(Stream)).required())
    public source: string | NodeJS.ReadableStream

    /**
     * Suppress progress details during import
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public quiet?: boolean
}