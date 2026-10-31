import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

export class NwjsVersionsDTO extends DTO {
    @Expect(DTO.Boolean().optional().default(false).description('List every release lakutata runs on (the latest ten and the one of Windows 7 by default)'))
    public all: boolean
}
