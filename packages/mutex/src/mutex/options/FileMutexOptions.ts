import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * The locks of the processes of a host: the lock files of a directory
 */
export class FileMutexOptions extends DTO {
    @Expect(DTO.String().valid('file').required())
    public type: 'file'

    /**
     * The directory of the lock files, lakutata-mutex of the temporary directory by default
     */
    @Expect(DTO.String().optional())
    public directory?: string
}
