import {DTO} from '../../../lib/core/DTO.js'
import {Expect} from '../../../decorators/dto/Expect.js'
import {DockerAuthOptions} from './DockerAuthOptions.js'
import {type DockerOutputCallback} from '../types/DockerOutputCallback.js'

export class ImagePushOptions extends DTO {
    @Expect(DTO.String().required())
    public repo: string

    @Expect(DTO.String().optional().default('latest'))
    public tag?: string

    @Expect(DockerAuthOptions.optional())
    public auth?: DockerAuthOptions

    @Expect(DTO.Function().optional())
    public outputCallback?: DockerOutputCallback
}
