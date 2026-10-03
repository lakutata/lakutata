import {Controller, Entrypoint, type ServiceContext} from 'lakutata/com/entrypoint'
import {ServiceAction} from 'lakutata/decorator/ctrl'
import {Inject} from 'lakutata/decorator/di'
import {GreetDTO} from '../dtos/GreetDTO.js'
//@if i18n
import {Translator} from 'lakutata/com/i18n'
//@end

export class ExampleController extends Controller {

    /**
     * Pushes the events to the clients: the windows (window.ipc.on), the tools in development (GET /events)
     */
    @Inject('entrypoint')
    protected readonly entrypoint: Entrypoint
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
        //An event pushed to the client of the request (window.ipc.on('greeted', listener)), whose id may be kept to push
        //it events later; this.entrypoint.broadcast pushes one to every client
        const clientId: string | undefined = (this.context as ServiceContext).clientId
        if (clientId) this.entrypoint.notify(clientId, 'greeted', input.name)
        //@if i18n
        return {message: this.i18n.t('greeting.hello', {name: input.name})}
        //@else
        return {message: `Hello, ${input.name}!`}
        //@end
    }
}
