import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

export class InstallerDTO extends DTO {
    @Expect(DTO.Array(DTO.String()).optional().description('The installers made: deb, rpm, apk, archlinux, tar.gz on Linux, pkg, dmg (the applications of NW.js), tar.gz on macOS, nsis, msi, zip on Windows (the lakutata.installer of the package.json by default)'))
    public target?: string[]

    @Expect(DTO.String().optional().description('The directory of the installers (dist/installer by default)'))
    public outdir?: string

    @Expect(DTO.String().optional().description('The compiled entry of the application (the "main" of the package.json by default)'))
    public entry?: string

    @Expect(DTO.Boolean().optional().default(true).description('Minify the bundle embedded in the executable'))
    public minify: boolean

    @Expect(DTO.Array(DTO.String()).optional().description('The modules left out of the bundle'))
    public external?: string[]

    @Expect(DTO.String().optional().description('The node program embedded in the executable (Node.js 20.12, 21.7 or later): another Node.js than the one running the command, to make the executable from an older Node.js (the bundle is written in the syntax of the node program)'))
    public nodeProgram?: string

    @Expect(DTO.String().valid('x64', 'ia32', 'arm64').optional().description('The architecture of an application of NW.js (the one of this machine by default): ia32 for the 32-bit systems of Windows (Windows 7)'))
    public arch?: 'x64' | 'ia32' | 'arm64'
}
