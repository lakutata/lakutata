import {DTO, Expect, Validator} from '../../Lakutata'

export class MathAddDTO extends DTO {
    @Expect(Validator.Number().required())
    public readonly a: number

    @Expect(Validator.Number().optional().default(66))
    public readonly b?: number
}
