import {DTO} from '@lakutata/core'
import {Expect} from '@lakutata/core/decorator/dto'

/**
 * The locks of MySQL (or MariaDB) (the package mysql2)
 */
export class MysqlMutexOptions extends DTO {
    @Expect(DTO.String().valid('mysql').required())
    public type: 'mysql'

    @Expect(DTO.String().required())
    public host: string

    @Expect(DTO.Number().port().optional().default(3306))
    public port?: number

    @Expect(DTO.String().required())
    public database: string

    @Expect(DTO.String().required())
    public username: string

    @Expect(DTO.String().allow('').required())
    public password: string

    /**
     * advisory (default): the locks of a connection of their own, released when it closes; table: the rows of a table,
     * expired and renewed (through the poolers of connections, the clusters), with fencing tokens
     */
    @Expect(DTO.String().valid('advisory', 'table').optional().default('advisory'))
    public mode?: 'advisory' | 'table'

    /**
     * The table of the mode table, lakutata_mutex by default
     */
    @Expect(DTO.String().optional().default('lakutata_mutex'))
    public table?: string
}
