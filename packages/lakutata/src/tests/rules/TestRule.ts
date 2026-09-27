import {AccessControlRule} from '@lakutata/entrypoint'
import {Application} from '../../exports/Lakutata.js'
import {Inject} from '@lakutata/core/decorator/di'
import {ContextType} from '@lakutata/entrypoint'

export class TestRule extends AccessControlRule {
    public get supportContextTypes(): ContextType[] {
        return [ContextType.HTTP]
    }

    @Inject(Application)
    protected readonly app: Application

    public async rule(): Promise<boolean> {
        console.log('test rule, from rule object')
        // console.log(this.context)
        this.context.aaa = {
            ho: '!!!!',
            hi: 1234,
            fk: true
        }
        // return true
        return false
    }
}