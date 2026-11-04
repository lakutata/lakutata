/*
** The storage of the databases of mongo-embedded (store.h): SQLite 3.53.2, its amalgamation included in this file with
** its functions kept inside it (SQLITE_API static, binding.gyp). A database is one file: its catalog (the table meta)
** and a table for each collection, all of them WITHOUT ROWID tables of two columns (k BLOB PRIMARY KEY, v BLOB), each
** one an index b-tree ordered by k. The tables are made and dropped by SQL; the documents are read and written by the
** b-tree layer directly, without the statements of SQL, the root page of each table read from sqlite_schema (again
** after each change of the schema).
**
** The rows of the catalog: 'f' the format (u32), 'n' the id of the next collection, 'c' + its name the id of a
** collection, 'k' + its id the count of its documents, 'x' + its id the definitions of its indexes (BSON, as the client
** writes them; the ids and the counts as 8 bytes, big endian), 'd' while the counts are not written. The counts are
** kept in memory and written at the closing: a write would write the page of the catalog too otherwise (a commit of
** one document costs 17 us, of two pages 29 us); the first write of a connection writes 'd', and an opening finding
** it (the connection before it did not close) counts the documents again (sqlite3BtreeCount, about 30 ms for
** 1,000,000 documents). The table of the documents of a collection is "c<id>": k
** is the key of the _id of a document (EmbeddedValues.idKey), v its BSON.
**
** The internal functions used: sqlite3BtreeBeginTrans, Commit, Rollback, Cursor, CursorSize, CursorZero, CloseCursor,
** IndexMoveto, Insert, Delete, First, Next, Eof, PayloadSize, Payload, PayloadFetch, Pager, Count; sqlite3KeyInfoAlloc,
** sqlite3KeyInfoUnref, sqlite3VdbeAllocUnpackedRecord, sqlite3VdbeRecordUnpack, sqlite3PutVarint,
** sqlite3PagerWalCallback, and the macro getVarint32. Their preconditions found, each one checked by the tests:
**  1. a varint of one byte is read by the macro getVarint32: the function sqlite3GetVarint32 takes it of two at least;
**  2. sqlite3BtreePayloadSize before sqlite3BtreePayloadFetch: it loads the cell the cursor is on, which the fetch reads;
**  3. sqlite3BtreeInsert overwrites an entry only when every field of the record given compares equal (its value
**     too): a document replaced is deleted, then inserted;
**  4. a commit of the b-tree layer does not call the hook of the WAL (sqlite3_step does): no automatic checkpoint; the
**     frames of the WAL told by sqlite3PagerWalCallback instead, for the checkpoints of the addon;
**  5. the root pages move with auto_vacuum or VACUUM: auto_vacuum is NONE, the roots read again after the schema
**     changes.
*/
#include "sqlite3.c"

#include "store.h"

#define MDE_FORMAT 1

typedef struct Collection {
  int64_t id;
  Pgno root;
  int64_t count;
  char *name;
  uint8_t *indexes;
  int indexesSize;
} Collection;

struct MdeStore {
  sqlite3 *db;
  Btree *bt;
  Pgno meta;
  KeyInfo *info;
  UnpackedRecord *probe;
  BtCursor *cursor;
  BtCursor *metaCursor;
  Collection *collections;
  int collectionCount;
  int collectionCapacity;
  /* The record written, the payload of a document whose cells overflow */
  uint8_t *record;
  size_t recordCapacity;
  uint8_t *payload;
  size_t payloadCapacity;
  int frames;
  /* The counts not written (the row 'd' written): written at the closing; the counts to count again at the opening */
  int countsDirty;
  int recount;
  char message[512];
};

static int Reserve(uint8_t **buffer, size_t *capacity, size_t size) {
  if (size <= *capacity) return 1;
  size_t grown = *capacity ? *capacity : 256;
  while (grown < size) grown *= 2;
  uint8_t *data = realloc(*buffer, grown);
  if (!data) return 0;
  *buffer = data;
  *capacity = grown;
  return 1;
}

static int Append(MdeBuffer *buffer, const void *data, size_t size) {
  if (!Reserve(&buffer->data, &buffer->capacity, buffer->size + size)) return 0;
  if (size) memcpy(buffer->data + buffer->size, data, size);
  buffer->size += size;
  return 1;
}

void mde_buffer_free(MdeBuffer *buffer) {
  free(buffer->data);
  buffer->data = NULL;
  buffer->size = buffer->capacity = 0;
}

static int Fail(MdeStore *store, int rc, const char *message) {
  snprintf(store->message, sizeof(store->message), "%s", message);
  return rc;
}

static int FailSql(MdeStore *store, int rc, const char *what) {
  snprintf(store->message, sizeof(store->message), "%s: %s", what, sqlite3_errmsg(store->db));
  return rc;
}

const char *mde_message(MdeStore *store) { return store->message; }

static void PutBigEndian(uint8_t *out, int64_t value) {
  for (int i = 0; i < 8; i++) out[i] = (uint8_t)((uint64_t)value >> (56 - 8 * i));
}

static int64_t BigEndian(const uint8_t *data) {
  uint64_t value = 0;
  for (int i = 0; i < 8; i++) value = (value << 8) | data[i];
  return (int64_t)value;
}

/* A record of one or two blobs, in store->record: its size, or -1 */
static int Record(MdeStore *store, const uint8_t *a, int na, const uint8_t *b, int nb) {
  uint8_t header[24];
  int n = 1;
  n += sqlite3PutVarint(header + n, (u64)na * 2 + 12);
  if (b) n += sqlite3PutVarint(header + n, (u64)nb * 2 + 12);
  header[0] = (uint8_t)n;
  if (!Reserve(&store->record, &store->recordCapacity, (size_t)n + na + nb)) return -1;
  memcpy(store->record, header, n);
  if (na) memcpy(store->record + n, a, na);
  if (b && nb) memcpy(store->record + n + na, b, nb);
  return n + na + nb;
}

/* A blob of a record: its offset and its size (*size), or -1 when the record has not that field */
static int Field(const uint8_t *record, int size, int field, int *length) {
  u32 headerSize, type;
  int at = getVarint32(record, headerSize);
  int offset = (int)headerSize;
  for (int i = 0; i <= field; i++) {
    if (at >= (int)headerSize) return -1;
    at += getVarint32(record + at, type);
    int bytes = type >= 12 ? (int)(type - 12) / 2 : 0;
    if (i == field) {
      if (offset + bytes > size) return -1;
      *length = bytes;
      return offset;
    }
    offset += bytes;
  }
  return -1;
}

static int OpenCursor(MdeStore *store, BtCursor *cursor, Pgno root, int write) {
  sqlite3BtreeCursorZero(cursor);
  return sqlite3BtreeCursor(store->bt, root, write ? BTREE_WRCSR : 0, store->info, cursor);
}

/* Moves a cursor to a key: *res 0 when it is there */
static int Seek(MdeStore *store, BtCursor *cursor, const uint8_t *key, int size, int *res) {
  int length = Record(store, key, size, NULL, 0);
  if (length < 0) return SQLITE_NOMEM;
  sqlite3VdbeRecordUnpack(length, store->record, store->probe);
  store->probe->default_rc = 0;
  return sqlite3BtreeIndexMoveto(cursor, store->probe, res);
}

/* Inserts a record (k, v) where the cursor was moved by Seek (res its result, not 0) */
static int Insert(MdeStore *store, BtCursor *cursor, const uint8_t *key, int keySize, const uint8_t *value,
                  int valueSize, int res) {
  BtreePayload payload;
  memset(&payload, 0, sizeof(payload));
  payload.nKey = Record(store, key, keySize, value, valueSize);
  if (payload.nKey < 0) return SQLITE_NOMEM;
  payload.pKey = store->record;
  return sqlite3BtreeInsert(cursor, &payload, 0, res);
}

/* Writes a record (k, v) in place of the one of its key, if any (precondition 3: deleted, then inserted) */
static int Put(MdeStore *store, BtCursor *cursor, const uint8_t *key, int keySize, const uint8_t *value, int valueSize) {
  int res = 0;
  int rc = Seek(store, cursor, key, keySize, &res);
  if (rc == SQLITE_OK && res == 0) {
    rc = sqlite3BtreeDelete(cursor, 0);
    if (rc == SQLITE_OK) rc = Seek(store, cursor, key, keySize, &res);
  }
  if (rc == SQLITE_OK) rc = Insert(store, cursor, key, keySize, value, valueSize, res);
  return rc;
}

/* The payload of the cell of a cursor: in place when it does not overflow, else copied */
static const uint8_t *PayloadOf(MdeStore *store, BtCursor *cursor, u32 *size) {
  /* Precondition 2: the size first, which loads the cell */
  *size = sqlite3BtreePayloadSize(cursor);
  u32 local = 0;
  const uint8_t *data = sqlite3BtreePayloadFetch(cursor, &local);
  if (local >= *size) return data;
  if (!Reserve(&store->payload, &store->payloadCapacity, *size)) return NULL;
  if (sqlite3BtreePayload(cursor, 0, *size, store->payload) != SQLITE_OK) return NULL;
  return store->payload;
}

static Collection *Find(MdeStore *store, int64_t id) {
  for (int i = 0; i < store->collectionCount; i++)
    if (store->collections[i].id == id) return &store->collections[i];
  return NULL;
}

/* The root pages of the tables (precondition 5: after each change of the schema) */
static int LoadRoots(MdeStore *store) {
  sqlite3_stmt *statement;
  int rc = sqlite3_prepare_v2(store->db, "SELECT name, rootpage FROM sqlite_schema WHERE type = 'table'", -1, &statement, 0);
  if (rc != SQLITE_OK) return FailSql(store, rc, "the schema");
  for (int i = 0; i < store->collectionCount; i++) store->collections[i].root = 0;
  store->meta = 0;
  while ((rc = sqlite3_step(statement)) == SQLITE_ROW) {
    const char *name = (const char *)sqlite3_column_text(statement, 0);
    Pgno root = (Pgno)sqlite3_column_int64(statement, 1);
    if (strcmp(name, "meta") == 0) {
      store->meta = root;
    } else if (name[0] == 'c') {
      Collection *collection = Find(store, strtoll(name + 1, NULL, 10));
      if (collection) collection->root = root;
    }
  }
  sqlite3_finalize(statement);
  if (rc != SQLITE_DONE) return FailSql(store, rc, "the schema");
  if (!store->meta) return Fail(store, SQLITE_CORRUPT, "the database of mongo-embedded has no catalog");
  for (int i = 0; i < store->collectionCount; i++)
    if (!store->collections[i].root) return Fail(store, SQLITE_CORRUPT, "a collection of the catalog has no table");
  return SQLITE_OK;
}

static int AddCollection(MdeStore *store, int64_t id, const char *name, int length) {
  if (store->collectionCount == store->collectionCapacity) {
    int capacity = store->collectionCapacity ? store->collectionCapacity * 2 : 16;
    Collection *grown = realloc(store->collections, sizeof(Collection) * capacity);
    if (!grown) return SQLITE_NOMEM;
    store->collections = grown;
    store->collectionCapacity = capacity;
  }
  Collection *collection = &store->collections[store->collectionCount];
  collection->name = malloc((size_t)length + 1);
  if (!collection->name) return SQLITE_NOMEM;
  memcpy(collection->name, name, length);
  collection->name[length] = 0;
  collection->id = id;
  collection->root = 0;
  collection->count = 0;
  collection->indexes = NULL;
  collection->indexesSize = 0;
  store->collectionCount++;
  return SQLITE_OK;
}

static int LoadCatalog(MdeStore *store) {
  sqlite3_stmt *statement;
  int rc = sqlite3_prepare_v2(store->db, "SELECT k, v FROM meta", -1, &statement, 0);
  if (rc != SQLITE_OK) return FailSql(store, rc, "the catalog");
  int format = 0;
  while ((rc = sqlite3_step(statement)) == SQLITE_ROW) {
    const uint8_t *key = sqlite3_column_blob(statement, 0);
    int keySize = sqlite3_column_bytes(statement, 0);
    const uint8_t *value = sqlite3_column_blob(statement, 1);
    int valueSize = sqlite3_column_bytes(statement, 1);
    if (keySize < 1) continue;
    if (key[0] == 'f' && valueSize == 4) format = (int)(((u32)value[0] << 24) | ((u32)value[1] << 16) | ((u32)value[2] << 8) | value[3]);
    if (key[0] == 'd' && keySize == 1) store->recount = 1;
    if (key[0] == 'c' && valueSize == 8 && AddCollection(store, BigEndian(value), (const char *)key + 1, keySize - 1) != SQLITE_OK) {
      sqlite3_finalize(statement);
      return Fail(store, SQLITE_NOMEM, "out of memory");
    }
  }
  sqlite3_finalize(statement);
  if (rc != SQLITE_DONE) return FailSql(store, rc, "the catalog");
  if (format != MDE_FORMAT) return Fail(store, SQLITE_CORRUPT, "the file is not a database of mongo-embedded (its format is not 1)");
  /* The counts and the definitions of the indexes, now the collections are known */
  rc = sqlite3_prepare_v2(store->db, "SELECT k, v FROM meta WHERE k >= x'6b' AND k < x'6c' OR k >= x'78' AND k < x'79'", -1, &statement, 0);
  if (rc != SQLITE_OK) return FailSql(store, rc, "the catalog");
  while ((rc = sqlite3_step(statement)) == SQLITE_ROW) {
    const uint8_t *key = sqlite3_column_blob(statement, 0);
    const uint8_t *value = sqlite3_column_blob(statement, 1);
    const int valueSize = sqlite3_column_bytes(statement, 1);
    if (sqlite3_column_bytes(statement, 0) != 9) continue;
    Collection *collection = Find(store, BigEndian(key + 1));
    if (!collection) continue;
    if (key[0] == 'k' && valueSize == 8) {
      collection->count = BigEndian(value);
    } else if (key[0] == 'x' && valueSize > 0) {
      collection->indexes = malloc((size_t)valueSize);
      if (!collection->indexes) {
        sqlite3_finalize(statement);
        return Fail(store, SQLITE_NOMEM, "out of memory");
      }
      memcpy(collection->indexes, value, valueSize);
      collection->indexesSize = valueSize;
    }
  }
  sqlite3_finalize(statement);
  if (rc != SQLITE_DONE) return FailSql(store, rc, "the catalog");
  return LoadRoots(store);
}

static int Exec(MdeStore *store, const char *sql, const char *what) {
  int rc = sqlite3_exec(store->db, sql, 0, 0, 0);
  return rc == SQLITE_OK ? rc : FailSql(store, rc, what);
}

/* The documents of each collection counted (the connection before did not close): the counts stay to be written */
static int Recount(MdeStore *store) {
  int rc = sqlite3BtreeBeginTrans(store->bt, 0, 0);
  if (rc != SQLITE_OK) return FailSql(store, rc, "the counts");
  for (int i = 0; i < store->collectionCount && rc == SQLITE_OK; i++) {
    i64 count = 0;
    OpenCursor(store, store->cursor, store->collections[i].root, 0);
    rc = sqlite3BtreeCount(store->db, store->cursor, &count);
    sqlite3BtreeCloseCursor(store->cursor);
    store->collections[i].count = count;
  }
  sqlite3BtreeCommit(store->bt);
  if (rc != SQLITE_OK) return FailSql(store, rc, "the counts");
  store->countsDirty = 1;
  return SQLITE_OK;
}

/* The counts written, the row 'd' deleted */
static int WriteCounts(MdeStore *store) {
  int rc = sqlite3BtreeBeginTrans(store->bt, 1, 0);
  if (rc != SQLITE_OK) return rc;
  OpenCursor(store, store->metaCursor, store->meta, 1);
  for (int i = 0; i < store->collectionCount && rc == SQLITE_OK; i++) {
    uint8_t key[9], value[8];
    key[0] = 'k';
    PutBigEndian(key + 1, store->collections[i].id);
    PutBigEndian(value, store->collections[i].count);
    rc = Put(store, store->metaCursor, key, 9, value, 8);
  }
  if (rc == SQLITE_OK) {
    const uint8_t key[1] = {'d'};
    int res = 0;
    rc = Seek(store, store->metaCursor, key, 1, &res);
    if (rc == SQLITE_OK && res == 0) rc = sqlite3BtreeDelete(store->metaCursor, 0);
  }
  sqlite3BtreeCloseCursor(store->metaCursor);
  if (rc == SQLITE_OK) rc = sqlite3BtreeCommit(store->bt);
  else sqlite3BtreeRollback(store->bt, SQLITE_OK, 0);
  if (rc == SQLITE_OK) store->countsDirty = 0;
  return rc;
}

int mde_open(const char *file, const MdeOptions *options, MdeStore **out, char *message, size_t size) {
  *out = NULL;
  MdeStore *store = calloc(1, sizeof(MdeStore));
  if (!store) {
    snprintf(message, size, "out of memory");
    return SQLITE_NOMEM;
  }
  int rc = sqlite3_open_v2(file, &store->db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_NOMUTEX, 0);
  if (rc != SQLITE_OK) {
    snprintf(message, size, "%s: %s", file, store->db ? sqlite3_errmsg(store->db) : "cannot open");
    sqlite3_close(store->db);
    free(store);
    return rc;
  }
  /* A lock held a moment by the other connection (the one of the checkpoints) is waited for */
  sqlite3_busy_timeout(store->db, 10000);
  /* The checkpoints of the addon only (precondition 4: none would run anyway from the writes of the b-tree layer) */
  char pragmas[512];
  snprintf(pragmas, sizeof(pragmas),
           "PRAGMA auto_vacuum = NONE; PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; PRAGMA synchronous = %s;"
           "PRAGMA cache_size = -%lld; PRAGMA mmap_size = %lld; PRAGMA fullfsync = %d; PRAGMA journal_size_limit = 4194304;",
           options->sync == MDE_SYNC_ALWAYS ? "FULL" : "NORMAL", (long long)(options->cacheBytes / 1024 > 0 ? options->cacheBytes / 1024 : 1),
           (long long)options->mmapBytes, options->sync == MDE_SYNC_ALWAYS ? 1 : 0);
  rc = Exec(store, pragmas, "the settings");
  if (rc == SQLITE_OK && !options->checkpoints) {
    rc = Exec(store,
              "CREATE TABLE IF NOT EXISTS meta(k BLOB PRIMARY KEY, v BLOB) WITHOUT ROWID;"
              "INSERT OR IGNORE INTO meta(k, v) VALUES (x'66', x'00000001'), (x'6e', x'0000000000000001');",
              "the catalog");
    if (rc == SQLITE_OK) rc = LoadCatalog(store);
    if (rc == SQLITE_OK) {
      store->bt = store->db->aDb[0].pBt;
      store->info = sqlite3KeyInfoAlloc(store->db, 1, 1);
      store->probe = store->info ? sqlite3VdbeAllocUnpackedRecord(store->info) : NULL;
      store->cursor = sqlite3MallocZero(sqlite3BtreeCursorSize());
      store->metaCursor = sqlite3MallocZero(sqlite3BtreeCursorSize());
      if (!store->probe || !store->cursor || !store->metaCursor) rc = Fail(store, SQLITE_NOMEM, "out of memory");
    }
    if (rc == SQLITE_OK && store->recount) rc = Recount(store);
  }
  if (rc != SQLITE_OK) {
    snprintf(message, size, "%s", store->message);
    mde_close(store);
    return rc;
  }
  *out = store;
  return SQLITE_OK;
}

void mde_close(MdeStore *store) {
  if (!store) return;
  if (store->bt && store->countsDirty) WriteCounts(store);
  sqlite3_free(store->cursor);
  sqlite3_free(store->metaCursor);
  if (store->probe) sqlite3DbFree(store->db, store->probe);
  if (store->info) sqlite3KeyInfoUnref(store->info);
  sqlite3_close(store->db);
  for (int i = 0; i < store->collectionCount; i++) {
    free(store->collections[i].name);
    free(store->collections[i].indexes);
  }
  free(store->collections);
  free(store->record);
  free(store->payload);
  free(store);
}

int mde_collections(MdeStore *store, MdeBuffer *out) {
  for (int i = 0; i < store->collectionCount; i++) {
    const Collection *collection = &store->collections[i];
    uint32_t length = (uint32_t)strlen(collection->name);
    uint32_t indexesSize = (uint32_t)collection->indexesSize;
    if (!Append(out, &length, 4) || !Append(out, collection->name, length) || !Append(out, &collection->id, 8) ||
        !Append(out, &collection->count, 8) || !Append(out, &indexesSize, 4) || !Append(out, collection->indexes, indexesSize))
      return Fail(store, SQLITE_NOMEM, "out of memory");
  }
  return SQLITE_OK;
}

/* A statement of the catalog run with blobs bound: its result code */
static int RunBlobs(MdeStore *store, const char *sql, const uint8_t *const *blobs, const int *sizes, int count) {
  sqlite3_stmt *statement;
  int rc = sqlite3_prepare_v2(store->db, sql, -1, &statement, 0);
  if (rc != SQLITE_OK) return FailSql(store, rc, "the catalog");
  for (int i = 0; i < count; i++) sqlite3_bind_blob(statement, i + 1, blobs[i], sizes[i], SQLITE_TRANSIENT);
  rc = sqlite3_step(statement);
  sqlite3_finalize(statement);
  return rc == SQLITE_DONE ? SQLITE_OK : FailSql(store, rc, "the catalog");
}

int mde_create_collection(MdeStore *store, const char *name, int64_t *id) {
  int length = (int)strlen(name);
  for (int i = 0; i < store->collectionCount; i++)
    if (strcmp(store->collections[i].name, name) == 0) return Fail(store, SQLITE_CONSTRAINT, "a collection of this name is there");
  int rc = Exec(store, "BEGIN IMMEDIATE", "the catalog");
  if (rc != SQLITE_OK) return rc;
  sqlite3_stmt *statement;
  int64_t next = 0;
  rc = sqlite3_prepare_v2(store->db, "SELECT v FROM meta WHERE k = x'6e'", -1, &statement, 0);
  if (rc == SQLITE_OK) {
    if (sqlite3_step(statement) == SQLITE_ROW && sqlite3_column_bytes(statement, 0) == 8) next = BigEndian(sqlite3_column_blob(statement, 0));
    sqlite3_finalize(statement);
  }
  if (rc != SQLITE_OK || next <= 0) {
    rc = rc != SQLITE_OK ? FailSql(store, rc, "the catalog") : Fail(store, SQLITE_CORRUPT, "the catalog has no next id");
    sqlite3_exec(store->db, "ROLLBACK", 0, 0, 0);
    return rc;
  }
  char sql[128];
  snprintf(sql, sizeof(sql), "CREATE TABLE c%lld(k BLOB PRIMARY KEY, v BLOB) WITHOUT ROWID", (long long)next);
  rc = Exec(store, sql, "the table of a collection");
  uint8_t *nameKey = malloc((size_t)length + 1);
  uint8_t idValue[8], countKey[9], zero[8] = {0}, nextValue[8];
  if (!nameKey) rc = Fail(store, SQLITE_NOMEM, "out of memory");
  if (rc == SQLITE_OK) {
    nameKey[0] = 'c';
    memcpy(nameKey + 1, name, length);
    PutBigEndian(idValue, next);
    countKey[0] = 'k';
    PutBigEndian(countKey + 1, next);
    PutBigEndian(nextValue, next + 1);
    const uint8_t *blobs[] = {nameKey, idValue, countKey, zero, nextValue};
    const int sizes[] = {length + 1, 8, 9, 8, 8};
    rc = RunBlobs(store, "INSERT INTO meta(k, v) VALUES (?1, ?2), (?3, ?4), (x'6e', ?5) ON CONFLICT(k) DO UPDATE SET v = excluded.v", blobs, sizes, 5);
  }
  free(nameKey);
  if (rc == SQLITE_OK) rc = Exec(store, "COMMIT", "the catalog");
  if (rc != SQLITE_OK) {
    sqlite3_exec(store->db, "ROLLBACK", 0, 0, 0);
    return rc;
  }
  rc = AddCollection(store, next, name, length);
  if (rc != SQLITE_OK) return Fail(store, rc, "out of memory");
  *id = next;
  return LoadRoots(store);
}

int mde_drop_collection(MdeStore *store, int64_t id) {
  Collection *collection = Find(store, id);
  if (!collection) return Fail(store, MDE_NO_COLLECTION, "no collection of this id");
  int length = (int)strlen(collection->name);
  uint8_t *nameKey = malloc((size_t)length + 1);
  uint8_t countKey[9], indexesKey[9];
  if (!nameKey) return Fail(store, SQLITE_NOMEM, "out of memory");
  nameKey[0] = 'c';
  memcpy(nameKey + 1, collection->name, length);
  countKey[0] = 'k';
  PutBigEndian(countKey + 1, id);
  indexesKey[0] = 'x';
  PutBigEndian(indexesKey + 1, id);
  char sql[64];
  snprintf(sql, sizeof(sql), "DROP TABLE c%lld", (long long)id);
  int rc = Exec(store, "BEGIN IMMEDIATE", "the catalog");
  if (rc == SQLITE_OK) rc = Exec(store, sql, "the table of a collection");
  if (rc == SQLITE_OK) {
    const uint8_t *blobs[] = {nameKey, countKey, indexesKey};
    const int sizes[] = {length + 1, 9, 9};
    rc = RunBlobs(store, "DELETE FROM meta WHERE k = ?1 OR k = ?2 OR k = ?3", blobs, sizes, 3);
  }
  free(nameKey);
  if (rc == SQLITE_OK) rc = Exec(store, "COMMIT", "the catalog");
  if (rc != SQLITE_OK) {
    sqlite3_exec(store->db, "ROLLBACK", 0, 0, 0);
    return rc;
  }
  free(collection->name);
  free(collection->indexes);
  *collection = store->collections[--store->collectionCount];
  return LoadRoots(store);
}

int mde_count(MdeStore *store, int64_t id, int64_t *count) {
  Collection *collection = Find(store, id);
  if (!collection) return Fail(store, MDE_NO_COLLECTION, "no collection of this id");
  *count = collection->count;
  return SQLITE_OK;
}

int mde_set_indexes(MdeStore *store, int64_t id, const uint8_t *data, int size) {
  Collection *collection = Find(store, id);
  if (!collection) return Fail(store, MDE_NO_COLLECTION, "no collection of this id");
  uint8_t *copy = NULL;
  if (size > 0) {
    copy = malloc((size_t)size);
    if (!copy) return Fail(store, SQLITE_NOMEM, "out of memory");
    memcpy(copy, data, size);
  }
  uint8_t key[9];
  key[0] = 'x';
  PutBigEndian(key + 1, id);
  int rc = sqlite3BtreeBeginTrans(store->bt, 1, 0);
  if (rc == SQLITE_OK) {
    OpenCursor(store, store->metaCursor, store->meta, 1);
    if (size > 0) {
      rc = Put(store, store->metaCursor, key, 9, data, size);
    } else {
      int res = 0;
      rc = Seek(store, store->metaCursor, key, 9, &res);
      if (rc == SQLITE_OK && res == 0) rc = sqlite3BtreeDelete(store->metaCursor, 0);
    }
    sqlite3BtreeCloseCursor(store->metaCursor);
    if (rc == SQLITE_OK) rc = sqlite3BtreeCommit(store->bt);
    else sqlite3BtreeRollback(store->bt, SQLITE_OK, 0);
  }
  if (rc != SQLITE_OK) {
    free(copy);
    return FailSql(store, rc, "the indexes of a collection");
  }
  free(collection->indexes);
  collection->indexes = copy;
  collection->indexesSize = size;
  store->frames = sqlite3PagerWalCallback(sqlite3BtreePager(store->bt));
  return SQLITE_OK;
}

int mde_write(MdeStore *store, int64_t id, const MdeChange *changes, int count, int *failed) {
  *failed = -1;
  Collection *collection = Find(store, id);
  if (!collection) return Fail(store, MDE_NO_COLLECTION, "no collection of this id");
  int rc = sqlite3BtreeBeginTrans(store->bt, 1, 0);
  if (rc != SQLITE_OK) return FailSql(store, rc, "a write");
  OpenCursor(store, store->cursor, collection->root, 1);
  int64_t delta = 0;
  for (int i = 0; i < count && rc == SQLITE_OK; i++) {
    const MdeChange *change = &changes[i];
    int res = 0;
    rc = Seek(store, store->cursor, change->key, change->keySize, &res);
    if (rc != SQLITE_OK) break;
    switch (change->kind) {
      case MDE_INSERT:
        if (res == 0) {
          rc = MDE_DUPLICATE_KEY;
          *failed = i;
          break;
        }
        rc = Insert(store, store->cursor, change->key, change->keySize, change->document, change->documentSize, res);
        delta++;
        break;
      case MDE_REPLACE:
        if (res != 0) {
          rc = MDE_MISSING;
          *failed = i;
          break;
        }
        /* Precondition 3: deleted, then inserted */
        rc = sqlite3BtreeDelete(store->cursor, 0);
        if (rc == SQLITE_OK) rc = Seek(store, store->cursor, change->key, change->keySize, &res);
        if (rc == SQLITE_OK) rc = Insert(store, store->cursor, change->key, change->keySize, change->document, change->documentSize, res);
        break;
      case MDE_DELETE:
        if (res != 0) break;
        rc = sqlite3BtreeDelete(store->cursor, 0);
        delta--;
        break;
      default:
        rc = Fail(store, SQLITE_MISUSE, "a change of an unknown kind");
        *failed = i;
    }
  }
  sqlite3BtreeCloseCursor(store->cursor);
  /* The first write of the connection: the counts not written from now on */
  if (rc == SQLITE_OK && delta != 0 && !store->countsDirty) {
    const uint8_t key[1] = {'d'}, value[1] = {1};
    OpenCursor(store, store->metaCursor, store->meta, 1);
    rc = Put(store, store->metaCursor, key, 1, value, 1);
    sqlite3BtreeCloseCursor(store->metaCursor);
  }
  if (rc == SQLITE_OK) rc = sqlite3BtreeCommit(store->bt);
  if (rc != SQLITE_OK) {
    if (rc == MDE_DUPLICATE_KEY) Fail(store, rc, "duplicate key");
    else if (rc == MDE_MISSING) Fail(store, rc, "the document replaced is not there");
    else if (rc != SQLITE_MISUSE) FailSql(store, rc, "a write");
    sqlite3BtreeRollback(store->bt, SQLITE_OK, 0);
    return rc;
  }
  collection->count += delta;
  if (delta != 0) store->countsDirty = 1;
  /* Precondition 4: the frames of the WAL for the checkpoints */
  store->frames = sqlite3PagerWalCallback(sqlite3BtreePager(store->bt));
  return SQLITE_OK;
}

/* The document of a cell (the field v of its record) appended to out: its offset, or -1 */
static int32_t AppendDocument(MdeStore *store, BtCursor *cursor, MdeBuffer *out, int *rc) {
  u32 size;
  const uint8_t *payload = PayloadOf(store, cursor, &size);
  if (!payload) {
    *rc = Fail(store, SQLITE_NOMEM, "out of memory");
    return -1;
  }
  int length;
  int offset = Field(payload, (int)size, 1, &length);
  if (offset < 0) {
    *rc = Fail(store, SQLITE_CORRUPT, "a record of a collection is not a document");
    return -1;
  }
  int32_t at = (int32_t)out->size;
  if (!Append(out, payload + offset, length)) {
    *rc = Fail(store, SQLITE_NOMEM, "out of memory");
    return -1;
  }
  return at;
}

int mde_get(MdeStore *store, int64_t id, const uint8_t *const *keys, const int *keySizes, int count, MdeBuffer *out,
            int32_t *offsets) {
  Collection *collection = Find(store, id);
  if (!collection) {
    for (int i = 0; i < count; i++) offsets[i] = -1;
    return SQLITE_OK;
  }
  int rc = sqlite3BtreeBeginTrans(store->bt, 0, 0);
  if (rc != SQLITE_OK) return FailSql(store, rc, "a read");
  OpenCursor(store, store->cursor, collection->root, 0);
  for (int i = 0; i < count && rc == SQLITE_OK; i++) {
    int res = 0;
    offsets[i] = -1;
    rc = Seek(store, store->cursor, keys[i], keySizes[i], &res);
    if (rc == SQLITE_OK && res == 0) offsets[i] = AppendDocument(store, store->cursor, out, &rc);
  }
  sqlite3BtreeCloseCursor(store->cursor);
  sqlite3BtreeCommit(store->bt);
  return rc;
}

int mde_scan(MdeStore *store, int64_t id, const uint8_t *after, int afterSize, int maxDocuments, size_t maxBytes,
             int maxScanned, MdeFilter filter, void *context, MdeBuffer *out, MdeBuffer *last, int *done) {
  *done = 1;
  Collection *collection = Find(store, id);
  if (!collection) return SQLITE_OK;
  int rc = sqlite3BtreeBeginTrans(store->bt, 0, 0);
  if (rc != SQLITE_OK) return FailSql(store, rc, "a read");
  OpenCursor(store, store->cursor, collection->root, 0);
  int empty = 0;
  if (after) {
    int res = 0;
    rc = Seek(store, store->cursor, after, afterSize, &res);
    /* At the key or before it: the next one */
    if (rc == SQLITE_OK && res <= 0 && !sqlite3BtreeEof(store->cursor)) {
      rc = sqlite3BtreeNext(store->cursor, 0);
      if (rc == SQLITE_DONE) {
        rc = SQLITE_OK;
        empty = 1;
      }
    }
    if (rc == SQLITE_OK && sqlite3BtreeEof(store->cursor)) empty = 1;
  } else {
    rc = sqlite3BtreeFirst(store->cursor, &empty);
  }
  int given = 0, scanned = 0;
  while (rc == SQLITE_OK && !empty) {
    u32 size;
    const uint8_t *payload = PayloadOf(store, store->cursor, &size);
    if (!payload) {
      rc = Fail(store, SQLITE_NOMEM, "out of memory");
      break;
    }
    int keyLength, valueLength;
    int keyOffset = Field(payload, (int)size, 0, &keyLength);
    int valueOffset = Field(payload, (int)size, 1, &valueLength);
    if (keyOffset < 0 || valueOffset < 0) {
      rc = Fail(store, SQLITE_CORRUPT, "a record of a collection is not a document");
      break;
    }
    scanned++;
    if (!filter || filter(payload + valueOffset, (size_t)valueLength, context)) {
      if (!Append(out, payload + valueOffset, valueLength)) {
        rc = Fail(store, SQLITE_NOMEM, "out of memory");
        break;
      }
      given++;
    }
    last->size = 0;
    if (!Append(last, payload + keyOffset, keyLength)) {
      rc = Fail(store, SQLITE_NOMEM, "out of memory");
      break;
    }
    rc = sqlite3BtreeNext(store->cursor, 0);
    if (rc == SQLITE_DONE) {
      rc = SQLITE_OK;
      break;
    }
    if (rc != SQLITE_OK) break;
    if (given >= maxDocuments || out->size >= maxBytes || scanned >= maxScanned) {
      *done = 0;
      break;
    }
  }
  sqlite3BtreeCloseCursor(store->cursor);
  sqlite3BtreeCommit(store->bt);
  if (rc != SQLITE_OK && store->message[0] == 0) FailSql(store, rc, "a read");
  return rc;
}

int mde_frames(MdeStore *store) {
  int frames = store->frames;
  store->frames = 0;
  return frames;
}

int mde_checkpoint(MdeStore *store, int *frames, int *checkpointed) {
  int rc = sqlite3_wal_checkpoint_v2(store->db, NULL, SQLITE_CHECKPOINT_PASSIVE, frames, checkpointed);
  /* Busy: another connection holds the checkpoint */
  return rc == SQLITE_OK || rc == SQLITE_BUSY ? rc : FailSql(store, rc, "a checkpoint");
}

int mde_integrity(MdeStore *store, MdeBuffer *out) {
  sqlite3_stmt *statement;
  int rc = sqlite3_prepare_v2(store->db, "PRAGMA integrity_check", -1, &statement, 0);
  if (rc != SQLITE_OK) return FailSql(store, rc, "the integrity check");
  while ((rc = sqlite3_step(statement)) == SQLITE_ROW) {
    const char *line = (const char *)sqlite3_column_text(statement, 0);
    if (out->size && !Append(out, "\n", 1)) break;
    if (line && !Append(out, line, strlen(line))) break;
  }
  sqlite3_finalize(statement);
  return rc == SQLITE_DONE ? SQLITE_OK : FailSql(store, rc, "the integrity check");
}
