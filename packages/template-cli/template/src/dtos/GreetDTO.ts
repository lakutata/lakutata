import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

/**
 * The options of the command: --name <name> [--times <times>] [--loud]
 */
export class GreetDTO extends DTO {
    @Expect(DTO.String().required().description('Who is greeted'))
    public name: string

    @Expect(DTO.Number().integer().min(1).max(10).optional().default(1).description('How many times'))
    public times: number

    @Expect(DTO.Boolean().optional().default(false).description('Greet loudly'))
    public loud: boolean
}
