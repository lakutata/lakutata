import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'
import {ContainerdRegistryAuthOptions} from '../ContainerdRegistryAuthOptions.js'
import type {ContainerdProgressCallback} from '../../types/ContainerdProgressCallback.js'

/**
 * Where and how {@link ContainerdImage.push} pushes an image to a registry: an image of one manifest as it is; the
 * manifest of `platform` when it is given; else the whole index of a multi-platform image when the content store has
 * all its platforms, the manifest of the machine's platform otherwise. Every field is optional. A failure throws
 * {@link ContainerdImagePushException}. The registries in the component's `insecureRegistries` are accessed over HTTP.
 * Unlike the Docker component's options, the destination is one reference (no `repo` and `tag`), the image is not
 * tagged with it in containerd, and the identity tokens are sent.
 * @example
 * ```typescript
 * import {Containerd} from 'lakutata/com/containerd'
 *
 * declare const containerd: Containerd
 *
 * const image = await containerd.getImage('app:1.0')
 * await image.push({
 *     reference: 'registry.example.com:5000/team/app:1.0',
 *     auth: {username: 'ci', password: process.env.REGISTRY_TOKEN ?? ''}
 * })
 * ```
 */
export class ImagePushOptions extends DTO {
    /**
     * The reference pushed to (`'registry.example.com:5000/team/app:1.0'`); the image's name by default.
     */
    @Expect(DTO.String().optional())
    public reference?: string

    /**
     * The platform whose manifest alone is pushed under the reference (`'linux/arm64'`), even when the content store
     * has all the platforms of the image's index. Without it, the whole index is pushed when all its platforms are
     * present, else the machine's platform. An image without the platform throws {@link ContainerdPlatformException}.
     */
    @Expect(DTO.String().optional())
    public platform?: string

    /**
     * The credentials of the registry of the reference; the component's credentials of that registry
     * (`registryAuths`) by default.
     */
    @Expect(ContainerdRegistryAuthOptions.optional())
    public auth?: ContainerdRegistryAuthOptions

    /**
     * Receive the upload progress ({@link ContainerdProgressCallback}): once per blob, after its upload.
     */
    @Expect(DTO.Function().optional())
    public progressCallback?: ContainerdProgressCallback
}
