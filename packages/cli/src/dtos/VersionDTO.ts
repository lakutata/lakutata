import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

export class VersionDTO extends DTO {
    @Expect(DTO.String().required().description('major, minor, patch, premajor, preminor, prepatch, prerelease, or a version'))
    public bump: string

    @Expect(DTO.String().optional().description('The identifier of the prereleases ("beta")'))
    public preid?: string

    @Expect(DTO.Boolean().optional().default(false).description('Commit the changes and tag them "v<version>"'))
    public git: boolean

    @Expect(DTO.Boolean().optional().default(false).description('Give the version without confirmation'))
    public yes: boolean
}
