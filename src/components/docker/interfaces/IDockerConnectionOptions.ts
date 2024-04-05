import {IKeyObject} from './IKeyObject.js'

/**
 * Docker connection options
 */
export interface IDockerConnectionOptions {
    socketPath?: string | undefined;
    host?: string | undefined;
    port?: number | string | undefined;
    username?: string | undefined;
    headers?: { [name: string]: string };
    ca?: string | string[] | Buffer | Buffer[] | undefined;
    cert?: string | string[] | Buffer | Buffer[] | undefined;
    key?: string | string[] | Buffer | Buffer[] | IKeyObject[] | undefined;
    protocol?: 'https' | 'http' | 'ssh' | undefined;
    timeout?: number | undefined;
    version?: string | undefined;
    sshAuthAgent?: string | undefined;
}
