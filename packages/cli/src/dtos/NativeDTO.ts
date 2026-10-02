import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

export class NativeDTO extends DTO {
    @Expect(DTO.String().valid('link', 'include', 'define').required().description('link: a library; include: a directory of headers; define: a macro (NAME or NAME=value)'))
    public action: 'link' | 'include' | 'define'

    @Expect(DTO.String().required().description('The library (a library of the system, a file of the package: .a .lib .so .dylib .dll), the directory, the macro'))
    public value: string

    @Expect(DTO.String().valid('mac', 'linux', 'win').optional().description('The platform of the change (the platform of the file of a library by default, every platform otherwise)'))
    public platform?: 'mac' | 'linux' | 'win'

    @Expect(DTO.Boolean().optional().default(false).description('The library is a package of pkg-config'))
    public pkgConfig: boolean

    @Expect(DTO.Boolean().optional().default(false).description('The library is a framework of macOS'))
    public framework: boolean

    @Expect(DTO.Boolean().optional().default(false).description('The library is a crate (Rust addons, cargo add)'))
    public crate: boolean

    @Expect(DTO.String().optional().description('The target of the build file changed (its only one by default)'))
    public target?: string
}
