import {DTO} from 'lakutata'
import {Expect} from 'lakutata/decorator/dto'

export class FFIGenerateDTO extends DTO {
    @Expect(DTO.String().required().description('The C header of the library'))
    public header: string

    @Expect(DTO.String().optional().description('The library its functions are checked against: a name, as @Library takes it, or a file (the name of the header by default)'))
    public library?: string

    @Expect(DTO.String().optional().description('The name of the class (the name of the header in PascalCase by default)'))
    public className?: string

    @Expect(DTO.String().optional().description('The TypeScript file written (<class>.ts in the current directory by default)'))
    public out?: string

    @Expect(DTO.Array(DTO.String()).optional().description('The directories of the headers it includes (-I)'))
    public include?: string[]

    @Expect(DTO.Array(DTO.String()).optional().description('The macros defined before it: NAME or NAME=value (-D)'))
    public define?: string[]

    @Expect(DTO.Array(DTO.String()).optional().description('More directories whose headers are the ones of the library (the header already is, and so are the headers of its directory unless that is a directory of the system)'))
    public own?: string[]

    @Expect(DTO.String().optional().description('The C compiler whose preprocessor reads the header: cc, gcc, clang, cl (the one of CC by default, else cl on Windows and cc elsewhere)'))
    public compiler?: string

    @Expect(DTO.Boolean().optional().default(true).description('Check the functions and the variables against the library, leaving out the ones it cannot give'))
    public check: boolean

    @Expect(DTO.Boolean().optional().default(false).description('Replace the file when it exists'))
    public force: boolean
}
