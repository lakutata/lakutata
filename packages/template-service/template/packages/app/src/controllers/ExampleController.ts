import {Controller} from 'lakutata/com/entrypoint'
import {GET, Prefix} from 'lakutata/decorator/ctrl'
import {GreetDTO} from '../dtos/GreetDTO.js'
//@if i18n
import {Inject} from 'lakutata/decorator/di'
import {Translator} from 'lakutata/com/i18n'
//@end

@Prefix({route: '/example'})
export class ExampleController extends Controller {
    //@if i18n

    /**
     * The messages of the language of the request
     */
    @Inject(Translator)
    protected readonly i18n: Translator
    //@end

    /**
     * GET /example?name=you
     * @param input
     */
    @GET('/', GreetDTO)
    public async greet(input: GreetDTO): Promise<{ message: string }> {
        //@if i18n
        return {message: this.i18n.t('greeting.hello', {name: input.name})}
        //@else
        return {message: `Hello, ${input.name}!`}
        //@end
    }
}
