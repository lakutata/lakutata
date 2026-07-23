import {DTO} from '../../../lib/core/DTO.js'
import {Expect} from '../../../decorators/dto/Expect.js'

export class MongoCacheOptions extends DTO {
    @Expect(DTO.String().allow('mongo').only().required())
    public type: 'mongo'

    @Expect(DTO.String().required())
    public host: string

    @Expect(DTO.String().required())
    public database: string

    @Expect(DTO.String().required())
    public collection:string

    @Expect(DTO.Number().positive().port().optional().default(27017))
    public port?: number

    @Expect(DTO.String().required())
    public username: string

    @Expect(DTO.String().required())
    public password: string

    @Expect(DTO.String().optional())
    public namespace?: string
}