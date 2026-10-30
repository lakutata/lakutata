import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

export class BundleDTO extends DTO {
    @Expect(DTO.String().optional().description('The compiled entry of the application (the "main" of the package.json by default)'))
    public entry?: string

    @Expect(DTO.String().optional().description('The bundle (dist/<name>.cjs by default)'))
    public outfile?: string

    @Expect(DTO.Boolean().optional().default(true).description('Minify the bundle'))
    public minify: boolean

    @Expect(DTO.Array(DTO.String()).optional().description('The modules left out of the bundle, loaded at run time from a node_modules next to it (the native addons are handled)'))
    public external?: string[]

    @Expect(DTO.String().pattern(/^v?\d+(\.\d+){0,2}$/).optional().description('The version of Node.js running the bundle, whose syntax it is written in (18.10 for NW.js 0.70; the version running the command by default)'))
    public node?: string
}
