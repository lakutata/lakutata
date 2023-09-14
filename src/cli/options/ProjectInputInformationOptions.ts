import {DTO, Expect, Validator} from '../../Lakutata'
import {ProjectType} from '../enums/ProjectType'

export class ProjectInputInformationOptions extends DTO {
    @Expect(Validator.String().required())
    public readonly path: string

    @Expect(Validator.String().valid(...Object.values(ProjectType)))
    public readonly type?: string

    @Expect(Validator.String().optional())
    public readonly id?: string

    @Expect(Validator.String().optional())
    public readonly name?: string

    @Expect(Validator.String().optional())
    public readonly description?: string

    @Expect(Validator.String().optional())
    public readonly author?: string

    @Expect(Validator.String().optional())
    public readonly license?: string
}
