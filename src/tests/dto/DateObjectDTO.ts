import {DTO} from '../../lib/core/DTO.js'
import {Expect} from '../../decorators/dto/Expect.js'
import {Time} from '../../lib/core/Time.js'

export class DateObjectDTO extends DTO {
    @Expect(DTO.Date().strict(false).optional().default(() => new Time().subtract(7, 'days').toDate()))
    public start: Date
}