import {ProjectInputInformationOptions} from './ProjectInputInformationOptions'
import {Expect} from '../../decorators/ValidationDecorators'
import {Validator} from '../../exports/Validator'
import {ProjectType} from '../enums/ProjectType'

export class ProjectCompleteInformationOptions extends ProjectInputInformationOptions {

    @Expect(Validator.String().valid(...Object.values(ProjectType)).required())
    public declare readonly type: string

    @Expect(Validator.String().required())
    public declare readonly id: string

    @Expect(Validator.String().required())
    public declare readonly name: string

    @Expect(Validator.String().required())
    public declare readonly description: string

    @Expect(Validator.String().required())
    public declare readonly author: string

    @Expect(Validator.String().required())
    public declare readonly license: string
}
