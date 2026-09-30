import {Exception} from '@lakutata/core'

export class DockerImageRepoTagNotFoundException extends Exception {
    public errno: string | number = 'E_DOCKER_IMAGE_REPO_TAG_NOT_FOUND'
}
