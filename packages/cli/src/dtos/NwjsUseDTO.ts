import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

export class NwjsUseDTO extends DTO {
    @Expect(DTO.String().required().description('The version of NW.js: a version (0.119.2), latest, or win7 (0.72.0, the last one running on Windows 7, 8 and 8.1)'))
    public version: string

    @Expect(DTO.Boolean().optional().default(false).description('Download the development build of NW.js (with its developer tools) for this machine now'))
    public download: boolean
}
