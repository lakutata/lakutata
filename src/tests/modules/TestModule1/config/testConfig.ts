import {ModuleOptions} from '../../../../options/ModuleOptions.js'
import {TestComponent} from '../../../components/TestComponent.js'
import {SubTestComponent} from '../../../components/SubTestComponent.js'

const options: ModuleOptions<any> = {
    entries: {
        tt11: {class: TestComponent, config: {greet: 'subModule'}},
        // stc: {class: SubTestComponent}
    },
    bootstrap: [
        async () => {
            console.log('TestModule1 bootstrap')
        },
        'tt11',
        // 'stc'
    ]
}

export const objectConfig = options

export function functionConfig(){
    return options
}