import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

export class ExecutableDTO extends DTO {
    @Expect(DTO.Array(DTO.String()).optional().description('The platforms of the executables: linux-x64, linux-arm64, darwin-arm64, darwin-x64, win-x64… (the current one by default)'))
    public target?: string[]

    @Expect(DTO.String().optional().description('The compiled entry of the application (the "main" of the package.json by default)'))
    public entry?: string

    @Expect(DTO.String().optional().description('The directory of the executables (dist by default)'))
    public outdir?: string

    @Expect(DTO.Boolean().optional().default(true).description('Minify the bundle embedded in the executables'))
    public minify: boolean

    @Expect(DTO.Array(DTO.String()).optional().description('The modules left out of the bundle (they are not in the executables: they are loaded from a node_modules next to them)'))
    public external?: string[]
}
