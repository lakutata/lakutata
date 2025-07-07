import bcrypt from 'bcryptjs'
import {Provider} from '../lib/core/Provider.js'
import {Configurable} from '../decorators/di/Configurable.js'
import {DTO} from '../lib/core/DTO.js'

export class PasswordHash extends Provider {

    #salt: string

    /**
     * Salt rounds
     */
    @Configurable(DTO.Number().integer().positive().optional().default(10))
    public readonly saltRounds: number

    /**
     * Salt getter
     */
    public get salt(): string {
        return this.#salt
    }

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        this.#salt = await bcrypt.genSalt(this.saltRounds)
    }

    /**
     * Generate password hash
     * @param password
     */
    public async hash(password: string): Promise<string> {
        return await bcrypt.hash(password, this.salt)
    }

    /**
     * Validate password hash
     * @param password
     * @param hash
     */
    public async validate(password: string, hash: string): Promise<boolean> {
        return await bcrypt.compare(password, hash)
    }

}