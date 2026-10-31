import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

export class MobileStageDTO extends DTO {
    @Expect(DTO.String().required().description('The directory of the Node.js project made: nodejs in the web directory of Capacitor, after the build of the user interface (../ui/dist/nodejs)'))
    public outdir: string

    @Expect(DTO.Boolean().optional().default(true).description('Minify the bundle (true by default)'))
    public minify: boolean
}
