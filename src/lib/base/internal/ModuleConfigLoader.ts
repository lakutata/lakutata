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
import {GetObjectType, ObjectType} from './ObjectType.js'
import {InvalidObjectTypeException} from '../../../exceptions/InvalidObjectTypeException.js'
import {IBaseObjectConstructor} from '../../../interfaces/IBaseObjectConstructor.js'
import {Controller} from '../../core/Controller.js'
import {ArrayToSet} from '../../functions/ArrayToSet.js'
import {SetToArray} from '../../functions/SetToArray.js'

export class ModuleConfigLoader {

    protected $presetLoadOptionsSet: Set<LoadObjectOptions | typeof BaseObject | string> = new Set()

    protected $loadOptions: (LoadObjectOptions | typeof BaseObject | string)[] = []

    protected $bootstrap: BootstrapOption[] = []

    constructor(moduleOptions: ModuleOptions, presetLoadOptions: (LoadObjectOptions | typeof BaseObject | string)[] = []) {
        this.$presetLoadOptionsSet = ArrayToSet(presetLoadOptions)
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
        //Process controllers
        if (moduleOptions.controllers) {
            moduleOptions.controllers.forEach((controllerConstructor: IBaseObjectConstructor<Controller>) => {
                //TODO 加载controller
                this.loadOptions.push(controllerConstructor)
            })
        }
        //Process component objects
        this.processOverridableNamedObjectOptions(ObjectType.Component, moduleOptions.components)
        //Process provider objects
        this.processOverridableNamedObjectOptions(ObjectType.Provider, moduleOptions.providers)
        //Process module objects
        this.processOverridableNamedObjectOptions(ObjectType.Module, moduleOptions.modules)
    }

    /**
     * Validate constructor's object type
     * @param expectObjectType
     * @param target
     * @protected
     */
    protected validateObjectType<ClassConstructor extends IBaseObjectConstructor>(expectObjectType: ObjectType, target: ClassConstructor): ClassConstructor {
        if (GetObjectType(target) !== expectObjectType) throw new InvalidObjectTypeException('{0} configuration only accepts object declarations of {1} types', [expectObjectType, expectObjectType.toLowerCase()])
        return target
    }

    /**
     * Process overridable named object options
     * @param objectType
     * @param options
     * @protected
     */
    protected processOverridableNamedObjectOptions(objectType: ObjectType, options?: OverridableNamedObjectOptions): void {
        if (!options) return
        Object.keys(options).forEach((id: string): void => {
            const overridableObjectOptions: OverridableObjectOptions = options[id]
            overridableObjectOptions[OBJECT_ID] = id
            if (overridableObjectOptions.class) {
                overridableObjectOptions.class = this.validateObjectType(objectType, overridableObjectOptions.class)
                return this.$loadOptions.push(As<LoadObjectOptions>(overridableObjectOptions)) ? void (0) : void (0)
            }
            for (const loadOptions of this.$presetLoadOptionsSet) {
                if (typeof loadOptions === 'string') continue
                if (loadOptions instanceof BaseObject) continue
                if (overridableObjectOptions[OBJECT_ID] === loadOptions[OBJECT_ID]) {
                    this.$loadOptions.push(Object.assign({}, loadOptions, overridableObjectOptions))
                    return this.$presetLoadOptionsSet.delete(loadOptions) ? void (0) : void (0)
                }
            }
            throw new OverridableObjectTargetConfigNotFoundException('No applicable configuration target found')
        })
    }

    /**
     * Load options for container.load()
     */
    public get loadOptions(): (LoadObjectOptions | typeof BaseObject | string)[] {
        return [...this.$loadOptions, ...SetToArray(this.$presetLoadOptionsSet)]
    }

    /**
     * Load bootstrap for module
     */
    public get bootstrap(): BootstrapOption[] {
        return this.$bootstrap
    }
}
