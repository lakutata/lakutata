import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {ContainerdRegistryAuthOptions} from '../ContainerdRegistryAuthOptions.js'
import type {ContainerdBuildOutputCallback} from '../../types/ContainerdBuildOutputCallback.js'

export class ImageBuildOptions extends DTO {
    /**
     * The directory of the context of the build (its .dockerignore excludes its files)
     */
    @Expect(DTO.String().required())
    public workdir: string

    /**
     * Path within the build context to the Dockerfile (or an absolute one)
     * @default Dockerfile
     */
    @Expect(DTO.String().optional().default('Dockerfile'))
    public dockerfile?: string

    /**
     * A name and optional tag to apply to the image in the name:tag format.
     */
    @Expect(DTO.String().required())
    public repoTag: string

    /**
     * The platforms built (linux/amd64, linux/arm64…): the one of the machine by default (the one of a remote BuildKit
     * may be another one)
     */
    @Expect(DTO.Alternatives(DTO.String(), DTO.Array(DTO.String()).min(1)).optional())
    public platform?: string | string[]

    /**
     * The stage of the Dockerfile built
     */
    @Expect(DTO.String().allow('').optional())
    public target?: string

    @Expect(DTO.Object().pattern(DTO.String(), DTO.String().allow('')).optional())
    public buildargs?: Record<string, string>

    @Expect(DTO.Object().pattern(DTO.String(), DTO.String().allow('')).optional())
    public labels?: Record<string, string>

    /**
     * Do not use the cache of BuildKit
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public nocache?: boolean

    /**
     * Resolve the tags of the base images by their registries again
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public pull?: boolean

    /**
     * Push the image built to its registry
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public push?: boolean

    /**
     * The credentials of the registry of the base images (and of the image pushed), the ones of the component by
     * default
     */
    @Expect(ContainerdRegistryAuthOptions.optional())
    public auth?: ContainerdRegistryAuthOptions

    /**
     * The lines of the progress of the build, as docker build --progress=plain writes them
     */
    @Expect(DTO.Function().optional())
    public outputCallback?: ContainerdBuildOutputCallback
}
