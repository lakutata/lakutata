import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import type {DockerOutputCallback} from '../../types/DockerOutputCallback.js'
import {DockerAuthOptions} from '../auth/DockerAuthOptions.js'

/**
 * How {@link Docker.buildImage} builds an image with BuildKit (`docker build`), the built image returned. The build
 * context is the listed files and directories of the working directory, without the ones its `.dockerignore` excludes;
 * the Dockerfile is always sent. `workdir` and `files` are required.
 * @example
 * ```typescript
 * import {Docker} from 'lakutata/com/docker'
 *
 * declare const docker: Docker
 *
 * const image = await docker.buildImage({
 *     workdir: '/srv/projects/api',
 *     files: ['package.json', 'package-lock.json', 'dist'],
 *     repoTag: 'api:1.4.0',
 *     platform: 'linux/amd64',
 *     buildargs: {NODE_VERSION: '22'},
 *     outputCallback: (output: Record<string, any>): void => {
 *         if (output.stream) console.log(output.stream)
 *     }
 * })
 * console.log(image.id)
 * ```
 */
export class ImageBuildOptions extends DTO {

    /**
     * The directory of the build context on this machine, holding the Dockerfile and its `.dockerignore`. Required.
     */
    @Expect(DTO.String().required())
    public workdir: string

    /**
     * The files and directories of `workdir` sent as the build context, their paths relative to it (`['package.json',
     * 'dist']`); the directories are sent with their content, the files excluded by `.dockerignore` are skipped, and
     * the Dockerfile is added. Required.
     */
    @Expect(DTO.Array(DTO.String()).required())
    public files: string[]

    /**
     * The path of the Dockerfile in the build context, relative to `workdir`. Ignored when `remote` points to a
     * Dockerfile.
     * @default 'Dockerfile'
     */
    @Expect(DTO.String().optional().default('Dockerfile'))
    public dockerfile?: string

    /**
     * The repository and tag of the image, `name:tag` (`api:1.4.0`); a name without a tag is tagged `latest`. When
     * absent, the image is named `unnamed_img_<random hexadecimal>:latest`.
     */
    @Expect(DTO.String().optional())
    public repoTag?: string

    /**
     * The platform of the image, `os[/arch[/variant]]` (`linux/amd64`, `linux/arm64/v8`); `''` for the Docker host's
     * platform.
     * @default ''
     */
    @Expect(DTO.String().allow('').optional().default(''))
    public platform?: string

    /**
     * The stage of a multi-stage Dockerfile to build (`FROM … AS <stage>`); `''` for the last stage.
     * @default ''
     */
    @Expect(DTO.String().allow('').optional().default(''))
    public target?: string

    /**
     * A remote build context: a Git repository URL or an HTTP/HTTPS URL. A URL of a text file is used as the
     * Dockerfile; a URL of a tarball is downloaded by Docker and used as the context, which must then hold the
     * `dockerfile` path.
     */
    @Expect(DTO.String().optional())
    public remote?: string

    /**
     * Suppress the verbose build output (`docker build --quiet`).
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public quiet?: boolean

    /**
     * The former, misspelt name of {@link ImageBuildOptions.quiet}: the build is quiet when either is `true`.
     * @deprecated Use `quiet`.
     */
    @Expect(DTO.Boolean().optional())
    public quite?: boolean

    /**
     * Build without the build cache (`docker build --no-cache`).
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public nocache?: boolean

    /**
     * Remove the intermediate containers after a successful build (the legacy builder's `--rm`; BuildKit creates
     * none).
     * @default true
     */
    @Expect(DTO.Boolean().optional().default(true))
    public rm?: boolean

    /**
     * Always remove the intermediate containers, even after a failure (the legacy builder's `--force-rm`; BuildKit
     * creates none).
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public forcerm?: boolean

    /**
     * The size of `/dev/shm` in the build containers, in bytes, greater than 0; 64 MiB when absent.
     */
    @Expect(DTO.Number().optional())
    public shmsize?: number

    /**
     * The build arguments, by name (`{NODE_VERSION: '22'}`): the values of the Dockerfile's `ARG` instructions, in the
     * environment of its `RUN` instructions and expanded in its other instructions. They stay visible in the image's
     * history: not for the secrets.
     */
    @Expect(DTO.Object().pattern(DTO.String(), DTO.String()).optional())
    public buildargs?: { [key: string]: string }

    /**
     * The credentials of a private registry the base images come from. When given, the images of the Dockerfile's
     * `FROM` instructions are pulled first with them (on `platform`, their progress given to `outputCallback`), and
     * BuildKit is given them (the tokens included) for `auth.serverAddress`.
     */
    @Expect(DockerAuthOptions.optional())
    public auth?: DockerAuthOptions

    /**
     * Receive the build progress as it arrives: the BuildKit progress as the lines of `docker build --progress=plain`
     * (`{id: 'moby.buildkit.trace', stream: '#2 [1/2] FROM alpine'}`), and the other messages of Docker as they are
     * sent (the built image's ID, `{aux: {ID: 'sha256:…'}}`, the errors, `{error: '…'}`).
     */
    @Expect(DTO.Function().optional())
    public outputCallback?: DockerOutputCallback
}
