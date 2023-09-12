import {DTO, Expect, Validator} from '../../Lakutata'
import {ProjectType} from '../enums/ProjectType'

export class InitProjectDTO extends DTO {

    @Expect(Validator.String().valid(...Object.values(ProjectType)))
    public readonly type: string

    @Expect(Validator.String().required())
    public readonly name: string
}
