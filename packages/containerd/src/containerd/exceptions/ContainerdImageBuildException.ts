import {Exception} from '@lakutata/core'

/**
 * Containerd image build exception: BuildKit is not reachable, or the build failed
 */
export class ContainerdImageBuildException extends Exception {
    public errno: string | number = 'E_CONTAINERD_IMAGE_BUILD'
}
