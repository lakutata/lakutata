import {DTO} from '../../lib/core/DTO.js'
import {Expect} from '../../decorators/dto/Expect.js'
import {ProjectTypeConfig} from '../lib/ProjectTypeConfig.js'

export class CreateProjectOptions extends DTO {

    @Expect(
        DTO
            .String()
            .required()
            .description('specify the name of the project and application')
    )
    public name: string

    @Expect(
        DTO
            .String()
            .required()
            .description('specify the ID of the application')
    )
    public id: string

    @Expect(
        DTO
            .String()
            .required()
            .valid(...Object.keys(ProjectTypeConfig))
            .description(`select the type of the project (choices: ${Object.keys(ProjectTypeConfig).map((type: string): string => `"${type}"`).join(',')})`)
    )
    public type: string

    @Expect(
        DTO
            .String()
            .optional()
            .default(process.cwd())
            .description(`specify the path for creating the project (default: "${process.cwd()}")`)
    )
    public path: string

    @Expect(
        DTO
            .Boolean()
            .strict(false)
            .optional()
            .default(false)
            .description('initialize project only in specified directory without creating a new folder (default: false)')
    )
    public initOnly: boolean

    @Expect(
        DTO
            .String()
            .optional()
            .default('none')
            .description('specify the description of the application (default: "none")')
    )
    public description: string

    @Expect(
        DTO
            .String()
            .optional()
            .default('Anonymous')
            .description('specify the name of the author of the application (default: "Anonymous")')
    )
    public author: string

    @Expect(
        DTO
            .String()
            .optional()
            .default('UNLICENSED')
            .description('specify the name of the license for the application (default: "UNLICENSED")')
    )
    public license: string
}
