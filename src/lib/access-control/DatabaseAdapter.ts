import {FilteredAdapter, Helper, Model} from 'casbin'
import {DataSource, DataSourceOptions, EntitySchema, QueryRunner, Repository} from 'typeorm'
import {EntitySchemaColumnOptions} from 'typeorm/entity-schema/EntitySchemaColumnOptions'
import {RuleEntity} from './RuleEntity'

export class DatabaseAdapter implements FilteredAdapter {

    protected readonly RuleEntitySchema: EntitySchema

    protected readonly isMongoDB: boolean = false

    protected datasource: DataSource

    protected filtered: boolean = false

    protected repository: Repository<RuleEntity>

    constructor(datasourceOptions: DataSourceOptions, tableName: string) {
        const BaseColumnSchemaPart: Record<string, EntitySchemaColumnOptions> = {
            ptype: {type: String, nullable: true},
            v0: {type: String, nullable: true},
            v1: {type: String, nullable: true},
            v2: {type: String, nullable: true},
            v3: {type: String, nullable: true},
            v4: {type: String, nullable: true},
            v5: {type: String, nullable: true},
            v6: {type: String, nullable: true}
        }
        this.isMongoDB = datasourceOptions.type === 'mongodb'
        this.RuleEntitySchema = this.isMongoDB ? new EntitySchema({
            target: RuleEntity,
            name: 'RuleEntity',
            tableName: tableName,
            columns: {
                id: {type: String, objectId: true, generated: true, primary: true},
                ...BaseColumnSchemaPart
            }
        }) : new EntitySchema({
            target: RuleEntity,
            name: 'RuleEntity',
            tableName: tableName,
            columns: {
                id: {type: Number, generated: true, primary: true},
                ...BaseColumnSchemaPart
            }
        })
        this.datasource = new DataSource(Object.assign(datasourceOptions, {
            synchronize: true,
            entities: [this.RuleEntitySchema]
        }))
        this.repository = this.isMongoDB ? this.datasource.getMongoRepository<RuleEntity>(this.RuleEntitySchema) : this.datasource.getRepository(this.RuleEntitySchema)
    }

    /**
     * 创建适配器
     * @param datasourceOptions
     * @param tableName
     */
    public static async createAdapter(datasourceOptions: DataSourceOptions, tableName: string): Promise<DatabaseAdapter> {
        const adapter = new this(datasourceOptions, tableName)
        adapter.datasource = await adapter.datasource.initialize()
        return adapter
    }

    // protected getRepository(): Repository<any> {
    //     return this.isMongoDB ? this.datasource.getMongoRepository(this.RuleEntitySchema) : this.datasource.getRepository(this.RuleEntitySchema)
    // }

    protected async clearTable(): Promise<void> {
        await this.repository.clear()
    }

    protected loadPolicyLine(line: any, model: Model): void {
        const result =
            line.ptype +
            ', ' +
            [line.v0, line.v1, line.v2, line.v3, line.v4, line.v5, line.v6]
                .filter((n) => n)
                .map((n) => `"${n}"`)
                .join(', ')
        Helper.loadPolicyLine(result, model)
    }

    protected savePolicyLine(ptype: string, rule: string[]): any {
        const line: RuleEntity = new RuleEntity()
        line.ptype = ptype
        if (rule.length > 0) {
            line.v0 = rule[0]
        }
        if (rule.length > 1) {
            line.v1 = rule[1]
        }
        if (rule.length > 2) {
            line.v2 = rule[2]
        }
        if (rule.length > 3) {
            line.v3 = rule[3]
        }
        if (rule.length > 4) {
            line.v4 = rule[4]
        }
        if (rule.length > 5) {
            line.v5 = rule[5]
        }
        if (rule.length > 6) {
            line.v6 = rule[6]
        }
        return line
    }

    protected async saveLineByQueryRunner(lines: RuleEntity[]): Promise<void> {
        const queryRunner: QueryRunner = this.datasource.createQueryRunner()
        await queryRunner.connect()
        await queryRunner.startTransaction()
        try {
            await queryRunner.manager.save(lines)
            await queryRunner.commitTransaction()
        } catch (err) {
            await queryRunner.rollbackTransaction()
            throw err
        } finally {
            await queryRunner.release()
        }
    }

    public async addPolicy(sec: string, ptype: string, rule: string[]): Promise<void> {
        const line = this.savePolicyLine(ptype, rule)
        await this.repository.save(line)
    }

    public async addPolicies(sec: string, ptype: string, rules: string[][]) {
        const lines: RuleEntity[] = []
        for (const rule of rules) {
            const line = this.savePolicyLine(ptype, rule)
            lines.push(line)
        }
        await this.saveLineByQueryRunner(lines)
    }

    public async loadPolicy(model: Model): Promise<void> {
        const lines: RuleEntity[] = await this.repository.find()
        for (const line of lines) this.loadPolicyLine(line, model)
    }

    public async removeFilteredPolicy(sec: string, ptype: string, fieldIndex: number, ...fieldValues: string[]): Promise<void> {
        const line: RuleEntity = new RuleEntity()
        if (ptype) {
            line.ptype = ptype
        }
        if (fieldIndex <= 0 && 0 < fieldIndex + fieldValues.length) {
            if (fieldValues[0 - fieldIndex]) {
                line.v0 = fieldValues[0 - fieldIndex]
            }
        }
        if (fieldIndex <= 1 && 1 < fieldIndex + fieldValues.length) {
            if (fieldValues[1 - fieldIndex]) {
                line.v1 = fieldValues[1 - fieldIndex]
            }
        }
        if (fieldIndex <= 2 && 2 < fieldIndex + fieldValues.length) {
            if (fieldValues[2 - fieldIndex]) {
                line.v2 = fieldValues[2 - fieldIndex]
            }
        }
        if (fieldIndex <= 3 && 3 < fieldIndex + fieldValues.length) {
            if (fieldValues[3 - fieldIndex]) {
                line.v3 = fieldValues[3 - fieldIndex]
            }
        }
        if (fieldIndex <= 4 && 4 < fieldIndex + fieldValues.length) {
            if (fieldValues[4 - fieldIndex]) {
                line.v4 = fieldValues[4 - fieldIndex]
            }
        }
        if (fieldIndex <= 5 && 5 < fieldIndex + fieldValues.length) {
            if (fieldValues[5 - fieldIndex]) {
                line.v5 = fieldValues[5 - fieldIndex]
            }
        }
        if (fieldIndex <= 6 && 6 < fieldIndex + fieldValues.length) {
            if (fieldValues[6 - fieldIndex]) {
                line.v6 = fieldValues[6 - fieldIndex]
            }
        }
        await this.repository.delete({
            ...line
        })
    }

    public async removePolicy(sec: string, ptype: string, rule: string[]): Promise<void> {
        const line = this.savePolicyLine(ptype, rule)
        await this.repository.delete({
            ...line
        })
    }

    public async removePolicies(sec: string, ptype: string, rules: string[][]): Promise<void> {
        const queryRunner = this.datasource.createQueryRunner()
        await queryRunner.connect()
        await queryRunner.startTransaction()
        try {
            for (const rule of rules) {
                const line = this.savePolicyLine(ptype, rule)
                await queryRunner.manager.delete(this.RuleEntitySchema, line)
            }
            await queryRunner.commitTransaction()
        } catch (err) {
            await queryRunner.rollbackTransaction()
            throw err
        } finally {
            await queryRunner.release()
        }
    }

    public async savePolicy(model: Model): Promise<boolean> {
        await this.clearTable()
        let astMap = model.model.get('p')
        const lines: RuleEntity[] = []
        // @ts-ignore
        for (const [ptype, ast] of astMap) {
            for (const rule of ast.policy) {
                const line = this.savePolicyLine(ptype, rule)
                lines.push(line)
            }
        }
        astMap = model.model.get('g')
        if (astMap) {
            for (const [ptype, ast] of astMap) {
                for (const rule of ast.policy) {
                    const line = this.savePolicyLine(ptype, rule)
                    lines.push(line)
                }
            }
        }
        await this.saveLineByQueryRunner(lines)
        return true
    }

    public isFiltered(): boolean {
        return this.filtered
    }

    public async loadFilteredPolicy(model: Model, filter: any): Promise<void> {
        const filteredLines = await this.repository.find({where: filter})
        for (const line of filteredLines) {
            this.loadPolicyLine(line, model)
        }
        this.filtered = true
    }
}
