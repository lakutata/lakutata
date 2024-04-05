import {DTO} from '../../../lib/core/DTO.js'
import {Expect} from '../../../decorators/dto/Expect.js'
import type {DockerOutputCallback} from '../types/DockerOutputCallback.js'

export class ImageBuildOptions extends DTO {

    @Expect(DTO.String().required())
    public workdir: string

    @Expect(DTO.Array(DTO.String()).required())
    public files: string[]

    /**
     * Path within the build context to the Dockerfile. This is ignored if remote is specified and points to an external Dockerfile.
     * @default Dockerfile
     */
    @Expect(DTO.String().optional().default('Dockerfile'))
    public dockerfile?: string

    /**
     * A name and optional tag to apply to the image in the name:tag format.
     */
    @Expect(DTO.String().optional())
    public repoTag?: string

    /**
     * Platform in the format os[/arch[/variant]]
     * @default ""
     */
    @Expect(DTO.String().allow('').optional().default(''))
    public platform?: string

    /**
     * Target build stage
     * @default ""
     */
    @Expect(DTO.String().allow('').optional().default(''))
    public target?: string

    /**
     * A Git repository URI or HTTP/HTTPS context URI.
     * If the URI points to a single text file, the file’s contents are placed into a file called Dockerfile and the image is built from that file.
     * If the URI points to a tarball, the file is downloaded by the daemon and the contents therein used as the context for the build.
     * If the URI points to a tarball and the dockerfile parameter is also specified, there must be a file with the corresponding path inside the tarball.
     */
    @Expect(DTO.String().optional())
    public remote?: string

    /**
     * Suppress verbose build output.
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public quite?: boolean

    /**
     * Do not use the cache when building the image.
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public nocache?: boolean

    /**
     * Remove intermediate containers after a successful build.
     * @default true
     */
    @Expect(DTO.Boolean().optional().default(true))
    public rm?: boolean

    /**
     * Always remove intermediate containers, even upon failure.
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public forcerm?: boolean

    /**
     * Size of /dev/shm in bytes. The size must be greater than 0. If omitted the system uses 64MB.
     */
    @Expect(DTO.Number().optional())
    public shmsize?: number

    /**
     * JSON map of string pairs for build-time variables.
     * Users pass these values at build-time.
     * Docker uses the buildargs as the environment context for commands run via the Dockerfile RUN instruction, or for variable expansion in other Dockerfile instructions.
     * This is not meant for passing secret values.
     */
    @Expect(DTO.Object().pattern(DTO.String(), DTO.String()).optional())
    public buildargs?: { [key: string]: string }

    @Expect(DTO.Function().optional())
    public outputCallback?: DockerOutputCallback
}