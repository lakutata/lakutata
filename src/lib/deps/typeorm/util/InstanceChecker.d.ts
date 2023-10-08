import type { MongoEntityManager } from '../entity-manager/MongoEntityManager'
import type { SqljsEntityManager } from '../entity-manager/SqljsEntityManager'
import type { EntitySchema } from '../entity-schema/EntitySchema'
import type { FindOperator } from '../find-options/FindOperator'
import type { EqualOperator } from '../find-options/EqualOperator'
import type { Query } from '../driver/Query'
import type { RdbmsSchemaBuilder } from '../schema-builder/RdbmsSchemaBuilder'
import type { Subject } from '../persistence/Subject'
import type { SelectQueryBuilder } from '../query-builder/SelectQueryBuilder'
import type { UpdateQueryBuilder } from '../query-builder/UpdateQueryBuilder'
import type { DeleteQueryBuilder } from '../query-builder/DeleteQueryBuilder'
import type { SoftDeleteQueryBuilder } from '../query-builder/SoftDeleteQueryBuilder'
import type { InsertQueryBuilder } from '../query-builder/InsertQueryBuilder'
import type { RelationQueryBuilder } from '../query-builder/RelationQueryBuilder'
import type { Brackets } from '../query-builder/Brackets'
import type { Table } from '../schema-builder/table/Table'
import type { TableCheck } from '../schema-builder/table/TableCheck'
import type { TableColumn } from '../schema-builder/table/TableColumn'
import type { TableExclusion } from '../schema-builder/table/TableExclusion'
import type { TableForeignKey } from '../schema-builder/table/TableForeignKey'
import type { TableIndex } from '../schema-builder/table/TableIndex'
import type { TableUnique } from '../schema-builder/table/TableUnique'
import type { View } from '../schema-builder/view/View'
import type { NotBrackets } from '../query-builder/NotBrackets'
import type { EntityMetadata } from '../metadata/EntityMetadata'
import type { ColumnMetadata } from '../metadata/ColumnMetadata'
import type { MssqlParameter } from '../driver/sqlserver/MssqlParameter'
import { DataSource } from '../data-source'
import { BaseEntity } from '../repository/BaseEntity'
export declare class InstanceChecker {
    static isMssqlParameter(obj: unknown): obj is MssqlParameter;
    static isEntityMetadata(obj: unknown): obj is EntityMetadata;
    static isColumnMetadata(obj: unknown): obj is ColumnMetadata;
    static isSelectQueryBuilder(obj: unknown): obj is SelectQueryBuilder<any>;
    static isInsertQueryBuilder(obj: unknown): obj is InsertQueryBuilder<any>;
    static isDeleteQueryBuilder(obj: unknown): obj is DeleteQueryBuilder<any>;
    static isUpdateQueryBuilder(obj: unknown): obj is UpdateQueryBuilder<any>;
    static isSoftDeleteQueryBuilder(obj: unknown): obj is SoftDeleteQueryBuilder<any>;
    static isRelationQueryBuilder(obj: unknown): obj is RelationQueryBuilder<any>;
    static isBrackets(obj: unknown): obj is Brackets;
    static isNotBrackets(obj: unknown): obj is NotBrackets;
    static isSubject(obj: unknown): obj is Subject;
    static isRdbmsSchemaBuilder(obj: unknown): obj is RdbmsSchemaBuilder;
    static isMongoEntityManager(obj: unknown): obj is MongoEntityManager;
    static isSqljsEntityManager(obj: unknown): obj is SqljsEntityManager;
    static isEntitySchema(obj: unknown): obj is EntitySchema;
    static isBaseEntityConstructor(obj: unknown): obj is typeof BaseEntity;
    static isFindOperator(obj: unknown): obj is FindOperator<any>;
    static isEqualOperator(obj: unknown): obj is EqualOperator<any>;
    static isQuery(obj: unknown): obj is Query;
    static isTable(obj: unknown): obj is Table;
    static isTableCheck(obj: unknown): obj is TableCheck;
    static isTableColumn(obj: unknown): obj is TableColumn;
    static isTableExclusion(obj: unknown): obj is TableExclusion;
    static isTableForeignKey(obj: unknown): obj is TableForeignKey;
    static isTableIndex(obj: unknown): obj is TableIndex;
    static isTableUnique(obj: unknown): obj is TableUnique;
    static isView(obj: unknown): obj is View;
    static isDataSource(obj: unknown): obj is DataSource;
    private static check
}
