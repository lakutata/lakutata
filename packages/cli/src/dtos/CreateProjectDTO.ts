import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

export class CreateProjectDTO extends DTO {
    @Expect(DTO.String().required().pattern(/^([a-zA-Z0-9_-]+\.?)*[a-zA-Z0-9_-]+$/).description('The name of the application'))
    public name: string

    @Expect(DTO.String().optional().pattern(/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/).description('The ID of the application (a package name), its name in lower case by default'))
    public id?: string

    @Expect(DTO.String().optional().default('default').description('The template of the project (lakutata templates lists them)'))
    public template: string

    @Expect(DTO.String().optional().default('.').description('The directory the project directory is created in'))
    public path: string

    @Expect(DTO.Boolean().optional().default(false).description('Create the project in the directory itself, which may exist and not be empty'))
    public init: boolean

    @Expect(DTO.String().allow('').optional().default('').description('The description of the application'))
    public description: string

    @Expect(DTO.String().allow('').optional().default('').description('The author of the application'))
    public author: string

    @Expect(DTO.String().optional().default('UNLICENSED').description('The license of the application'))
    public license: string

    @Expect(DTO.String().valid('npm', 'pnpm', 'yarn', 'none').optional().description('The package manager installing the dependencies, the one running the tool by default ("none" does not install them)'))
    public packageManager?: 'npm' | 'pnpm' | 'yarn' | 'none'

    @Expect(DTO.Boolean().optional().default(true).description('Initialize a git repository'))
    public git: boolean

    @Expect(DTO.Boolean().optional().default(false).description('Create the project without confirmation'))
    public yes: boolean
}
