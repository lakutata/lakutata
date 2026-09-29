import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

export class ListTemplatesDTO extends DTO {
    @Expect(DTO.Boolean().optional().default(false).description('Fetch the catalog of the templates again, even when it is cached'))
    public refresh: boolean
}
