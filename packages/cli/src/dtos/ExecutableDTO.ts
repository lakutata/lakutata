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

    @Expect(DTO.String().valid('file', 'directory').optional().default('file').description('One file, its native addons and its resources embedded (file, by default), or a directory: the executable and its native addons and resources next to it (directory)'))
    public layout: 'file' | 'directory'

    @Expect(DTO.String().optional().description('The node program embedded in the executable (Node.js 20.12, 21.7 or later): another Node.js than the one running the command, to make the executable from an older Node.js (the bundle is written in the syntax of the node program)'))
    public nodeProgram?: string
}
