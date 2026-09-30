import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {DockerAuthOptions} from '../auth/DockerAuthOptions.js'
import {type DockerOutputCallback} from '../../types/DockerOutputCallback.js'

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
