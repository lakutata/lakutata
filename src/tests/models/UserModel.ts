import {Configurable, IUser, Model, Scoped} from '../../Lakutata'

@Scoped()
export class UserModel extends Model implements IUser {

    @Configurable()
    public id: string

    @Configurable()
    public username: string

    /**
     * 初始化函数
     * @protected
     */
    protected async init(): Promise<void> {
        this.log.info('I\'m a user, my uid is %s and my username is %s', this.id, this.username)
    }
}
