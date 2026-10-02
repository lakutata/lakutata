import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

export class MigrationDTO extends DTO {
    @Expect(DTO.String().valid('generate').required().description('generate: the migrations of the changes of the entities of the Database components and providers of the application'))
    public action: 'generate'

    @Expect(DTO.String().optional().default('src/migrations').description('The directory of the migrations, relative to the package'))
    public dir: string

    @Expect(DTO.String().optional().default('dev').description('The script of the package building and starting the application'))
    public script: string

    @Expect(DTO.String().optional().description('The package of the workspace of the application (the current directory by default)'))
    public package?: string
}
