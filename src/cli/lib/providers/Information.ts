import {Provider} from '../../../lib/core/Provider.js'
import ansis from 'ansis'
import {Configurable} from '../../../decorators/di/Configurable.js'
import {DTO} from '../../../lib/core/DTO.js'
import {dirname, resolve} from 'node:path'
import {readFile} from 'node:fs/promises'
import {DevNull} from '../../../lib/helpers/DevNull.js'
import {packageDirectory} from 'pkg-dir'
import {Time} from '../../../lib/core/Time.js'

export class Information extends Provider {

    @Configurable(DTO.String().required())
    protected readonly name: string

    @Configurable(DTO.String().required())
    protected readonly version: string

    @Configurable(DTO.String().required())
    protected readonly description: string

    @Configurable(DTO.String().required())
    protected readonly license: string

    @Configurable(DTO.String().required())
    protected readonly currentDirectory: string

    @Configurable(DTO.String().required())
    protected readonly workingDirectory: string

    protected installPath: string

    protected projectRoot: string | null

    /**
     * Initializer
     * @protected
     */
    protected async init(): Promise<void> {
        const installPath: string | undefined = await packageDirectory({cwd: this.currentDirectory})
        this.installPath = installPath ? installPath : 'UNKNOWN'

        const projectRoot: string | null = await this.findProjectRoot(this.workingDirectory)
        if (projectRoot) {
            const packageJsonPath: string = resolve(projectRoot, './package.json')
            try {
                const packageJson = JSON.parse(await readFile(packageJsonPath, {encoding: 'utf-8'}))
                const dependenciesKeyRegExp: RegExp = new RegExp('dependencies'.toUpperCase())
                Object.keys(packageJson).forEach((key: string): void => {
                    if (dependenciesKeyRegExp.test(key.toUpperCase())) {
                        Object.keys(packageJson[key]).forEach((dependencyName: string) => {
                            if (dependencyName === this.name) {
                                this.projectRoot = projectRoot
                            }
                        })
                    }
                })
            } catch (e) {
                DevNull(e)
            }
        }
    }

    /**
     * To find the root path of the project where the working directory is located
     * @param path
     * @private
     */
    private async findProjectRoot(path: string): Promise<string | null> {
        let localRootPath: string | null = null
        while (true) {
            const _localRootPath: string | null = await this.findLocalRoot(localRootPath ? dirname(localRootPath) : path)
            if (!_localRootPath)
                break
            else
                localRootPath = _localRootPath
        }
        return localRootPath
    }

    /**
     * To locate the root path containing the package.json file
     * @param path
     * @private
     */
    private async findLocalRoot(path: string): Promise<string | null> {
        try {
            const dir: string | undefined = await packageDirectory({cwd: path})
            return dir ? dir : null
        } catch (e) {
            return null
        }
    }

    /**
     * Convert string first char to upper case
     * @param str
     * @private
     */
    private stringFirstCharUpperCase(str: string): string {
        return str.charAt(0).toUpperCase() + str.slice(1)
    }

    /**
     * Format framework ascii logo
     * @protected
     */
    protected formatFrameworkAsciiLogo(): string {
        const asciiLogo: string = '' +
            ' _                               _             _            \n' +
            '| |               _             | |           | |           \n' +
            '| |        __ _  | | _   _   _  | |_    __ _  | |_    __ _  \n' +
            '| |       / _` | | |/ / | | | | | __|  / _` | | __|  / _` | \n' +
            '| |____  | (_| | |   <  | |_| | \\ |_  | (_| | \\ |_  | (_| | \n' +
            '|______|  \\__,_| |_|\\_\\  \\__,_|  \\__|  \\__,_|  \\__|  \\__,_| \n' +
            '                                                            '
        return `${ansis.yellow(asciiLogo)}`
    }

    /**
     * Format framework description
     * @protected
     */
    protected formatFrameworkDescription(): string {
        return `${ansis.bold(this.stringFirstCharUpperCase(this.name))} is ${ansis.blue(this.description)}`
    }

    /**
     * Format version text
     * @protected
     */
    protected formatVersionText(): string {
        return `The current version is ${ansis.bold(this.version)}`
    }

    /**
     * Format framework installation path
     * @protected
     */
    protected formatInstallationPath(): string {
        return `The installation directory path is ${ansis.underline(this.getInstallPath())}`
    }

    /**
     * Format current running level
     * @protected
     */
    protected formatRunningLevel(): string {
        return `Currently running at ${ansis.bold(this.getLevel())} level`
    }

    /**
     * Format license
     * @protected
     */
    protected formatLicense(): string {
        return `${this.stringFirstCharUpperCase(this.name)} is ${ansis.cyan(this.license)} licensed.`
    }

    /**
     * Format copyright
     * @protected
     */
    protected formatCopyright(): string {
        return `Copyright (c) ${new Time().format('YYYY')} ${ansis.bold(this.stringFirstCharUpperCase(this.name))}. All rights reserved.`
    }

    /**
     * To retrieve the hierarchy level of the project containing the package under the current command
     */
    public getLevel(): 'PROJECT' | 'GLOBAL' {
        return this.projectRoot ? 'PROJECT' : 'GLOBAL'
    }

    /**
     * Locate the root path of the project
     */
    public getRoot(): string | null {
        return this.projectRoot
    }

    /**
     * Locate the installation directory
     */
    public getInstallPath(): string {
        return this.installPath
    }

    /**
     * Retrieve the framework installation version at the project level
     */
    public async getProjectLevelInstalledFrameworkVersion(): Promise<string | null> {
        const projectRoot: string | null = this.getRoot()
        if (projectRoot) {
            try {
                const version: string = JSON.parse(await readFile(resolve(projectRoot, './node_modules', `./${this.name}/package.json`), {encoding: 'utf-8'})).version
                return version ? version : null
            } catch (e) {
                return null
            }
        }
        return null
    }

    /**
     * Print infos
     */
    public async print(): Promise<void> {
        const texts: string[] = [
            this.formatFrameworkAsciiLogo(),
            this.formatFrameworkDescription(),
            this.formatVersionText(),
            this.formatInstallationPath(),
            this.formatRunningLevel(),
            this.formatLicense(),
            this.formatCopyright()
        ]
        console.info(texts.join('\n'))
    }
}
