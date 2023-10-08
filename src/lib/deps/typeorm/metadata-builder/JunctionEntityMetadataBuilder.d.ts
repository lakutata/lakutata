import { ColumnMetadata } from '../metadata/ColumnMetadata'
import { DataSource } from '../data-source/DataSource'
import { EntityMetadata } from '../metadata/EntityMetadata'
import { JoinTableMetadataArgs } from '../metadata-args/JoinTableMetadataArgs'
import { RelationMetadata } from '../metadata/RelationMetadata'
/**
 * Creates EntityMetadata for junction tables.
 * Junction tables are tables generated by many-to-many relations.
 */
export declare class JunctionEntityMetadataBuilder {
    private connection
    constructor(connection: DataSource);
    /**
     * Builds EntityMetadata for the junction of the given many-to-many relation.
     */
    build(relation: RelationMetadata, joinTable: JoinTableMetadataArgs): EntityMetadata;
    /**
     * Collects referenced columns from the given join column args.
     */
    protected collectReferencedColumns(relation: RelationMetadata, joinTable: JoinTableMetadataArgs): ColumnMetadata[];
    /**
     * Collects inverse referenced columns from the given join column args.
     */
    protected collectInverseReferencedColumns(relation: RelationMetadata, joinTable: JoinTableMetadataArgs): ColumnMetadata[];
    protected changeDuplicatedColumnNames(junctionColumns: ColumnMetadata[], inverseJunctionColumns: ColumnMetadata[]): void;
}
