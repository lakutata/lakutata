import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {Time} from '@lakutata/utils'

export class DateObjectDTO extends DTO {
    @Expect(DTO.Date().strict(false).optional().default(() => new Time().subtract(7, 'days').toDate()))
    public start: Date
}