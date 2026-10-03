import {Controller, type ServiceContext} from 'lakutata/com/entrypoint'
import {NotifyRenderer} from 'lakutata/adapter/electron'
import {ServiceAction} from 'lakutata/decorator/ctrl'
import {GreetDTO} from '../dtos/GreetDTO.js'
//@if i18n
import {Inject} from 'lakutata/decorator/di'
import {Translator} from 'lakutata/com/i18n'
//@end

export class ExampleController extends Controller {
    //@if i18n

    /**
     * The messages of the language of the request
     */
    @Inject(Translator)
    protected readonly i18n: Translator
    //@end

    /**
     * Invoked by the renderer: window.ipc.invoke({cmd: 'greet', name: 'you'})
     * @param input
     */
    @ServiceAction({cmd: 'greet'}, GreetDTO)
    public async greet(input: GreetDTO): Promise<{ message: string }> {
        //An event pushed to the renderer of the request (window.ipc.on('greeted', listener)); BroadcastToRenderers pushes
        //one to every window
        NotifyRenderer(this.context as ServiceContext, 'greeted', input.name)
        //@if i18n
        return {message: this.i18n.t('greeting.hello', {name: input.name})}
        //@else
        return {message: `Hello, ${input.name}!`}
        //@end
    }
}
