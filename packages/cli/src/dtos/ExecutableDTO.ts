import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

export class ExecutableDTO extends DTO {
    @Expect(DTO.String().optional().description('The compiled entry of the application (the "main" of the package.json by default)'))
    public entry?: string

    @Expect(DTO.String().optional().description('The directory of the executable (dist by default)'))
    public outdir?: string

    @Expect(DTO.Boolean().optional().default(true).description('Minify the bundle embedded in the executable'))
    public minify: boolean

    @Expect(DTO.Array(DTO.String()).optional().description('The modules left out of the bundle (they are not in the executable: they are loaded from a node_modules next to it)'))
    public external?: string[]

    @Expect(DTO.String().valid('node', 'bun').optional().default('node').description('The runtime embedded in the executable: node (the single executable applications of Node.js, by default) or bun (Bun, installed in the project or on the system)'))
    public runtime: 'node' | 'bun'
}
