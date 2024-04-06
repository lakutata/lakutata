import {DTO} from '../../../../lib/core/DTO.js'
import {Expect} from '../../../../decorators/dto/Expect.js'
import {DockerAuthOptions} from '../auth/DockerAuthOptions.js'
import type {DockerOutputCallback} from '../../types/DockerOutputCallback.js'

export class ImagePullOptions extends DTO {
    @Expect(DTO.String().required())
    public repo: string

    @Expect(DTO.String().optional().default('latest'))
    public tag?: string

    @Expect(DTO.String().optional())
    public platform?: string

    @Expect(DockerAuthOptions.optional())
    public auth?: DockerAuthOptions

    @Expect(DTO.Function().optional())
    public outputCallback?: DockerOutputCallback
}
