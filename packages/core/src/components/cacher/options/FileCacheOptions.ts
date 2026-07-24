import {DTO} from '../../../lib/core/DTO.js'
import {Expect} from '../../../decorators/dto/Expect.js'

export class FileCacheOptions extends DTO {
    @Expect(DTO.String().allow('file').only().required())
    public type: 'file'

    /**
     * the file path to store the data
     */
    @Expect(DTO.String().required())
    public filename: string

    /**
     * ms, check and remove expired data in each ms
     */
    @Expect(DTO.Number().positive().optional().default(3600 * 1000))
    public expiredCheckDelay?: number

    /**
     * ms, batch write to disk in a specific duration, enhance write performance.
     */
    @Expect(DTO.Number().positive().allow(0).optional().default(100))
    public writeDelay?: number

    /**
     * namespace
     */
    @Expect(DTO.String().optional())
    public namespace?: string
}