import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

export class CleanDTO extends DTO {
    @Expect(DTO.Array(DTO.String()).optional().description('The paths removed, relative to the package (the outDir and the declarationDir of its tsconfig.json by default)'))
    public paths?: string[]
}
