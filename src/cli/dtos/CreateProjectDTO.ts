import {DTO, Expect, Validator} from '../../Lakutata'
import {ProjectType} from '../enums/ProjectType'

export class CreateProjectDTO extends DTO {

    @Expect(Validator.String().required())
    public readonly path: string

    @Expect(Validator.String().valid(...Object.values(ProjectType)).required())
    public readonly type: string
}
