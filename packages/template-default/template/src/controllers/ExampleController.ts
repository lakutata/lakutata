import {Controller} from 'lakutata/com/entrypoint'
import {CLIAction, GET} from 'lakutata/decorator/ctrl'
import {GreetDTO} from '../dtos/GreetDTO.js'

export class ExampleController extends Controller {

    /**
     * GET /example?name=you, or the command "greet --name you" with a CLI adapter
     * @param input
     */
    @GET('/example', GreetDTO)
    @CLIAction('greet', GreetDTO)
    public async greet(input: GreetDTO): Promise<{ message: string }> {
        return {message: `Hello, ${input.name}!`}
    }
}
