import {Component} from '../../lib/core/Component.js'
import {Singleton} from '../../decorators/di/Lifetime.js'
import {DockerImage} from './lib/DockerImage.js'
import {DockerContainer} from './lib/DockerContainer.js'
import {DockerNetwork} from './lib/DockerNetwork.js'

@Singleton()
export class Docker extends Component {

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        await Promise.all([
            new Promise((resolve, reject) => this.container.register(DockerImage).then(resolve).catch(reject)),
            new Promise((resolve, reject) => this.container.register(DockerContainer).then(resolve).catch(reject)),
            new Promise((resolve, reject) => this.container.register(DockerNetwork).then(resolve).catch(reject))
        ])
    }

    /**
     * Destroyer
     * @protected
     */
    protected async destroy(): Promise<void> {
        //TODO
    }

    /** Docker Image Operations **/

    /**
     * List docker images
     */
    public async listImages() {
        //TODO
        throw new Error('not implemented')
    }

    /**
     * Pull docker image from repository
     */
    public async pullImage() {
        //TODO
        throw new Error('not implemented')
    }

    /**
     * Build docker image
     */
    public async buildImage() {
        //TODO
        throw new Error('not implemented')
    }

    /**
     * Import docker image from .tar file
     */
    public async importImage() {
        //TODO
        throw new Error('not implemented')
    }

    /**
     * Get docker image
     */
    public async getImage() {
        //TODO
        throw new Error('not implemented')
    }

    /**
     * Search docker images
     */
    public async searchImage() {
        //TODO
        throw new Error('not implemented')
    }

    /** Docker Container Operations **/

    /**
     * List docker containers
     */
    public async listContainers() {
        //TODO
        throw new Error('not implemented')
    }

    /**
     * Get docker container
     */
    public async getContainer() {
        //TODO
        throw new Error('not implemented')
    }

    /** Docker Network Operations **/

    /**
     * Create docker network
     */
    public async createNetwork() {
        //TODO
        throw new Error('not implemented')
    }

    /**
     * Remove docker network
     */
    public async removeNetwork() {
        //TODO
        throw new Error('not implemented')
    }

    /**
     * List docker networks
     */
    public async listNetworks() {
        //TODO
        throw new Error('not implemented')
    }

    /**
     * Get docker network info
     */
    public async getNetwork() {
        //TODO
        throw new Error('not implemented')
    }
}
