import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

export class LanguagesDTO extends DTO {
    @Expect(DTO.Array(DTO.String().max(35)).min(1).max(20).required().description('The languages of the device, preferred first'))
    public languages: string[]
}
