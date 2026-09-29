import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

export class RunScriptDTO extends DTO {
    @Expect(DTO.String().required().description('The script run in the packages having it'))
    public script: string

    @Expect(DTO.Number().integer().min(1).optional().description('How many packages run at a time (the number of the processors by default)'))
    public concurrency?: number

    @Expect(DTO.Boolean().optional().default(true).description('Stop at the first failure'))
    public bail: boolean

    @Expect(DTO.Array(DTO.String()).optional().description('The packages run, by name ("*" wildcards)'))
    public scope?: string[]
}
