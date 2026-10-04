import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {ContainerdRegistryAuthOptions} from '../ContainerdRegistryAuthOptions.js'
import type {ContainerdBuildOutputCallback} from '../../types/ContainerdBuildOutputCallback.js'

/**
 * How {@link Containerd.buildImage} builds an image from a Dockerfile with BuildKit (the one at the component's
 * `buildkitAddress`, local or remote): the build context and the Dockerfile are sent by a BuildKit session, the image
 * built is imported into containerd under `repoTag` (and pushed when asked). `workdir` and `repoTag` are required.
 * A failure throws {@link ContainerdImageBuildException}. Unlike the Docker component's options, the context files are
 * selected by its `.dockerignore` (there is no `files`), `repoTag` is required, several platforms can be built at once,
 * and the image can be pushed.
 * @example
 * ```typescript
 * import {Containerd} from 'lakutata/com/containerd'
 *
 * declare const containerd: Containerd
 *
 * const image = await containerd.buildImage({
 *     workdir: '/srv/app',
 *     repoTag: 'registry.example.com/team/app:1.0',
 *     platform: ['linux/amd64', 'linux/arm64'],
 *     buildargs: {NODE_VERSION: '22'},
 *     push: true,
 *     outputCallback: (line: string): void => console.log(line)
 * })
 * console.log(image.name, image.platforms)
 * ```
 */
export class ImageBuildOptions extends DTO {
    /**
     * The build context directory (absolute, or relative to the process working directory); its files excluded by its
     * `.dockerignore` are not sent. Required.
     */
    @Expect(DTO.String().required())
    public workdir: string

    /**
     * The Dockerfile: a path relative to `workdir`, or an absolute one (its directory is then sent to BuildKit too).
     * @default 'Dockerfile'
     */
    @Expect(DTO.String().optional().default('Dockerfile'))
    public dockerfile?: string

    /**
     * The name of the image built (`'app:1.0'`, `'registry.example.com/team/app:1.0'`), normalized
     * (`'docker.io/library/app:1.0'`); a name without a tag gets `latest`. Required.
     */
    @Expect(DTO.String().required())
    public repoTag: string

    /**
     * The platforms built: one (`'linux/arm64'`) or several (`['linux/amd64', 'linux/arm64']`, a multi-platform
     * image). BuildKit must build them (its workers, its emulators: {@link Containerd.buildkitPlatforms}). The platform
     * of the machine running the application by default, even with a remote BuildKit.
     */
    @Expect(DTO.Alternatives(DTO.String(), DTO.Array(DTO.String()).min(1)).optional())
    public platform?: string | string[]

    /**
     * The Dockerfile stage built (`FROM … AS <target>`); `''` or absent builds the last stage.
     */
    @Expect(DTO.String().allow('').optional())
    public target?: string

    /**
     * The values of the Dockerfile's `ARG`s by name (`--build-arg`).
     */
    @Expect(DTO.Object().pattern(DTO.String(), DTO.String().allow('')).optional())
    public buildargs?: Record<string, string>

    /**
     * The labels added to the image configuration (`--label`).
     */
    @Expect(DTO.Object().pattern(DTO.String(), DTO.String().allow('')).optional())
    public labels?: Record<string, string>

    /**
     * Run every step again, without BuildKit's cache.
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public nocache?: boolean

    /**
     * Resolve the base images' tags with their registries again, instead of using the ones BuildKit has (`--pull`).
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public pull?: boolean

    /**
     * Push the image built to the registry of `repoTag` once it is imported (as {@link ContainerdImage.push} does).
     * @default false
     */
    @Expect(DTO.Boolean().optional().default(false))
    public push?: boolean

    /**
     * The credentials of the registry of `repoTag`, used for the base images pulled from that registry and for the
     * push; the other registries use the component's `registryAuths`. The component's credentials of that registry by
     * default.
     */
    @Expect(ContainerdRegistryAuthOptions.optional())
    public auth?: ContainerdRegistryAuthOptions

    /**
     * Receive the build progress line by line, as `docker build --progress=plain` prints it
     * ({@link ContainerdBuildOutputCallback}).
     */
    @Expect(DTO.Function().optional())
    public outputCallback?: ContainerdBuildOutputCallback
}
