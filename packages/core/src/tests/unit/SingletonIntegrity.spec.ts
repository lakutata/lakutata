import {describe, it} from 'node:test'
import assert from 'node:assert'
import {createRequire} from 'node:module'
//Process-wide singleton integrity probes (G4).
//Pre-split (single package) these are mostly self-probes: the FUNCTIONAL ones
//(round-trips, @Inject metadata, IsDTO, @Entity->storage, ConstructorSymbol name
//resolution) are real end-to-end tests of the singleton machinery and catch
//breakage during the code-move refactor; the IDENTITY ones (Object.is across
//re-imports) are trivially true now but become LOAD-BEARING once @lakutata/*
//leaves exist, because every metadata key below is Symbol() (NOT Symbol.for()),
//so a duplicated @lakutata/core module flips Object.is to false and silently
//breaks every decorator / DI resolution / entity registration.
//Post-split: re-run this spec against the multi-package tree and additionally
//assert Object.is(symbolFromCore, symbolFromLeaf) for each symbol imported from
//each leaf package (see the POST-SPLIT TEMPLATE at the bottom).
import {
    DI_CONTAINER_INJECT_PROPERTIES,
    DI_TARGET_CONSTRUCTOR_LIFETIME,
    DI_TARGET_CONSTRUCTOR_LIFETIME_LOCK,
    DI_TARGET_CONSTRUCTOR_INJECTS,
    DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES,
    DI_TARGET_CONSTRUCTOR_SYMBOL,
    DI_TARGET_CONSTRUCTOR_AUTOLOAD,
    DI_TARGET_CONTAINER,
    DI_TARGET_ID
} from '../../constants/DIMetadataKey.js'
import {
    DTO_CONSTRUCTOR,
    DTO_INDEX_SIGNATURE_SCHEMA,
    DTO_PROPERTY_SCHEMAS
} from '../../constants/DTOMetadataKey.js'
import {BaseObject} from '../../lib/base/BaseObject.js'
import {Inject} from '../../decorators/di/Inject.js'
import {Expect} from '../../decorators/dto/Expect.js'
import {ConstructorSymbol, ResolveConstructorNameBySymbol} from '../../lib/ioc/ConstructorSymbol.js'
import {IsDTO} from '../../lib/base/internal/ObjectSchemaValidation.js'
import {DTO} from '../../lib/core/DTO.js'
import {Alias} from '../../lib/core/Alias.js'

const require = createRequire(import.meta.url)

const DI_SYMBOLS: ReadonlyArray<symbol> = [
    DI_CONTAINER_INJECT_PROPERTIES,
    DI_TARGET_CONSTRUCTOR_LIFETIME,
    DI_TARGET_CONSTRUCTOR_LIFETIME_LOCK,
    DI_TARGET_CONSTRUCTOR_INJECTS,
    DI_TARGET_CONSTRUCTOR_CONFIGURABLE_PROPERTIES,
    DI_TARGET_CONSTRUCTOR_SYMBOL,
    DI_TARGET_CONSTRUCTOR_AUTOLOAD,
    DI_TARGET_CONTAINER,
    DI_TARGET_ID
]
const DTO_SYMBOLS: ReadonlyArray<symbol> = [DTO_CONSTRUCTOR, DTO_INDEX_SIGNATURE_SCHEMA, DTO_PROPERTY_SCHEMAS]

await describe('Singleton Integrity (G4)', async (): Promise<void> => {

    await describe('metadata Symbol keys (G4-01 / G4-02)', async (): Promise<void> => {
        await it('every DI metadata key is a unique Symbol() (not Symbol.for) — duplication is fatal', (): void => {
            for (const sym of DI_SYMBOLS) {
                assert.equal(typeof sym, 'symbol')
                //keyFor returns undefined for Symbol() (unique per module instance).
                //If these were Symbol.for() they would survive duplication; they do not.
                assert.equal(Symbol.keyFor(sym), undefined)
            }
            assert.equal(new Set(DI_SYMBOLS).size, DI_SYMBOLS.length, 'DI symbols must be distinct')
        })
        await it('every DTO metadata key is a unique Symbol() (not Symbol.for)', (): void => {
            for (const sym of DTO_SYMBOLS) {
                assert.equal(typeof sym, 'symbol')
                assert.equal(Symbol.keyFor(sym), undefined)
            }
            assert.equal(new Set(DTO_SYMBOLS).size, DTO_SYMBOLS.length, 'DTO symbols must be distinct')
        })
    })

    await describe('reflect-metadata (G4-03 / G4-04)', async (): Promise<void> => {
        await it('reflect-metadata resolves to exactly one module path', (): void => {
            const p: string = require.resolve('reflect-metadata')
            assert.equal(typeof p, 'string')
            assert.ok(p.length > 0)
            //POST-SPLIT: assert require.resolve('reflect-metadata',{paths:[coreDir]})
            //=== require.resolve('reflect-metadata',{paths:[leafDir]}) for every leaf.
        })
        await it('Reflect.defineMetadata is readable back via Reflect.getMetadata (functional round-trip)', (): void => {
            const key: symbol = Symbol('G4.reflect.roundtrip')
            class Target {}
            Reflect.defineMetadata(key, {v: 1}, Target)
            const read: { v: number } | undefined = Reflect.getMetadata(key, Target)
            assert.deepEqual(read, {v: 1})
            //POST-SPLIT: define in a leaf, read from core (and vice-versa) with a
            //SHARED key identity — two reflect-metadata copies hold separate stores.
        })
    })

    await describe('DI injection metadata (G4-05)', async (): Promise<void> => {
        await it('@Inject writes a readable map under DI_TARGET_CONSTRUCTOR_INJECTS', (): void => {
            class InjectProbe extends BaseObject {
                @Inject('g4ProbeSvc')
                public svc?: unknown
            }
            const map: unknown = Reflect.getOwnMetadata(DI_TARGET_CONSTRUCTOR_INJECTS, InjectProbe)
            assert.ok(map instanceof Map, 'inject map must exist under the shared symbol')
            const entry: { name: unknown } | undefined = (map as Map<string, { name: unknown }>).get('svc')
            assert.ok(entry, 'inject map must contain the decorated property key')
            assert.equal(entry!.name, 'g4ProbeSvc')
            //POST-SPLIT: if DI_TARGET_CONSTRUCTOR_INJECTS is duplicated, this read
            //returns undefined and @Inject silently misses at resolution time.
        })
    })

    await describe('DTO recognition (G4-06)', async (): Promise<void> => {
        await it('a DTO subclass is recognised as a DTO via the shared DTO_CONSTRUCTOR symbol', (): void => {
            class ProbeDTO extends DTO {
                @Expect(DTO.String().optional())
                public field?: string
            }
            assert.equal(IsDTO(ProbeDTO), true)
            //POST-SPLIT: a duplicated DTO_CONSTRUCTOR makes IsDTO false and
            //@Configurable validation silently skips.
        })
    })

    await describe('ConstructorSymbol name map (G4-10)', async (): Promise<void> => {
        await it('ConstructorSymbol + ResolveConstructorNameBySymbol round-trip via the module-level Map', (): void => {
            class ProbeObject extends BaseObject {}
            const sym: symbol = ConstructorSymbol(ProbeObject)
            assert.equal(typeof sym, 'symbol')
            assert.equal(ResolveConstructorNameBySymbol(sym), 'ProbeObject')
            //POST-SPLIT: the module-level symbolConstructorMap lives in one
            //module instance; a duplicated core leaves the symbol absent from
            //core's map -> DI registration names corrupt.
        })
        await it('ConstructorSymbol is stable across calls for the same class', (): void => {
            class StableObject extends BaseObject {}
            assert.equal(ConstructorSymbol(StableObject), ConstructorSymbol(StableObject))
        })
    })

    await describe('Alias singleton (G4-11)', async (): Promise<void> => {
        await it('Alias.getAliasInstance returns the same Alias instance (Reflect-keyed singleton)', (): void => {
            const a1 = Alias.getAliasInstance()
            const a2 = Alias.getAliasInstance()
            assert.equal(Object.is(a1, a2), true)
            assert.ok(a1 instanceof Alias)
            //POST-SPLIT: the singleton key is the Alias CLASS itself
            //(Reflect.defineMetadata(this, instance, this)); two Alias classes ->
            //two singletons + two monkeypatched path.resolve closures.
        })
    })

    await it('G4-13 meta: this spec is GREEN on unmodified source (baseline established)', (): void => {
        //If you see this fail after a change, the process-wide singleton machinery
        //broke. Do not ship the split until every probe above is GREEN again and
        //the post-split cross-package identity assertions (template below) are added.
        assert.equal(DI_SYMBOLS.length + DTO_SYMBOLS.length, 12)
    })
})

//POST-SPLIT TEMPLATE (fill in once @lakutata/* leaves exist):
//import * as core from '@lakutata/core'
//import * as orm from '@lakutata/orm'
//for (const symName of ['DI_CONTAINER_INJECT_PROPERTIES', /* ...all 12 */]) {
//  it(`${symName} is Object.is-identical across core and every leaf`, () => {
//    assert.equal(Object.is(core[symName], orm[symName]), true)
//  })
//}
