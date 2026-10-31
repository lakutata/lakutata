import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

export class NwjsRunDTO extends DTO {
    @Expect(DTO.Array(DTO.String()).optional().description('The arguments given to the application, after -- (lakutata nwjs run -- --renderer=http://localhost:5173)'))
    public args?: string[]

    @Expect(DTO.String().optional().description('The release of NW.js run: a version, latest or win7 (the version of lakutata.nwjs by default)'))
    public release?: string

    @Expect(DTO.String().valid('sdk', 'normal').optional().default('sdk').description('The flavor of NW.js: sdk (with its developer tools, by default) or normal (the one shipped to the users)'))
    public flavor: 'sdk' | 'normal'
}
