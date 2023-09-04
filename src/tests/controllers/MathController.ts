import {Accept, Action, Controller, Inject} from '../../Lakutata'
import {MathObject} from '../objects/MathObject'
import {MathAddDTO} from '../dtos/MathAddDTO'

export class MathController extends Controller {

    @Inject('math')
    protected readonly math: MathObject

    /**
     * 初始化函数
     * @protected
     */
    protected async init(): Promise<void> {
        this.log.info('%s initialized, user %s is operating me', this.className, this.user?.username)
    }

    /**
     * 销毁函数
     * @protected
     */
    protected async destroy(): Promise<void> {
        this.log.info('%s finished its work, destroy', this.className)
    }

    /**
     * 加法动作
     * @param inp
     */
    @Action({ctrl: 'math', act: 'add'}, {name: 'add', operation: 'execute'})
    @Accept(MathAddDTO)
    public async add(inp: MathAddDTO): Promise<number> {
        return await this.math.add(inp.a, inp.b!)
    }

}
