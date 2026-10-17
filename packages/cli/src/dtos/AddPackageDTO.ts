import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

export class AddPackageDTO extends DTO {
    @Expect(DTO.String().required().description('The name of the package (its directory in the packages of the workspace: packages/<name>)'))
    public name: string

    @Expect(DTO.Alternatives(DTO.Boolean(), DTO.String().valid('gyp', 'cmake', 'rust')).optional().default(false).description('A native addon, by its build system: gyp (C++, node-gyp, by default), cmake (C++, cmake-js) or rust (napi-rs)'))
    public native: boolean | 'gyp' | 'cmake' | 'rust'

    @Expect(DTO.String().optional().description('The package of the workspace depending on it'))
    public to?: string
}
