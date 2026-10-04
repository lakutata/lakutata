import {Exception} from '@lakutata/core'

/**
 * Thrown when no image of the namespace has the name asked: by {@link Containerd.getImage}, the creation of a
 * container of an image not pulled (images are never pulled implicitly), and the operations on an image removed. Its
 * `errno` is `E_CONTAINERD_IMAGE_NOT_FOUND`.
 */
export class ContainerdImageNotFoundException extends Exception {
    public errno: string | number = 'E_CONTAINERD_IMAGE_NOT_FOUND'
}
