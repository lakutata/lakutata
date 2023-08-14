import {Controller} from '../../lib/base/Controller.js'
import {Action} from '../../decorators/ControllerDecorators.js'

export class Test2Controller extends Controller {

    @Action({test2: true})
    public async testHello() {
        return `oh! this is test hello from ${this.className}`
    }

    async beforeAction(subject: Record<string, any>, actionName: string | symbol | number): Promise<boolean> {
        console.log(actionName, subject)
        return true
    }

    async afterAction(subject: Record<string, any>, actionName: string | symbol | number, actionResult: any): Promise<any> {
        console.log(subject, actionName, actionResult)
        return super.afterAction(subject, actionName, actionResult)
    }
}
