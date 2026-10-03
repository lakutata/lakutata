import 'reflect-metadata'

/**
 * Core
 */
export {Exception, ExceptionParams} from '../lib/foundation/Exception.js'
export {DTO} from '../lib/dto/DTO.js'
export {Container} from '../lib/core/Container.js'
export {BaseObject} from '../lib/base/BaseObject.js'
export {Provider} from '../lib/core/Provider.js'
export {Component} from '../lib/core/Component.js'
export {Module} from '../lib/core/Module.js'
export {Application} from '../lib/app/Application.js'
export {type ApplicationExitReason} from '../types/ApplicationExitReason.js'

/**
 * Validation types
 */
export {type AnySchema} from '../lib/validation/interfaces/AnySchema.js'
export {type ArraySchema} from '../lib/validation/interfaces/ArraySchema.js'
export {type BooleanSchema} from '../lib/validation/interfaces/BooleanSchema.js'
export {type BinarySchema} from '../lib/validation/interfaces/BinarySchema.js'
export {type DateSchema} from '../lib/validation/interfaces/DateSchema.js'
export {type FunctionSchema} from '../lib/validation/interfaces/FunctionSchema.js'
export {type NumberSchema} from '../lib/validation/interfaces/NumberSchema.js'
export {type ObjectSchema} from '../lib/validation/interfaces/ObjectSchema.js'
export {type StringSchema} from '../lib/validation/interfaces/StringSchema.js'
export {type SymbolSchema} from '../lib/validation/interfaces/SymbolSchema.js'
export {type AlternativesSchema} from '../lib/validation/interfaces/AlternativesSchema.js'
export {type LinkSchema} from '../lib/validation/interfaces/LinkSchema.js'
export {type Schema} from '../lib/validation/types/Schema.js'
export {type CronOptions} from '../types/CronOptions.js'
export {type SchemaFunction} from '../lib/validation/types/SchemaFunction.js'
export {type ValidationOptions} from '../lib/validation/interfaces/ValidationOptions.js'
export {CurrentValidationLanguage, RunInValidationLanguage} from '../lib/validation/ValidationLanguage.js'
export {IsPackaged, ResourcesPath} from '../lib/foundation/Packaging.js'
export {BUILT_IN_VALIDATION_LANGUAGES, BuiltInValidationLanguage, DefaultValidationMessages, LoadValidationMessages, RegisterValidationMessages, ValidationLanguages} from '../lib/validation/ValidationMessages.js'
export {type SchemaLike} from '../lib/validation/types/SchemaLike.js'
export {type NoNestedArrays} from '../lib/validation/types/NoNestedArrays.js'
export {type Primitives} from '../lib/validation/types/Primitives.js'
export {type SchemaLikeWithoutArray} from '../lib/validation/types/SchemaLikeWithoutArray.js'
export {type UnwrapSchemaLikeWithoutArray} from '../lib/validation/types/UnwrapSchemaLikeWithoutArray.js'

export {type CustomValidator} from '../lib/validation/types/CustomValidator.js'
export {type ReferenceOptions} from '../lib/validation/interfaces/ReferenceOptions.js'
export {type Reference} from '../lib/validation/interfaces/Reference.js'
export {type BigIntSchema} from '../lib/validation/interfaces/BigIntSchema.js'


/**
 * Options
 */
export {ApplicationOptions} from '../options/ApplicationOptions.js'
export {LoadAnonymousObjectOptions} from '../options/LoadAnonymousObjectOptions.js'
export {LoadNamedObjectOptions} from '../options/LoadNamedObjectOptions.js'
export {LoadObjectOptions} from '../options/LoadObjectOptions.js'
export {ModuleLoadObjectsOptions} from '../options/ModuleLoadObjectsOptions.js'
export {ModuleOptions} from '../options/ModuleOptions.js'
export {OverridableNamedObjectOptions} from '../options/OverridableNamedObjectOptions.js'
export {OverridableObjectOptions} from '../options/OverridableObjectOptions.js'

/**
 * Exceptions
 */
export {AliasExistsException} from '../exceptions/alias/AliasExistsException.js'
export {AliasNotFoundException} from '../exceptions/alias/AliasNotFoundException.js'
export {InvalidAliasNameException} from '../exceptions/alias/InvalidAliasNameException.js'
export {DependencyInjectionException} from '../exceptions/di/DependencyInjectionException.js'
export {LifetimeLockedException} from '../exceptions/di/LifetimeLockedException.js'
export {
    OverridableObjectTargetConfigNotFoundException
} from '../exceptions/di/OverridableObjectTargetConfigNotFoundException.js'
export {InvalidObjectOptionsException} from '../exceptions/di/InvalidObjectOptionsException.js'
export {InvalidMethodAcceptException} from '../exceptions/dto/InvalidMethodAcceptException.js'
export {InvalidMethodReturnException} from '../exceptions/dto/InvalidMethodReturnException.js'
export {InvalidValueException} from '../exceptions/dto/InvalidValueException.js'
export {DestroyRuntimeContainerException} from '../exceptions/DestroyRuntimeContainerException.js'
export {InvalidActionPatternDepthException} from '../exceptions/InvalidActionPatternDepthException.js'
export {InvalidAssistantFunctionTypeException} from '../exceptions/InvalidAssistantFunctionTypeException.js'
export {InvalidObjectTypeException} from '../exceptions/InvalidObjectTypeException.js'
export {MethodNotFoundException} from '../exceptions/MethodNotFoundException.js'
export {ObjectDestroyedException} from '../exceptions/ObjectDestroyedException.js'

/**
 * Types
 */
export * from '../types/ActionPattern.js'
export * from '../types/JSONSchema.js'
export * from '../types/ClassDecorator.js'
export * from '../types/MethodDecorator.js'
export * from '../types/ParameterDecorator.js'
export * from '../types/PropertyDecorator.js'
export * from '../types/ObjectOptions.js'
export * from '../types/ProviderOptions.js'
export * from '../types/ComponentOptions.js'
export * from '../types/ModuleOptions.js'

/**
 * Interfaces
 */
export * from '../interfaces/IBaseObjectConstructor.js'
export * from '../interfaces/ILogger.js'
export * from '../interfaces/IConstructor.js'
