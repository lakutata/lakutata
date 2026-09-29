import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

export class BundleDTO extends DTO {
    @Expect(DTO.String().optional().description('The compiled entry of the application (the "main" of the package.json by default)'))
    public entry?: string

    @Expect(DTO.String().optional().description('The bundle (dist/<name>.cjs by default)'))
    public outfile?: string

    @Expect(DTO.Boolean().optional().default(true).description('Minify the bundle'))
    public minify: boolean

    @Expect(DTO.Array(DTO.String()).optional().description('The modules left out of the bundle, loaded at run time (the native addons)'))
    public external?: string[]
}
