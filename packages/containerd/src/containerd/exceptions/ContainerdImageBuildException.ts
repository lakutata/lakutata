import {Exception} from '@lakutata/core'

/**
 * Thrown by {@link Containerd.buildImage}, {@link Containerd.buildkitVersion} and
 * {@link Containerd.buildkitPlatforms} when BuildKit cannot be reached at `buildkitAddress`, when the build fails (its
 * message has the failing step), or when the image built cannot be imported. Its `errno` is `E_CONTAINERD_IMAGE_BUILD`.
 */
export class ContainerdImageBuildException extends Exception {
    public errno: string | number = 'E_CONTAINERD_IMAGE_BUILD'
}
