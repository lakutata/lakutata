import {AccessControlRule} from '../../components/entrypoint/lib/AccessControlRule.js'
import {Application} from '../../lib/core/Application.js'
import {Inject} from '../../decorators/di/Inject.js'
import {ContextType} from '../../lib/base/Context.js'

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