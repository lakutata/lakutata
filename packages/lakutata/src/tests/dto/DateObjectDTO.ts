import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core'
import {Time} from '@lakutata/core'

export class DateObjectDTO extends DTO {
    @Expect(DTO.Date().strict(false).optional().default(() => new Time().subtract(7, 'days').toDate()))
    public start: Date
}