import { EntityMetadata } from '../metadata/EntityMetadata'
import { ColumnMetadata } from '../metadata/ColumnMetadata'
import { ForeignKeyMetadata } from '../metadata/ForeignKeyMetadata'
import { IndexMetadata } from '../metadata/IndexMetadata'
/**
 * Creates EntityMetadata for junction tables of the closure entities.
 * Closure junction tables are tables generated by closure entities.
 */
export class ClosureJunctionEntityMetadataBuilder {
    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------
    constructor(connection) {
        this.connection = connection
    }
    // -------------------------------------------------------------------------
    // Public Methods
    // -------------------------------------------------------------------------
    /**
     * Builds EntityMetadata for the closure junction of the given closure entity.
     */
    build(parentClosureEntityMetadata) {
        // create entity metadata itself
        const entityMetadata = new EntityMetadata({
            parentClosureEntityMetadata: parentClosureEntityMetadata,
            connection: this.connection,
            args: {
                target: '',
                name: parentClosureEntityMetadata.treeOptions &&
                    parentClosureEntityMetadata.treeOptions.closureTableName
                    ? parentClosureEntityMetadata.treeOptions
                        .closureTableName
                    : parentClosureEntityMetadata.tableNameWithoutPrefix,
                type: 'closure-junction'
            }
        })
        entityMetadata.build()
        // create ancestor and descendant columns for new closure junction table
        parentClosureEntityMetadata.primaryColumns.forEach((primaryColumn) => {
            entityMetadata.ownColumns.push(new ColumnMetadata({
                connection: this.connection,
                entityMetadata: entityMetadata,
                closureType: 'ancestor',
                referencedColumn: primaryColumn,
                args: {
                    target: '',
                    mode: 'virtual',
                    propertyName: parentClosureEntityMetadata.treeOptions &&
                        parentClosureEntityMetadata.treeOptions
                            .ancestorColumnName
                        ? parentClosureEntityMetadata.treeOptions.ancestorColumnName(primaryColumn)
                        : primaryColumn.propertyName + '_ancestor',
                    options: {
                        primary: true,
                        length: primaryColumn.length,
                        type: primaryColumn.type
                    }
                }
            }))
            entityMetadata.ownColumns.push(new ColumnMetadata({
                connection: this.connection,
                entityMetadata: entityMetadata,
                closureType: 'descendant',
                referencedColumn: primaryColumn,
                args: {
                    target: '',
                    mode: 'virtual',
                    propertyName: parentClosureEntityMetadata.treeOptions &&
                        parentClosureEntityMetadata.treeOptions
                            .descendantColumnName
                        ? parentClosureEntityMetadata.treeOptions.descendantColumnName(primaryColumn)
                        : primaryColumn.propertyName + '_descendant',
                    options: {
                        primary: true,
                        length: primaryColumn.length,
                        type: primaryColumn.type
                    }
                }
            }))
        })
        entityMetadata.ownIndices = [
            new IndexMetadata({
                entityMetadata: entityMetadata,
                columns: [entityMetadata.ownColumns[0]],
                args: {
                    target: entityMetadata.target,
                    synchronize: true
                }
            }),
            new IndexMetadata({
                entityMetadata: entityMetadata,
                columns: [entityMetadata.ownColumns[1]],
                args: {
                    target: entityMetadata.target,
                    synchronize: true
                }
            })
        ]
        // if tree level column was defined by a closure entity then add it to the junction columns as well
        if (parentClosureEntityMetadata.treeLevelColumn) {
            entityMetadata.ownColumns.push(new ColumnMetadata({
                connection: this.connection,
                entityMetadata: entityMetadata,
                args: {
                    target: '',
                    mode: 'virtual',
                    propertyName: 'level',
                    options: {
                        type: this.connection.driver.mappedDataTypes
                            .treeLevel
                    }
                }
            }))
        }
        // create junction table foreign keys
        // Note: CASCADE is not applied to mssql because it does not support multi cascade paths
        entityMetadata.foreignKeys = [
            new ForeignKeyMetadata({
                entityMetadata: entityMetadata,
                referencedEntityMetadata: parentClosureEntityMetadata,
                columns: [entityMetadata.ownColumns[0]],
                referencedColumns: parentClosureEntityMetadata.primaryColumns,
                onDelete: this.connection.driver.options.type === 'mssql'
                    ? 'NO ACTION'
                    : 'CASCADE'
            }),
            new ForeignKeyMetadata({
                entityMetadata: entityMetadata,
                referencedEntityMetadata: parentClosureEntityMetadata,
                columns: [entityMetadata.ownColumns[1]],
                referencedColumns: parentClosureEntityMetadata.primaryColumns,
                onDelete: this.connection.driver.options.type === 'mssql'
                    ? 'NO ACTION'
                    : 'CASCADE'
            })
        ]
        return entityMetadata
    }
}

//# sourceMappingURL=ClosureJunctionEntityMetadataBuilder.js.map
