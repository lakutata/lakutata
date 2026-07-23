import {DTO} from '../../../../lib/core/DTO.js'
import {Expect} from '../../../../decorators/dto/Expect.js'

export class DockerAuthOptions extends DTO {
    @Expect(DTO.String().optional())
    public username?: string

    @Expect(DTO.String().optional())
    public password?: string

    /**
     * The serverAddress is a domain/IP without a protocol
     */
    @Expect(DTO.String().required())
    public serverAddress: string

    @Expect(DTO.String().optional())
    public identityToken?: string | undefined

    @Expect(DTO.String().optional())
    public registryToken?: string | undefined
}
