//The directory backend on PostgreSQL and MySQL (test-env/databases/run.sh gives their URLs); skipped without them
import {directorySuite} from '../support/DirectorySuite.js'

const POSTGRES: string | undefined = process.env.LDAP_TEST_POSTGRES_URL
const MYSQL: string | undefined = process.env.LDAP_TEST_MYSQL_URL

directorySuite('PostgreSQL', POSTGRES ? async () => ({type: 'postgres', url: POSTGRES}) : undefined)
directorySuite('MySQL', MYSQL ? async () => ({type: 'mysql', url: MYSQL}) : undefined)
