import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core'
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
