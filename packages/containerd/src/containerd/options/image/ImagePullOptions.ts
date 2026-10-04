import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {ContainerdRegistryAuthOptions} from '../ContainerdRegistryAuthOptions.js'
import type {ContainerdProgressCallback} from '../../types/ContainerdProgressCallback.js'

/**
 * How {@link Containerd.pullImage} pulls an image from its registry into containerd, returning it: the manifests of the
 * platforms asked, their configurations and their layers. Only `image` is required. A failure throws
 * {@link ContainerdImagePullException}; a platform the image does not have throws {@link ContainerdPlatformException}.
 * The registries in the component's `insecureRegistries` are accessed over HTTP. Unlike the Docker component's options,
 * the image is one reference (no `repo` and `tag`), several platforms can be pulled, and the progress is reported per
 * blob in bytes.
 * @example
 * ```typescript
 * import {Containerd} from 'lakutata/com/containerd'
 *
 * declare const containerd: Containerd
 *
 * const image = await containerd.pullImage({
 *     image: 'alpine:3.20',
 *     platform: ['linux/amd64', 'linux/arm64'],
 *     progressCallback: ({digest, current, total}): void => console.log(digest, current, '/', total)
 * })
 * console.log(image.name, image.platforms)
 * ```
 */
export class ImagePullOptions extends DTO {
    /**
     * The image reference (`'alpine'`, `'alpine:3.20'`, `'registry.example.com:5000/app@sha256:…'`), normalized as
     * Docker does (`'docker.io/library/alpine:latest'`), the tag `latest` when it has neither a tag nor a digest. The
     * image is named by it in containerd. Required.
     */
    @Expect(DTO.String().required())
    public image: string

    /**
     * The platforms pulled: one (`'linux/arm64'`, `'linux/arm/v7'`, `'arm64'` for `linux/arm64`) or several, or
     * `'all'` for every platform of the image. The machine's platform by default.
     */
    @Expect(DTO.Alternatives(DTO.String(), DTO.Array(DTO.String()).min(1)).optional())
    public platform?: string | string[]

    /**
     * The credentials of the image's registry; the component's credentials of that registry (`registryAuths`) by
     * default, anonymous without them.
     */
    @Expect(ContainerdRegistryAuthOptions.optional())
    public auth?: ContainerdRegistryAuthOptions

    /**
     * Unpack the layers into snapshots, for the platforms pulled that the machine runs
     * ({@link Containerd.supportedPlatforms}: its own and the ones of its emulators), so that their containers are
     * created at once; the other platforms are only stored. Without it, a container creation unpacks them.
     * @default true
     */
    @Expect(DTO.Boolean().optional().default(true))
    public unpack?: boolean

    /**
     * Receive the download progress of each blob ({@link ContainerdProgressCallback}).
     */
    @Expect(DTO.Function().optional())
    public progressCallback?: ContainerdProgressCallback
}
