import {BootstrapOption, ModuleOptions} from '../../../options/ModuleOptions.js'
import {LoadObjectOptions, OBJECT_ID} from '../../../options/LoadObjectOptions.js'
import {Module} from '../../core/Module.js'
import {BaseObject} from '../BaseObject.js'
import {AnonymousObject} from '../../../options/ModuleLoadObjectsOptions.js'
import {LoadNamedObjectOptions} from '../../../options/LoadNamedObjectOptions.js'
import {OverridableNamedObjectOptions} from '../../../options/OverridableNamedObjectOptions.js'
import {OverridableObjectOptions} from '../../../options/OverridableObjectOptions.js'
import {
    OverridableObjectTargetConfigNotFoundException
} from '../../../exceptions/di/OverridableObjectTargetConfigNotFoundException.js'
import {As} from '../../functions/As.js'

export class ModuleConfigLoader<ModuleInstance extends Module = Module> {

    protected $presetLoadOptions: (LoadObjectOptions | typeof BaseObject | string)[] = []

    protected $loadOptions: (LoadObjectOptions | typeof BaseObject | string)[] = []

    protected $bootstrap: BootstrapOption[] = []

    constructor(moduleOptions: ModuleOptions, presetLoadOptions: (LoadObjectOptions | typeof BaseObject | string)[] = []) {
        this.$presetLoadOptions = presetLoadOptions
        this.$bootstrap = moduleOptions.bootstrap ? moduleOptions.bootstrap : []
        //Process anonymous objects
        moduleOptions.objects?.anonymous?.forEach((anonymousObject: AnonymousObject) => this.$loadOptions.push(anonymousObject))
        //Process named objects
        if (moduleOptions.objects && moduleOptions.objects.named) {
            const namedObjects: LoadNamedObjectOptions = moduleOptions.objects.named
            Object.keys(namedObjects).forEach((id: string) => this.$loadOptions.push({
                ...namedObjects[id],
                [OBJECT_ID]: id
            }))
        }
        //Process component objects
        this.processOverridableNamedObjectOptions(moduleOptions.components)
        //Process provider objects
        this.processOverridableNamedObjectOptions(moduleOptions.providers)
        //Process module objects
        this.processOverridableNamedObjectOptions(moduleOptions.modules)
    }

    /**
     * Process overridable named object options
     * @param options
     * @protected
     */
    protected processOverridableNamedObjectOptions(options?: OverridableNamedObjectOptions): void {
        if (!options) return
        Object.keys(options).forEach((id: string) => {
            const overridableObjectOptions: OverridableObjectOptions = options[id]
            overridableObjectOptions[OBJECT_ID] = id
            if (overridableObjectOptions.class) return this.$loadOptions.push(As<LoadObjectOptions>(overridableObjectOptions))
            for (const loadOptions of this.$presetLoadOptions) {
                if (typeof loadOptions === 'string') continue
                if (loadOptions instanceof BaseObject) continue
                if (overridableObjectOptions[OBJECT_ID] === loadOptions[OBJECT_ID]) {
                    return this.$loadOptions.push(Object.assign({}, loadOptions, overridableObjectOptions))
                }
            }
            throw new OverridableObjectTargetConfigNotFoundException('No applicable configuration target found')
        })
    }

    /**
     * Load options for container.load()
     */
    public get loadOptions(): (LoadObjectOptions | typeof BaseObject | string)[] {
        return this.$loadOptions
    }

    /**
     * Load bootstrap for module
     */
    public get bootstrap(): BootstrapOption[] {
        return this.$bootstrap
    }
}
