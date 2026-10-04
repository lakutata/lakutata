import {Exception} from '@lakutata/core'

/**
 * Thrown by {@link DockerImage.export} when the image does not have the `repoTag` to export and
 * `createRepoTagIfNotExists` is `false`. Its `errno` is `E_DOCKER_IMAGE_REPO_TAG_NOT_FOUND`.
 */
export class DockerImageRepoTagNotFoundException extends Exception {
    public errno: string | number = 'E_DOCKER_IMAGE_REPO_TAG_NOT_FOUND'
}
