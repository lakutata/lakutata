import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

export class InstallerDTO extends DTO {
    @Expect(DTO.Array(DTO.String()).optional().description('The installers made: deb, rpm, apk, archlinux, tar.gz on Linux (the lakutata.installer of the package.json by default)'))
    public target?: string[]

    @Expect(DTO.String().optional().description('The directory of the installers (dist/installer by default)'))
    public outdir?: string

    @Expect(DTO.String().optional().description('The compiled entry of the application (the "main" of the package.json by default)'))
    public entry?: string

    @Expect(DTO.Boolean().optional().default(true).description('Minify the bundle embedded in the executable'))
    public minify: boolean

    @Expect(DTO.Array(DTO.String()).optional().description('The modules left out of the bundle'))
    public external?: string[]
}
