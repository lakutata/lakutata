import {Controller} from 'lakutata/com/entrypoint'
import {ServiceAction} from 'lakutata/decorator/ctrl'
import {GreetDTO} from '../dtos/GreetDTO.js'

export class ExampleController extends Controller {

    /**
     * Invoked by the renderer: window.lakutata.invoke({cmd: 'greet', name: 'you'})
     * @param input
     */
    @ServiceAction({cmd: 'greet'}, GreetDTO)
    public async greet(input: GreetDTO): Promise<{ message: string }> {
        return {message: `Hello, ${input.name}!`}
    }
}
