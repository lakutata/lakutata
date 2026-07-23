import {DTO} from '../../../lib/core/DTO.js'
import {Expect} from '../../../decorators/dto/Expect.js'

export class PostgresCacheOptions extends DTO {
    @Expect(DTO.String().allow('postgres').only().required())
    public type: 'postgres'

    @Expect(DTO.String().required())
    public host: string

    @Expect(DTO.String().required())
    public database: string

    @Expect(DTO.String().required())
    public table: string

    @Expect(DTO.Number().positive().port().optional().default(5432))
    public port?:number

    @Expect(DTO.String().optional().default('public'))
    public schema?: string

    @Expect(DTO.String().required())
    public username: string

    @Expect(DTO.String().required())
    public password: string

    @Expect(DTO.Number().positive().integer().optional())
    public maxPoolSize?: number

    @Expect(DTO.String().optional())
    public namespace?: string
}