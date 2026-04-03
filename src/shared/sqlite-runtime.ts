import { createRequire } from 'node:module'

type BetterSqlite3Module = typeof import('better-sqlite3')

const Database = createRequire(import.meta.url)(
  'better-sqlite3'
) as BetterSqlite3Module

export default Database
