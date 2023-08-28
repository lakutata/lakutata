import {DataSourceOptions} from 'typeorm'
import {IAuthFileStoreOptions} from '../interfaces/auth/IAuthFileStoreOptions'

export type AuthStoreOptions = IAuthFileStoreOptions | DataSourceOptions
