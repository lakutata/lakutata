import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

export class AddPackageDTO extends DTO {
    @Expect(DTO.String().required().description('The name of the package (packages/<name> of the workspace)'))
    public name: string

    @Expect(DTO.Boolean().optional().default(false).description('A native addon: C++ with node-addon-api, built by node-gyp, loaded by node-gyp-build'))
    public native: boolean

    @Expect(DTO.String().optional().description('The package of the workspace depending on it'))
    public to?: string
}
