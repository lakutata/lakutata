import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

export class GreetDTO extends DTO {
    @Expect(DTO.String().required().max(64).description('Who is greeted'))
    public name: string
}
