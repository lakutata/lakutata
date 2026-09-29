import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

export class GreetDTO extends DTO {
    @Expect(DTO.String().optional().default('world').description('Who is greeted'))
    public name: string
}
