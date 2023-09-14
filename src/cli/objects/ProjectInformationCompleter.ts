import {BaseObject, Transient} from '../../Lakutata'
import {ProjectInputInformationOptions} from '../options/ProjectInputInformationOptions'
import {ProjectType} from '../enums/ProjectType'
import inquirer, {QuestionCollection} from 'inquirer'
import {ProjectCompleteInformationOptions} from '../options/ProjectCompleteInformationOptions'
import {As} from '../../Helper'

/**
 * 项目信息完善器
 */
@Transient()
export class ProjectInformationCompleter extends BaseObject {
    /**
     * 完善项目信息
     * @param options
     */
    public async complete<T extends ProjectInputInformationOptions>(options: T): Promise<ProjectCompleteInformationOptions> {
        const projectQuestions: QuestionCollection[] = []
        if (!options.type) projectQuestions.push({
            name: 'type',
            type: 'list',
            choices: Object.values(ProjectType),
            default: ProjectType.plain,
            message: 'Please select the application type:'
        })
        if (!options.id) projectQuestions.push({
            name: 'id',
            type: 'input',
            message: 'Please enter the AppID:'
        })
        if (!options.name) projectQuestions.push({
            name: 'name',
            type: 'input',
            message: 'Please enter the AppName:'
        })
        if (!options.description) projectQuestions.push({
            name: 'description',
            type: 'input',
            message: 'Please enter the application description:'
        })
        if (!options.author) projectQuestions.push({
            name: 'author',
            type: 'input',
            message: 'Please enter the application author\'s name:'
        })
        if (!options.license) projectQuestions.push({
            name: 'license',
            type: 'input',
            default: 'ISC',
            message: 'Please enter the application\'s license:'
        })
        if (projectQuestions.length) {
            options = As<T>(await this.complete(Object.assign(options, await inquirer.prompt(projectQuestions))))
        }
        return As<ProjectCompleteInformationOptions>(options)
    }
}
