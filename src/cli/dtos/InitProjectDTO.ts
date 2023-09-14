import {DTO, Expect, Validator} from '../../Lakutata'
import {ProjectType} from '../enums/ProjectType'

export class InitProjectDTO extends DTO {

    @Expect(Validator.String().required())
    public readonly path: string

    @Expect(Validator.String().valid(...Object.values(ProjectType)).default(ProjectType.plain))
    public readonly type: string
}
