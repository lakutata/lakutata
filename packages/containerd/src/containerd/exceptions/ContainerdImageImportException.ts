import {Exception} from '@lakutata/core'

/**
 * Thrown by {@link Containerd.importImage} when the archive cannot be read, is not an OCI image layout nor a
 * `docker save` archive, has no image, or has several images and a `name` is given; or when its images fail to be
 * unpacked. Its `errno` is `E_CONTAINERD_IMAGE_IMPORT`.
 */
export class ContainerdImageImportException extends Exception {
    public errno: string | number = 'E_CONTAINERD_IMAGE_IMPORT'
}
