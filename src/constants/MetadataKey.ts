import 'reflect-metadata'

export const DTO_CLASS: Symbol = Symbol('LAKUTATA.DTO.CLASS')
export const DTO_SCHEMAS: Symbol = Symbol('LAKUTATA.DTO.SCHEMAS')
export const DTO_INDEX_SIGNATURE_SCHEMAS: Symbol = Symbol('LAKUTATA.DTO.INDEX.SIGNATURE.SCHEMAS')

export const DI_CONTAINER_CREATOR_CONSTRUCTOR: Symbol = Symbol('LAKUTATA.DI.CONTAINER.CREATOR.CONSTRUCTOR')
export const DI_CONTAINER_INJECT_PROPERTIES: Symbol = Symbol('LAKUTATA.DI.CONTAINER.INJECT.PROPERTIES')
export const DI_CONTAINER_INJECT_IS_MODULE_GETTER_KEY: Symbol = Symbol('LAKUTATA.DI.CONTAINER.INJECT.IS.MODULE.GETTER.KEY')
export const DI_CONTAINER_INJECT_IS_MODULE_GETTER: Symbol = Symbol('LAKUTATA.DI.CONTAINER.INJECT.IS.MODULE.GETTER')
export const DI_CONTAINER_SPECIAL_INJECT_APP_GETTER_KEY: Symbol = Symbol('LAKUTATA.DI.CONTAINER.SPECIAL.INJECT.APP.GETTER.KEY')
export const DI_CONTAINER_SPECIAL_INJECT_APP_GETTER: Symbol = Symbol('LAKUTATA.DI.CONTAINER.SPECIAL.INJECT.APP.GETTER')
export const DI_CONTAINER_SPECIAL_INJECT_MODULE_GETTER: Symbol = Symbol('LAKUTATA.DI.CONTAINER.SPECIAL.INJECT.MODULE.GETTER')
export const DI_TARGET_CONSTRUCTOR_LIFETIME: Symbol = Symbol('LAKUTATA.DI.TARGET.CONSTRUCTOR.LIFETIME')
export const DI_TARGET_CONSTRUCTOR_LIFETIME_LOCK: Symbol = Symbol('LAKUTATA.DI.TARGET.CONSTRUCTOR.LIFETIME.LOCK')
export const DI_TARGET_CONSTRUCTOR_INJECTS: Symbol = Symbol('LAKUTATA.DI.TARGET.CONSTRUCTOR.INJECTS')
export const DI_TARGET_CONSTRUCTOR_SPECIAL_INJECTS: Symbol = Symbol('LAKUTATA.DI.TARGET.CONSTRUCTOR.SPECIAL.INJECTS')
export const DI_TARGET_CONSTRUCTOR_CONFIGURABLE_ITEMS: Symbol = Symbol('LAKUTATA.DI.TARGET.CONSTRUCTOR.CONFIGURABLE.ITEMS')
export const DI_TARGET_CONSTRUCTOR_CONFIGURABLE_OPTIONS: Symbol = Symbol('LAKUTATA.DI.TARGET.CONSTRUCTOR.CONFIGURABLE.OPTIONS')
export const DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTY: Symbol = Symbol('LAKUTATA.DI.TARGET.CONSTRUCTOR.CONFIGURABLE.PROPERTY')
export const DI_TARGET_CONSTRUCTOR_CONFIGURABLE_OBJECT_NAME: Symbol = Symbol('LAKUTATA.DI.TARGET.CONSTRUCTOR.CONFIGURABLE.OBJECT.NAME')
export const DI_TARGET_CONSTRUCTOR_CONFIGURABLE_OBJECT: Symbol = Symbol('LAKUTATA.DI.TARGET.CONSTRUCTOR.CONFIGURABLE.OBJECT')
export const DI_TARGET_INSTANCE_CONFIGURABLE_OBJECT: Symbol = Symbol('LAKUTATA.DI.TARGET.INSTANCE.CONFIGURABLE.OBJECT')
export const DI_TARGET_CONSTRUCTOR_FINGERPRINT: Symbol = Symbol('LAKUTATA.DI.TARGET.CONSTRUCTOR.FINGERPRINT')

export const OBJECT_INIT_MARK: Symbol = Symbol('LAKUTATA.OBJECT.INIT.MARK')

export const CONTROLLER_CONSTRUCTOR_MARK: Symbol = Symbol('LAKUTATA.CONTROLLER.CONSTRUCTOR.MARK')
export const CONTROLLER_ACTION_MAP: Symbol = Symbol('LAKUTATA.CONTROLLER.ACTION.MAP')
export const CONTROLLER_PATTERN_MANAGER: Symbol = Symbol('LAKUTATA.CONTROLLER.PATTERN.MANAGER')
export const CONTROLLER_AUTH_MAP: Symbol = Symbol('LAKUTATA.CONTROLLER.AUTH.MAP')

export const MODEL_PROPERTY_MAP: Symbol = Symbol('LAKUTATA.MODEL.PROPERTY.MAP')
