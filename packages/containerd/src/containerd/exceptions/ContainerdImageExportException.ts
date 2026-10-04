import {Exception} from '@lakutata/core'

/**
 * Thrown when images cannot be exported into an archive ({@link Containerd.exportImages},
 * {@link ContainerdImage.export}): the destination cannot be written, or their content is incomplete. Its `errno` is
 * `E_CONTAINERD_IMAGE_EXPORT`.
 */
export class ContainerdImageExportException extends Exception {
    public errno: string | number = 'E_CONTAINERD_IMAGE_EXPORT'
}
