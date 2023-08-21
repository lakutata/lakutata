import {ModuleOptions} from '../../../../options/ModuleOptions'
import {TestComponent} from '../../../components/TestComponent'
import {SubTestComponent} from '../../../components/SubTestComponent'

const options: ModuleOptions<any> = {
    entries: {
        tt11: {class: TestComponent, greet: 'subModule'}
        // stc: {class: SubTestComponent}
    },
    bootstrap: [
        async () => {
            console.log('TestModule1 bootstrap')
        },
        'tt11'
        // 'stc'
    ]
}

export const objectConfig = options

export async function functionConfig() {
    const options: ModuleOptions<any> = {
        entries: {
            tt11: {greet: 'subModule1111111'},
            // stc: {class: (await import('../../../components/SubTestComponent.js')).SubTestComponent}
            stc: {class: SubTestComponent}
        },
        bootstrap: [
            async () => {
                console.log('TestModule1 bootstrap')
            },
            'tt11',
            'stc'
        ]
    }
    return options
}
