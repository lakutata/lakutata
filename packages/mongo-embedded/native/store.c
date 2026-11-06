/*
** The storage of the databases of mongo-embedded (store.h): SQLite 3.53.2, its amalgamation (native/engine/engine.c,
** the sqlite3.c of its release, unchanged: vendor/UPSTREAM.json) included in this file with its functions kept inside
** it (SQLITE_API static, binding.gyp). A database is one file: its catalog (the table meta), a table for each
** collection and one for each of its indexes, all of them WITHOUT ROWID tables of two columns (k BLOB PRIMARY KEY, v
** BLOB), each one an index b-tree ordered by k. The tables are made and dropped by SQL; the documents are read and
** written by the b-tree layer directly, without the statements of SQL, the root page of each table read from
** sqlite_schema (again after each change of the schema).
**
** The rows of the catalog: 'f' the format (u32), 'n' the next id (of a collection or an index), 'c' + its name the id
** of a collection, 'k' + its id the count of its documents, 'x' + its id the definitions of its indexes (BSON, as the
** client writes them; the ids and the counts as 8 bytes, big endian), 'd' while the counts are not written. The counts
** are kept in memory and written at the closing: a write would write the page of the catalog too otherwise (a commit of
** one document costs 17 us, of two pages 29 us); the first write of a connection writes 'd', and an opening finding it
** (the connection before it did not close) counts the documents again (sqlite3BtreeCount, about 30 ms for 1,000,000
** documents). The table of the documents of a collection is "c<id>": k is the key of the _id of a document
** (EmbeddedValues.idKey, ordered as MongoDB orders the _id), v its BSON. The table of an index is "i<the id of the
** collection>_<its id>": k the key of the index (then the one of the _id when it is not unique), v the key of the _id;
** the entries of the indexes are written in the transaction of the changes of the documents (a duplicate key of a
** unique index fails it), and their ranges walked to the documents.
**
** The internal functions used: sqlite3BtreeBeginTrans, Commit, Rollback, Cursor, CursorSize, CursorZero, CloseCursor,
** IndexMoveto, Insert, Delete, First, Last, Next, Previous, Eof, PayloadSize, Payload, PayloadFetch, Pager, Count;
** sqlite3KeyInfoAlloc, sqlite3KeyInfoUnref, sqlite3VdbeAllocUnpackedRecord, sqlite3VdbeRecordUnpack, sqlite3PutVarint,
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
#include "engine.c"

#include "store.h"

/* The format of the file: 2 since the keys of the _id are the ones of the indexes (ordered) */
#define MDE_FORMAT 2

typedef struct Collection {
  int64_t id;
  Pgno root;
  int64_t count;
  char *name;
  uint8_t *indexes;
  int indexesSize;
  /* The tables of its indexes, "i<the id of the collection>_<the id of the index>": their ids and root pages (read from
  ** the schema) */
  int64_t *tables;
  Pgno *tableRoots;
  int tableCount;
  int tableCapacity;
} Collection;

struct MdeStore {
  sqlite3 *db;
  Btree *bt;
  Pgno meta;
  KeyInfo *info;
  UnpackedRecord *probe;
  BtCursor *cursor;
  BtCursor *metaCursor;
  /* The cursor of the tables of the indexes, and of the walks of the ranges */
  BtCursor *entryCursor;
  Collection *collections;
  int collectionCount;
  int collectionCapacity;
  /* The record written, the payload of a document whose cells overflow */
  uint8_t *record;
  size_t recordCapacity;
  uint8_t *payload;
  size_t payloadCapacity;
  /* The key of the _id of an entry of an index walked, copied before its document is read (whose payload may be in
  ** payload) */
  MdeBuffer entryValue;
  int frames;
  /* The counts not written (the row 'd' written): written at the closing; the counts to count again at the opening */
  int countsDirty;
  int recount;
  /* The transaction of a session open (mde_begin) */
  int transaction;
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

/*
** The VFS of the databases ("mongo-embedded"): the default one of the system, but the writes of the frames of a WAL.
** SQLite writes a frame as its header (24 bytes) then its page, two system calls; the header is held, then written with
** the page following it as one write. Anything else on the file (another write, a read, a sync, a truncation, its size,
** a control, its closing) writes the header held first: a frame is in the file once SQLite wrote it, before the index
** of the WAL tells it, as without this VFS.
*/
#define MDE_FRAME_HEADER 24

typedef struct MdeFile {
  sqlite3_file base;
  /* The file of the default VFS, allocated after this one */
  sqlite3_file *real;
  int wal;
  /* The header of a frame held (size 0: none), and where it is written */
  uint8_t header[MDE_FRAME_HEADER];
  int held;
  sqlite3_int64 heldAt;
  /* The header and the page written together */
  uint8_t *joined;
  size_t joinedCapacity;
} MdeFile;

static sqlite3_vfs *mdeRealVfs;

/* Writes the header held, if any */
static int MdeFlush(MdeFile *file) {
  if (!file->held) return SQLITE_OK;
  file->held = 0;
  return file->real->pMethods->xWrite(file->real, file->header, MDE_FRAME_HEADER, file->heldAt);
}

static int MdeClose(sqlite3_file *base) {
  MdeFile *file = (MdeFile *)base;
  int rc = MdeFlush(file);
  int closed = file->real->pMethods->xClose(file->real);
  free(file->joined);
  file->joined = NULL;
  return rc != SQLITE_OK ? rc : closed;
}

static int MdeRead(sqlite3_file *base, void *data, int amount, sqlite3_int64 offset) {
  MdeFile *file = (MdeFile *)base;
  int rc = MdeFlush(file);
  return rc != SQLITE_OK ? rc : file->real->pMethods->xRead(file->real, data, amount, offset);
}

static int MdeWrite(sqlite3_file *base, const void *data, int amount, sqlite3_int64 offset) {
  MdeFile *file = (MdeFile *)base;
  if (file->wal && !file->held && amount == MDE_FRAME_HEADER) {
    memcpy(file->header, data, MDE_FRAME_HEADER);
    file->held = 1;
    file->heldAt = offset;
    return SQLITE_OK;
  }
  if (file->held && offset == file->heldAt + MDE_FRAME_HEADER) {
    size_t size = (size_t)MDE_FRAME_HEADER + (size_t)amount;
    if (Reserve(&file->joined, &file->joinedCapacity, size)) {
      memcpy(file->joined, file->header, MDE_FRAME_HEADER);
      memcpy(file->joined + MDE_FRAME_HEADER, data, (size_t)amount);
      file->held = 0;
      return file->real->pMethods->xWrite(file->real, file->joined, (int)size, file->heldAt);
    }
  }
  int rc = MdeFlush(file);
  return rc != SQLITE_OK ? rc : file->real->pMethods->xWrite(file->real, data, amount, offset);
}

static int MdeTruncate(sqlite3_file *base, sqlite3_int64 size) {
  MdeFile *file = (MdeFile *)base;
  int rc = MdeFlush(file);
  return rc != SQLITE_OK ? rc : file->real->pMethods->xTruncate(file->real, size);
}

static int MdeSync(sqlite3_file *base, int flags) {
  MdeFile *file = (MdeFile *)base;
  int rc = MdeFlush(file);
  return rc != SQLITE_OK ? rc : file->real->pMethods->xSync(file->real, flags);
}

static int MdeFileSize(sqlite3_file *base, sqlite3_int64 *size) {
  MdeFile *file = (MdeFile *)base;
  int rc = MdeFlush(file);
  return rc != SQLITE_OK ? rc : file->real->pMethods->xFileSize(file->real, size);
}

static int MdeLock(sqlite3_file *base, int lock) {
  MdeFile *file = (MdeFile *)base;
  return file->real->pMethods->xLock(file->real, lock);
}

static int MdeUnlock(sqlite3_file *base, int lock) {
  MdeFile *file = (MdeFile *)base;
  int rc = MdeFlush(file);
  int unlocked = file->real->pMethods->xUnlock(file->real, lock);
  return rc != SQLITE_OK ? rc : unlocked;
}

static int MdeCheckReservedLock(sqlite3_file *base, int *reserved) {
  MdeFile *file = (MdeFile *)base;
  return file->real->pMethods->xCheckReservedLock(file->real, reserved);
}

static int MdeFileControl(sqlite3_file *base, int op, void *argument) {
  MdeFile *file = (MdeFile *)base;
  int rc = MdeFlush(file);
  return rc != SQLITE_OK ? rc : file->real->pMethods->xFileControl(file->real, op, argument);
}

static int MdeSectorSize(sqlite3_file *base) {
  MdeFile *file = (MdeFile *)base;
  return file->real->pMethods->xSectorSize(file->real);
}

static int MdeDeviceCharacteristics(sqlite3_file *base) {
  MdeFile *file = (MdeFile *)base;
  return file->real->pMethods->xDeviceCharacteristics(file->real);
}

static int MdeShmMap(sqlite3_file *base, int region, int size, int extend, void volatile **memory) {
  MdeFile *file = (MdeFile *)base;
  return file->real->pMethods->xShmMap(file->real, region, size, extend, memory);
}

static int MdeShmLock(sqlite3_file *base, int offset, int count, int flags) {
  MdeFile *file = (MdeFile *)base;
  return file->real->pMethods->xShmLock(file->real, offset, count, flags);
}

static void MdeShmBarrier(sqlite3_file *base) {
  MdeFile *file = (MdeFile *)base;
  file->real->pMethods->xShmBarrier(file->real);
}

static int MdeShmUnmap(sqlite3_file *base, int deleteFlag) {
  MdeFile *file = (MdeFile *)base;
  return file->real->pMethods->xShmUnmap(file->real, deleteFlag);
}

static int MdeFetch(sqlite3_file *base, sqlite3_int64 offset, int amount, void **pointer) {
  MdeFile *file = (MdeFile *)base;
  int rc = MdeFlush(file);
  return rc != SQLITE_OK ? rc : file->real->pMethods->xFetch(file->real, offset, amount, pointer);
}

static int MdeUnfetch(sqlite3_file *base, sqlite3_int64 offset, void *pointer) {
  MdeFile *file = (MdeFile *)base;
  return file->real->pMethods->xUnfetch(file->real, offset, pointer);
}

static const sqlite3_io_methods mdeMethods = {
    3, MdeClose, MdeRead, MdeWrite, MdeTruncate, MdeSync, MdeFileSize, MdeLock, MdeUnlock, MdeCheckReservedLock,
    MdeFileControl, MdeSectorSize, MdeDeviceCharacteristics, MdeShmMap, MdeShmLock, MdeShmBarrier, MdeShmUnmap,
    MdeFetch, MdeUnfetch};

static int MdeOpen(sqlite3_vfs *vfs, sqlite3_filename name, sqlite3_file *base, int flags, int *outFlags) {
  (void)vfs;
  MdeFile *file = (MdeFile *)base;
  memset(file, 0, sizeof(MdeFile));
  file->real = (sqlite3_file *)((uint8_t *)file + ((sizeof(MdeFile) + 7) & ~(size_t)7));
  int rc = mdeRealVfs->xOpen(mdeRealVfs, name, file->real, flags, outFlags);
  /* The methods of the default VFS for the files: the ones forwarded require its version 3 */
  if (rc != SQLITE_OK || !file->real->pMethods || file->real->pMethods->iVersion < 3) {
    if (rc == SQLITE_OK && file->real->pMethods) file->real->pMethods->xClose(file->real);
    base->pMethods = NULL;
    return rc != SQLITE_OK ? rc : SQLITE_CANTOPEN;
  }
  file->wal = (flags & SQLITE_OPEN_WAL) != 0;
  base->pMethods = &mdeMethods;
  return SQLITE_OK;
}

static int MdeDelete(sqlite3_vfs *vfs, const char *name, int syncDir) {
  (void)vfs;
  return mdeRealVfs->xDelete(mdeRealVfs, name, syncDir);
}

static int MdeAccess(sqlite3_vfs *vfs, const char *name, int flags, int *result) {
  (void)vfs;
  return mdeRealVfs->xAccess(mdeRealVfs, name, flags, result);
}

static int MdeFullPathname(sqlite3_vfs *vfs, const char *name, int size, char *out) {
  (void)vfs;
  return mdeRealVfs->xFullPathname(mdeRealVfs, name, size, out);
}

static int MdeRandomness(sqlite3_vfs *vfs, int size, char *out) {
  (void)vfs;
  return mdeRealVfs->xRandomness(mdeRealVfs, size, out);
}

static int MdeSleep(sqlite3_vfs *vfs, int microseconds) {
  (void)vfs;
  return mdeRealVfs->xSleep(mdeRealVfs, microseconds);
}

static int MdeCurrentTime(sqlite3_vfs *vfs, double *now) {
  (void)vfs;
  return mdeRealVfs->xCurrentTime(mdeRealVfs, now);
}

static int MdeGetLastError(sqlite3_vfs *vfs, int size, char *out) {
  (void)vfs;
  return mdeRealVfs->xGetLastError ? mdeRealVfs->xGetLastError(mdeRealVfs, size, out) : 0;
}

static int MdeCurrentTimeInt64(sqlite3_vfs *vfs, sqlite3_int64 *now) {
  (void)vfs;
  return mdeRealVfs->xCurrentTimeInt64(mdeRealVfs, now);
}

static sqlite3_vfs mdeVfs;

/* The VFS registered once, by the first opening: the name to open the databases with */
static const char *MdeVfs(void) {
  static int registered = 0;
  static sqlite3_mutex *mutex;
  sqlite3_initialize();
  mutex = sqlite3_mutex_alloc(SQLITE_MUTEX_STATIC_VFS1);
  sqlite3_mutex_enter(mutex);
  if (!registered) {
    mdeRealVfs = sqlite3_vfs_find(0);
    mdeVfs.iVersion = 2;
    mdeVfs.szOsFile = (int)((sizeof(MdeFile) + 7) & ~(size_t)7) + mdeRealVfs->szOsFile;
    mdeVfs.mxPathname = mdeRealVfs->mxPathname;
    mdeVfs.zName = "mongo-embedded";
    mdeVfs.xOpen = MdeOpen;
    mdeVfs.xDelete = MdeDelete;
    mdeVfs.xAccess = MdeAccess;
    mdeVfs.xFullPathname = MdeFullPathname;
    mdeVfs.xRandomness = MdeRandomness;
    mdeVfs.xSleep = MdeSleep;
    mdeVfs.xCurrentTime = MdeCurrentTime;
    mdeVfs.xGetLastError = MdeGetLastError;
    mdeVfs.xCurrentTimeInt64 = MdeCurrentTimeInt64;
    registered = sqlite3_vfs_register(&mdeVfs, 0) == SQLITE_OK;
  }
  sqlite3_mutex_leave(mutex);
  return registered ? mdeVfs.zName : NULL;
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

/*
** The transactions of the functions. Each function runs in a transaction of its own (of the b-tree layer, or of SQL
** for the ones changing the schema), unless the transaction of a session is open: it runs in that one then, which ends
** by mde_commit or mde_abort, and a failure of the function leaves it to be aborted.
*/

/* The transaction of the b-tree layer of a function: a read, or a write */
static int Begin(MdeStore *store, int write) {
  return store->transaction ? SQLITE_OK : sqlite3BtreeBeginTrans(store->bt, write, 0);
}

/* The end of the transaction of a write: committed when rc is SQLITE_OK (the error of the commit given), else rolled
** back (rc given) */
static int End(MdeStore *store, int rc) {
  if (store->transaction) return rc;
  if (rc == SQLITE_OK) return sqlite3BtreeCommit(store->bt);
  sqlite3BtreeRollback(store->bt, SQLITE_OK, 0);
  return rc;
}

/* The end of the transaction of a read */
static void EndRead(MdeStore *store) {
  if (!store->transaction) sqlite3BtreeCommit(store->bt);
}

static int Exec(MdeStore *store, const char *sql, const char *what);

/* The transaction of SQL of a function changing the schema */
static int BeginSql(MdeStore *store) {
  return store->transaction ? SQLITE_OK : Exec(store, "BEGIN IMMEDIATE", "the catalog");
}

/* The end of the transaction of SQL of a function: committed when rc is SQLITE_OK (the error of the commit given),
** else rolled back (rc given) */
static int EndSql(MdeStore *store, int rc) {
  if (store->transaction) return rc;
  if (rc == SQLITE_OK) rc = Exec(store, "COMMIT", "the catalog");
  if (rc != SQLITE_OK) sqlite3_exec(store->db, "ROLLBACK", 0, 0, 0);
  return rc;
}

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

/* A table of an index of a collection */
static int AddTable(Collection *collection, int64_t index, Pgno root) {
  if (collection->tableCount == collection->tableCapacity) {
    int capacity = collection->tableCapacity ? collection->tableCapacity * 2 : 4;
    int64_t *tables = realloc(collection->tables, sizeof(int64_t) * capacity);
    if (!tables) return SQLITE_NOMEM;
    collection->tables = tables;
    Pgno *roots = realloc(collection->tableRoots, sizeof(Pgno) * capacity);
    if (!roots) return SQLITE_NOMEM;
    collection->tableRoots = roots;
    collection->tableCapacity = capacity;
  }
  collection->tables[collection->tableCount] = index;
  collection->tableRoots[collection->tableCount++] = root;
  return SQLITE_OK;
}

/* The root page of a table of a collection: the one of an index, or its own (0); 0 when there is none */
static Pgno RootOf(const Collection *collection, int64_t index) {
  if (index == 0) return collection->root;
  for (int i = 0; i < collection->tableCount; i++)
    if (collection->tables[i] == index) return collection->tableRoots[i];
  return 0;
}

static void FreeCollection(Collection *collection) {
  free(collection->name);
  free(collection->indexes);
  free(collection->tables);
  free(collection->tableRoots);
}

/* The root pages of the tables (precondition 5: after each change of the schema) */
static int LoadRoots(MdeStore *store) {
  sqlite3_stmt *statement;
  int rc = sqlite3_prepare_v2(store->db, "SELECT name, rootpage FROM sqlite_schema WHERE type = 'table'", -1, &statement, 0);
  if (rc != SQLITE_OK) return FailSql(store, rc, "the schema");
  for (int i = 0; i < store->collectionCount; i++) {
    store->collections[i].root = 0;
    store->collections[i].tableCount = 0;
  }
  store->meta = 0;
  while ((rc = sqlite3_step(statement)) == SQLITE_ROW) {
    const char *name = (const char *)sqlite3_column_text(statement, 0);
    Pgno root = (Pgno)sqlite3_column_int64(statement, 1);
    if (strcmp(name, "meta") == 0) {
      store->meta = root;
    } else if (name[0] == 'c') {
      Collection *collection = Find(store, strtoll(name + 1, NULL, 10));
      if (collection) collection->root = root;
    } else if (name[0] == 'i') {
      char *end;
      Collection *collection = Find(store, strtoll(name + 1, &end, 10));
      if (collection && *end == '_' && AddTable(collection, strtoll(end + 1, NULL, 10), root) != SQLITE_OK) {
        sqlite3_finalize(statement);
        return Fail(store, SQLITE_NOMEM, "out of memory");
      }
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
  collection->tables = NULL;
  collection->tableRoots = NULL;
  collection->tableCount = 0;
  collection->tableCapacity = 0;
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
  if (format != MDE_FORMAT) {
    snprintf(store->message, sizeof(store->message), format > 0 && format < MDE_FORMAT
             ? "the file is a database of an earlier format of mongo-embedded (%d, not %d), which is not read"
             : "the file is not a database of mongo-embedded (its format is %d, not %d)", format, MDE_FORMAT);
    return SQLITE_CORRUPT;
  }
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

/* The frames of the WAL after a commit of SQL (a commit of the b-tree layer calls no hook: precondition 4) */
static int WalHook(void *context, sqlite3 *db, const char *name, int frames) {
  (void)db;
  (void)name;
  ((MdeStore *)context)->frames = frames;
  return SQLITE_OK;
}

/* The documents of each collection counted (the connection before did not close): the counts stay to be written */
static int Recount(MdeStore *store) {
  int rc = Begin(store, 0);
  if (rc != SQLITE_OK) return FailSql(store, rc, "the counts");
  for (int i = 0; i < store->collectionCount && rc == SQLITE_OK; i++) {
    i64 count = 0;
    OpenCursor(store, store->cursor, store->collections[i].root, 0);
    rc = sqlite3BtreeCount(store->db, store->cursor, &count);
    sqlite3BtreeCloseCursor(store->cursor);
    store->collections[i].count = count;
  }
  EndRead(store);
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
  int rc = sqlite3_open_v2(file, &store->db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_NOMUTEX, MdeVfs());
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
           "PRAGMA cache_size = -%lld; PRAGMA mmap_size = %lld; PRAGMA fullfsync = %d; PRAGMA journal_size_limit = 67108864;",
           options->sync == MDE_SYNC_ALWAYS ? "FULL" : "NORMAL", (long long)(options->cacheBytes / 1024 > 0 ? options->cacheBytes / 1024 : 1),
           (long long)options->mmapBytes, options->sync == MDE_SYNC_ALWAYS ? 1 : 0);
  rc = Exec(store, pragmas, "the settings");
  if (rc == SQLITE_OK && !options->checkpoints) {
    rc = Exec(store,
              "CREATE TABLE IF NOT EXISTS meta(k BLOB PRIMARY KEY, v BLOB) WITHOUT ROWID;"
              "INSERT OR IGNORE INTO meta(k, v) VALUES (x'66', x'00000002'), (x'6e', x'0000000000000001');",
              "the catalog");
    if (rc == SQLITE_OK) rc = LoadCatalog(store);
    if (rc == SQLITE_OK) {
      sqlite3_wal_hook(store->db, WalHook, store);
      store->bt = store->db->aDb[0].pBt;

      store->info = sqlite3KeyInfoAlloc(store->db, 1, 1);
      store->probe = store->info ? sqlite3VdbeAllocUnpackedRecord(store->info) : NULL;
      store->cursor = sqlite3MallocZero(sqlite3BtreeCursorSize());
      store->metaCursor = sqlite3MallocZero(sqlite3BtreeCursorSize());
      store->entryCursor = sqlite3MallocZero(sqlite3BtreeCursorSize());
      if (!store->probe || !store->cursor || !store->metaCursor || !store->entryCursor) rc = Fail(store, SQLITE_NOMEM, "out of memory");
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
  sqlite3_free(store->entryCursor);
  if (store->probe) sqlite3DbFree(store->db, store->probe);
  if (store->info) sqlite3KeyInfoUnref(store->info);
  sqlite3_close(store->db);
  for (int i = 0; i < store->collectionCount; i++) FreeCollection(&store->collections[i]);
  free(store->collections);
  free(store->record);
  free(store->payload);
  mde_buffer_free(&store->entryValue);
  free(store);
}

int mde_collections(MdeStore *store, MdeBuffer *out) {
  for (int i = 0; i < store->collectionCount; i++) {
    const Collection *collection = &store->collections[i];
    uint32_t length = (uint32_t)strlen(collection->name);
    uint32_t indexesSize = (uint32_t)collection->indexesSize;
    uint32_t tableCount = (uint32_t)collection->tableCount;
    if (!Append(out, &length, 4) || !Append(out, collection->name, length) || !Append(out, &collection->id, 8) ||
        !Append(out, &collection->count, 8) || !Append(out, &indexesSize, 4) || !Append(out, collection->indexes, indexesSize) ||
        !Append(out, &tableCount, 4) || !Append(out, collection->tables, sizeof(int64_t) * tableCount))
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
  int rc = BeginSql(store);
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
    return EndSql(store, rc);
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
  rc = EndSql(store, rc);
  if (rc != SQLITE_OK) return rc;
  rc = AddCollection(store, next, name, length);
  if (rc != SQLITE_OK) return Fail(store, rc, "out of memory");
  *id = next;
  return LoadRoots(store);
}

/* The key of the row of the name of a collection in the catalog ('c' + its name), malloc'ed: its size in *size */
static uint8_t *NameKey(const char *name, int *size) {
  int length = (int)strlen(name);
  uint8_t *key = malloc((size_t)length + 1);
  if (!key) return NULL;
  key[0] = 'c';
  memcpy(key + 1, name, length);
  *size = length + 1;
  return key;
}

/* The tables of a collection and its rows of the catalog dropped, in the transaction open */
static int DropInTransaction(MdeStore *store, const Collection *collection) {
  int nameSize = 0;
  uint8_t *nameKey = NameKey(collection->name, &nameSize);
  if (!nameKey) return Fail(store, SQLITE_NOMEM, "out of memory");
  uint8_t countKey[9], indexesKey[9];
  countKey[0] = 'k';
  PutBigEndian(countKey + 1, collection->id);
  indexesKey[0] = 'x';
  PutBigEndian(indexesKey + 1, collection->id);
  char sql[64];
  snprintf(sql, sizeof(sql), "DROP TABLE c%lld", (long long)collection->id);
  int rc = Exec(store, sql, "the table of a collection");
  for (int i = 0; i < collection->tableCount && rc == SQLITE_OK; i++) {
    snprintf(sql, sizeof(sql), "DROP TABLE i%lld_%lld", (long long)collection->id, (long long)collection->tables[i]);
    rc = Exec(store, sql, "the table of an index");
  }
  if (rc == SQLITE_OK) {
    const uint8_t *blobs[] = {nameKey, countKey, indexesKey};
    const int sizes[] = {nameSize, 9, 9};
    rc = RunBlobs(store, "DELETE FROM meta WHERE k = ?1 OR k = ?2 OR k = ?3", blobs, sizes, 3);
  }
  free(nameKey);
  return rc;
}

/* A collection taken out of the ones of the store (dropped) */
static void Forget(MdeStore *store, Collection *collection) {
  FreeCollection(collection);
  *collection = store->collections[--store->collectionCount];
}

int mde_drop_collection(MdeStore *store, int64_t id) {
  Collection *collection = Find(store, id);
  if (!collection) return Fail(store, MDE_NO_COLLECTION, "no collection of this id");
  int rc = BeginSql(store);
  if (rc == SQLITE_OK) rc = EndSql(store, DropInTransaction(store, collection));
  if (rc != SQLITE_OK) return rc;
  Forget(store, collection);
  return LoadRoots(store);
}

int mde_rename_collection(MdeStore *store, int64_t id, const char *name, int64_t dropped) {
  Collection *collection = Find(store, id);
  if (!collection) return Fail(store, MDE_NO_COLLECTION, "no collection of this id");
  Collection *target = dropped ? Find(store, dropped) : NULL;
  if (dropped && !target) return Fail(store, MDE_NO_COLLECTION, "no collection of this id");
  char *renamed = malloc(strlen(name) + 1);
  if (!renamed) return Fail(store, SQLITE_NOMEM, "out of memory");
  strcpy(renamed, name);
  int oldSize = 0, newSize = 0;
  uint8_t *oldKey = NameKey(collection->name, &oldSize);
  uint8_t *newKey = NameKey(name, &newSize);
  uint8_t idValue[8];
  PutBigEndian(idValue, id);
  const int began = !oldKey || !newKey ? Fail(store, SQLITE_NOMEM, "out of memory") : BeginSql(store);
  int rc = began;
  if (rc == SQLITE_OK && target) rc = DropInTransaction(store, target);
  if (rc == SQLITE_OK) {
    const uint8_t *blobs[] = {oldKey};
    const int sizes[] = {oldSize};
    rc = RunBlobs(store, "DELETE FROM meta WHERE k = ?1", blobs, sizes, 1);
  }
  if (rc == SQLITE_OK) {
    const uint8_t *blobs[] = {newKey, idValue};
    const int sizes[] = {newSize, 8};
    rc = RunBlobs(store, "INSERT INTO meta(k, v) VALUES (?1, ?2)", blobs, sizes, 2);
  }
  if (began == SQLITE_OK) rc = EndSql(store, rc);
  free(oldKey);
  free(newKey);
  if (rc != SQLITE_OK) {
    free(renamed);
    return rc;
  }
  /* The collection found again by its id: the one dropped may have taken its place in the array */
  if (target) Forget(store, target);
  collection = Find(store, id);
  free(collection->name);
  collection->name = renamed;
  return LoadRoots(store);
}

int mde_count(MdeStore *store, int64_t id, int64_t *count) {
  Collection *collection = Find(store, id);
  if (!collection) return Fail(store, MDE_NO_COLLECTION, "no collection of this id");
  *count = collection->count;
  return SQLITE_OK;
}

/* The definitions of the indexes of a collection written in the transaction open (size 0: deleted) */
static int PutDefinitions(MdeStore *store, int64_t id, const uint8_t *data, int size) {
  uint8_t key[9];
  key[0] = 'x';
  PutBigEndian(key + 1, id);
  OpenCursor(store, store->metaCursor, store->meta, 1);
  int rc;
  if (size > 0) {
    rc = Put(store, store->metaCursor, key, 9, data, size);
  } else {
    int res = 0;
    rc = Seek(store, store->metaCursor, key, 9, &res);
    if (rc == SQLITE_OK && res == 0) rc = sqlite3BtreeDelete(store->metaCursor, 0);
  }
  sqlite3BtreeCloseCursor(store->metaCursor);
  return rc;
}

/* The copy of the definitions of the indexes of a collection replaced, once they are written */
static void KeepDefinitions(Collection *collection, uint8_t *copy, int size) {
  free(collection->indexes);
  collection->indexes = copy;
  collection->indexesSize = size;
}

/* A copy of definitions (NULL for none), *failed when it could not be made */
static uint8_t *CopyOf(const uint8_t *data, int size, int *failed) {
  *failed = 0;
  if (size <= 0) return NULL;
  uint8_t *copy = malloc((size_t)size);
  if (!copy) *failed = 1;
  else memcpy(copy, data, size);
  return copy;
}

int mde_set_indexes(MdeStore *store, int64_t id, const uint8_t *data, int size) {
  Collection *collection = Find(store, id);
  if (!collection) return Fail(store, MDE_NO_COLLECTION, "no collection of this id");
  int failed;
  uint8_t *copy = CopyOf(data, size, &failed);
  if (failed) return Fail(store, SQLITE_NOMEM, "out of memory");
  int rc = Begin(store, 1);
  if (rc == SQLITE_OK) rc = End(store, PutDefinitions(store, id, data, size));
  if (rc != SQLITE_OK) {
    free(copy);
    return FailSql(store, rc, "the indexes of a collection");
  }
  KeepDefinitions(collection, copy, size);
  store->frames = sqlite3PagerWalCallback(sqlite3BtreePager(store->bt));
  return SQLITE_OK;
}

/* The next id of the catalog (of a collection or of an index), counted up, in the transaction open */
static int NextId(MdeStore *store, int64_t *next) {
  sqlite3_stmt *statement;
  *next = 0;
  int rc = sqlite3_prepare_v2(store->db, "SELECT v FROM meta WHERE k = x'6e'", -1, &statement, 0);
  if (rc != SQLITE_OK) return FailSql(store, rc, "the catalog");
  if (sqlite3_step(statement) == SQLITE_ROW && sqlite3_column_bytes(statement, 0) == 8) *next = BigEndian(sqlite3_column_blob(statement, 0));
  sqlite3_finalize(statement);
  if (*next <= 0) return Fail(store, SQLITE_CORRUPT, "the catalog has no next id");
  uint8_t value[8];
  PutBigEndian(value, *next + 1);
  const uint8_t *blobs[] = {value};
  const int sizes[] = {8};
  return RunBlobs(store, "UPDATE meta SET v = ?1 WHERE k = x'6e'", blobs, sizes, 1);
}

int mde_create_index(MdeStore *store, int64_t id, int64_t *index) {
  Collection *collection = Find(store, id);
  if (!collection) return Fail(store, MDE_NO_COLLECTION, "no collection of this id");
  int rc = BeginSql(store);
  if (rc != SQLITE_OK) return rc;
  int64_t next = 0;
  rc = NextId(store, &next);
  if (rc == SQLITE_OK) {
    char sql[128];
    snprintf(sql, sizeof(sql), "CREATE TABLE i%lld_%lld(k BLOB PRIMARY KEY, v BLOB) WITHOUT ROWID", (long long)id, (long long)next);
    rc = Exec(store, sql, "the table of an index");
  }
  rc = EndSql(store, rc);
  if (rc != SQLITE_OK) return rc;
  *index = next;
  return LoadRoots(store);
}

int mde_drop_index(MdeStore *store, int64_t id, int64_t index) {
  Collection *collection = Find(store, id);
  if (!collection) return Fail(store, MDE_NO_COLLECTION, "no collection of this id");
  if (index == 0 || !RootOf(collection, index)) return SQLITE_OK;
  char sql[64];
  snprintf(sql, sizeof(sql), "DROP TABLE i%lld_%lld", (long long)id, (long long)index);
  int rc = Exec(store, sql, "the table of an index");
  if (rc != SQLITE_OK) return rc;
  return LoadRoots(store);
}

/* An entry of an index written (removed or inserted) in the transaction open: *duplicate when its key is unique and
** another document holds it */
static int PutEntry(MdeStore *store, const Collection *collection, int64_t index, int unique, int remove, const uint8_t *key,
                    int keySize, const uint8_t *value, int valueSize, int *duplicate) {
  *duplicate = 0;
  Pgno root = RootOf(collection, index);
  if (!root || index == 0) return Fail(store, SQLITE_CORRUPT, "an index of the collection has no table");
  OpenCursor(store, store->entryCursor, root, 1);
  int res = 0;
  int rc = Seek(store, store->entryCursor, key, keySize, &res);
  if (rc == SQLITE_OK) {
    if (remove) {
      if (res == 0) rc = sqlite3BtreeDelete(store->entryCursor, 0);
    } else if (res != 0) {
      rc = Insert(store, store->entryCursor, key, keySize, value, valueSize, res);
    } else if (unique) {
      /* The key held: by another document, a duplicate */
      u32 size;
      const uint8_t *payload = PayloadOf(store, store->entryCursor, &size);
      int length = 0;
      int offset = payload ? Field(payload, (int)size, 1, &length) : -1;
      if (!payload) rc = Fail(store, SQLITE_NOMEM, "out of memory");
      else if (offset < 0) rc = Fail(store, SQLITE_CORRUPT, "an entry of an index is not a key");
      else if (length != valueSize || memcmp(payload + offset, value, length) != 0) *duplicate = 1;
    }
  }
  sqlite3BtreeCloseCursor(store->entryCursor);
  return rc;
}

int mde_write(MdeStore *store, int64_t id, const MdeChange *changes, int count, const MdeEntry *entries, int entryCount,
              const uint8_t *definitions, int definitionsSize, int *failed, int64_t *failedIndex) {
  *failed = -1;
  *failedIndex = -1;
  store->message[0] = 0;
  Collection *collection = Find(store, id);
  if (!collection) return Fail(store, MDE_NO_COLLECTION, "no collection of this id");
  int copyFailed;
  uint8_t *copy = definitions ? CopyOf(definitions, definitionsSize, &copyFailed) : NULL;
  if (definitions && copyFailed) return Fail(store, SQLITE_NOMEM, "out of memory");
  int rc = Begin(store, 1);
  if (rc != SQLITE_OK) {
    free(copy);
    return FailSql(store, rc, "a write");
  }
  OpenCursor(store, store->cursor, collection->root, 1);
  int64_t delta = 0;
  int entry = 0, duplicate = 0;
  for (int i = 0; i < count && rc == SQLITE_OK; i++) {
    const MdeChange *change = &changes[i];
    /* The entries of the change: removed before it, inserted after it */
    int first = entry;
    while (entry < entryCount && entries[entry].change == i) entry++;
    for (int k = first; k < entry && rc == SQLITE_OK; k++)
      if (entries[k].remove)
        rc = PutEntry(store, collection, entries[k].index, entries[k].unique, 1, entries[k].key, entries[k].keySize,
                      entries[k].value, entries[k].valueSize, &duplicate);
    if (rc != SQLITE_OK) break;
    int res = 0;
    rc = Seek(store, store->cursor, change->key, change->keySize, &res);
    if (rc != SQLITE_OK) break;
    switch (change->kind) {
      case MDE_INSERT:
        if (res == 0) {
          rc = MDE_DUPLICATE_KEY;
          *failed = i;
          *failedIndex = 0;
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
    for (int k = first; k < entry && rc == SQLITE_OK; k++) {
      if (entries[k].remove) continue;
      rc = PutEntry(store, collection, entries[k].index, entries[k].unique, 0, entries[k].key, entries[k].keySize,
                    entries[k].value, entries[k].valueSize, &duplicate);
      if (rc == SQLITE_OK && duplicate) {
        rc = MDE_DUPLICATE_KEY;
        *failed = i;
        *failedIndex = entries[k].index;
      }
    }
  }
  sqlite3BtreeCloseCursor(store->cursor);
  if (rc == SQLITE_OK && definitions) rc = PutDefinitions(store, id, definitions, definitionsSize);
  /* The first write of the connection: the counts not written from now on */
  if (rc == SQLITE_OK && delta != 0 && !store->countsDirty) {
    const uint8_t key[1] = {'d'}, value[1] = {1};
    OpenCursor(store, store->metaCursor, store->meta, 1);
    rc = Put(store, store->metaCursor, key, 1, value, 1);
    sqlite3BtreeCloseCursor(store->metaCursor);
  }
  rc = End(store, rc);
  if (rc != SQLITE_OK) {
    if (rc == MDE_DUPLICATE_KEY) Fail(store, rc, "duplicate key");
    else if (rc == MDE_MISSING) Fail(store, rc, "the document replaced is not there");
    else if (!store->message[0]) FailSql(store, rc, "a write");
    free(copy);
    return rc;
  }
  if (definitions) KeepDefinitions(collection, copy, definitionsSize);
  collection->count += delta;
  if (delta != 0) store->countsDirty = 1;
  /* Precondition 4: the frames of the WAL for the checkpoints */
  store->frames = sqlite3PagerWalCallback(sqlite3BtreePager(store->bt));
  return SQLITE_OK;
}

int mde_write_index(MdeStore *store, int64_t id, int64_t index, int unique, const uint8_t *const *keys, const int *keySizes,
                    const uint8_t *const *values, const int *valueSizes, int count, int *failed) {
  *failed = -1;
  store->message[0] = 0;
  Collection *collection = Find(store, id);
  if (!collection) return Fail(store, MDE_NO_COLLECTION, "no collection of this id");
  int rc = Begin(store, 1);
  if (rc != SQLITE_OK) return FailSql(store, rc, "a write of an index");
  int duplicate = 0;
  for (int i = 0; i < count && rc == SQLITE_OK; i++) {
    rc = PutEntry(store, collection, index, unique, 0, keys[i], keySizes[i], values[i], valueSizes[i], &duplicate);
    if (rc == SQLITE_OK && duplicate) {
      rc = Fail(store, MDE_DUPLICATE_KEY, "duplicate key");
      *failed = i;
    }
  }
  rc = End(store, rc);
  if (rc != SQLITE_OK) {
    if (!store->message[0]) FailSql(store, rc, "a write of an index");
    return rc;
  }
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
  int rc = Begin(store, 0);
  if (rc != SQLITE_OK) return FailSql(store, rc, "a read");
  OpenCursor(store, store->cursor, collection->root, 0);
  for (int i = 0; i < count && rc == SQLITE_OK; i++) {
    int res = 0;
    offsets[i] = -1;
    rc = Seek(store, store->cursor, keys[i], keySizes[i], &res);
    if (rc == SQLITE_OK && res == 0) offsets[i] = AppendDocument(store, store->cursor, out, &rc);
  }
  sqlite3BtreeCloseCursor(store->cursor);
  EndRead(store);
  return rc;
}

int mde_scan(MdeStore *store, int64_t id, const uint8_t *after, int afterSize, int maxDocuments, size_t maxBytes,
             int maxScanned, MdeFilter filter, void *context, MdeBuffer *out, MdeBuffer *last, int *done) {
  *done = 1;
  Collection *collection = Find(store, id);
  if (!collection) return SQLITE_OK;
  int rc = Begin(store, 0);
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
  EndRead(store);
  if (rc != SQLITE_OK && store->message[0] == 0) FailSql(store, rc, "a read");
  return rc;
}

/* The comparison of two keys as bytes, the shorter one first when one starts the other (as SQLite compares blobs) */
static int CompareKeys(const uint8_t *a, int aSize, const uint8_t *b, int bSize) {
  int c = memcmp(a, b, (size_t)(aSize < bSize ? aSize : bSize));
  return c ? c : aSize - bSize;
}

/* Whether a key is past a range, in the direction of a walk */
static int PastRange(const MdeRange *range, const uint8_t *key, int size, int reverse) {
  if (!reverse) {
    if (!range->upper) return 0;
    int c = CompareKeys(key, size, range->upper, range->upperSize);
    return c > 0 || (c == 0 && !range->upperInclusive);
  }
  if (!range->lower) return 0;
  int c = CompareKeys(key, size, range->lower, range->lowerSize);
  return c < 0 || (c == 0 && !range->lowerInclusive);
}

/* Moves a cursor to the first entry of a range in the direction of a walk (the first one after a key, when given):
** *empty when it has none. The entries after it in the walk may be past the range (PastRange) */
static int StartRange(MdeStore *store, BtCursor *cursor, const MdeRange *range, int reverse, const uint8_t *after,
                      int afterSize, int *empty) {
  *empty = 0;
  const uint8_t *from = after ? after : reverse ? range->upper : range->lower;
  int fromSize = after ? afterSize : reverse ? range->upperSize : range->lowerSize;
  int inclusive = after ? 0 : reverse ? range->upperInclusive : range->lowerInclusive;
  if (!from) return reverse ? sqlite3BtreeLast(cursor, empty) : sqlite3BtreeFirst(cursor, empty);
  int res = 0;
  int rc = Seek(store, cursor, from, fromSize, &res);
  if (rc != SQLITE_OK) return rc;
  if (sqlite3BtreeEof(cursor)) {
    *empty = 1;
    return SQLITE_OK;
  }
  /* The cursor on the key (res 0), on the one before it (res < 0) or after it (res > 0) */
  if (reverse ? res > 0 || (res == 0 && !inclusive) : res < 0 || (res == 0 && !inclusive)) {
    rc = reverse ? sqlite3BtreePrevious(cursor, 0) : sqlite3BtreeNext(cursor, 0);
    if (rc == SQLITE_DONE) {
      rc = SQLITE_OK;
      *empty = 1;
    }
  }
  return rc;
}

int mde_scan_range(MdeStore *store, int64_t id, int64_t index, const MdeRange *ranges, int rangeCount, int reverse,
                   int *range, const uint8_t *after, int afterSize, int keysOnly, int maxDocuments, size_t maxBytes,
                   int maxScanned, MdeFilter filter, void *context, MdeBuffer *out, MdeBuffer *last, int *done) {
  *done = 1;
  store->message[0] = 0;
  Collection *collection = Find(store, id);
  if (!collection) return SQLITE_OK;
  Pgno root = RootOf(collection, index);
  if (!root) return Fail(store, SQLITE_CORRUPT, "an index of the collection has no table");
  int rc = Begin(store, 0);
  if (rc != SQLITE_OK) return FailSql(store, rc, "a read");
  /* The walk on the table (entryCursor), the documents of an index read from the collection (cursor) */
  OpenCursor(store, store->entryCursor, root, 0);
  if (index != 0) OpenCursor(store, store->cursor, collection->root, 0);
  const MdeRange all = {NULL, 0, 0, NULL, 0, 0};
  const int count = rangeCount ? rangeCount : 1;
  int given = 0, scanned = 0, stopped = 0;
  for (int r = *range; r < count && rc == SQLITE_OK && !stopped; r++) {
    const MdeRange *current = rangeCount ? &ranges[reverse ? count - 1 - r : r] : &all;
    int empty = 0;
    rc = StartRange(store, store->entryCursor, current, reverse, r == *range ? after : NULL, afterSize, &empty);
    while (rc == SQLITE_OK && !empty) {
      u32 size;
      const uint8_t *payload = PayloadOf(store, store->entryCursor, &size);
      if (!payload) {
        rc = Fail(store, SQLITE_NOMEM, "out of memory");
        break;
      }
      int keyLength, valueLength;
      int keyOffset = Field(payload, (int)size, 0, &keyLength);
      int valueOffset = Field(payload, (int)size, 1, &valueLength);
      if (keyOffset < 0 || valueOffset < 0) {
        rc = Fail(store, SQLITE_CORRUPT, "a record of a table is not a key and a value");
        break;
      }
      if (PastRange(current, payload + keyOffset, keyLength, reverse)) break;
      scanned++;
      /* The key, then the value of the entry kept: the payload of a document read may replace them */
      last->size = 0;
      if (!Append(last, payload + keyOffset, keyLength)) {
        rc = Fail(store, SQLITE_NOMEM, "out of memory");
        break;
      }
      if (index == 0) {
        /* The table of the collection: its key the one of the _id, its value the document */
        if (keysOnly) {
          uint32_t length = (uint32_t)keyLength;
          if (!Append(out, &length, 4) || !Append(out, payload + keyOffset, keyLength)) rc = Fail(store, SQLITE_NOMEM, "out of memory");
          else given++;
        } else if (!filter || filter(payload + valueOffset, (size_t)valueLength, context)) {
          if (!Append(out, payload + valueOffset, valueLength)) rc = Fail(store, SQLITE_NOMEM, "out of memory");
          else given++;
        }
      } else {
        store->entryValue.size = 0;
        if (!Append(&store->entryValue, payload + valueOffset, valueLength)) {
          rc = Fail(store, SQLITE_NOMEM, "out of memory");
          break;
        }
        if (keysOnly) {
          uint32_t length = (uint32_t)valueLength;
          if (!Append(out, &length, 4) || !Append(out, store->entryValue.data, store->entryValue.size)) rc = Fail(store, SQLITE_NOMEM, "out of memory");
          else given++;
        } else {
          int res = 0;
          rc = Seek(store, store->cursor, store->entryValue.data, (int)store->entryValue.size, &res);
          if (rc == SQLITE_OK && res == 0) {
            u32 documentSize;
            const uint8_t *document = PayloadOf(store, store->cursor, &documentSize);
            int length;
            int offset = document ? Field(document, (int)documentSize, 1, &length) : -1;
            if (!document) rc = Fail(store, SQLITE_NOMEM, "out of memory");
            else if (offset < 0) rc = Fail(store, SQLITE_CORRUPT, "a record of a collection is not a document");
            else if (!filter || filter(document + offset, (size_t)length, context)) {
              if (!Append(out, document + offset, length)) rc = Fail(store, SQLITE_NOMEM, "out of memory");
              else given++;
            }
          }
        }
      }
      if (rc != SQLITE_OK) break;
      rc = reverse ? sqlite3BtreePrevious(store->entryCursor, 0) : sqlite3BtreeNext(store->entryCursor, 0);
      if (rc == SQLITE_DONE) {
        rc = SQLITE_OK;
        break;
      }
      if (rc != SQLITE_OK) break;
      if (given >= maxDocuments || out->size >= maxBytes || scanned >= maxScanned) {
        *range = r;
        *done = 0;
        stopped = 1;
        break;
      }
    }
  }
  sqlite3BtreeCloseCursor(store->entryCursor);
  if (index != 0) sqlite3BtreeCloseCursor(store->cursor);
  EndRead(store);
  if (rc != SQLITE_OK && !store->message[0]) FailSql(store, rc, "a read");
  return rc;
}

int mde_count_range(MdeStore *store, int64_t id, int64_t index, const MdeRange *ranges, int rangeCount, int64_t *count) {
  *count = 0;
  store->message[0] = 0;
  Collection *collection = Find(store, id);
  if (!collection) return SQLITE_OK;
  Pgno root = RootOf(collection, index);
  if (!root) return Fail(store, SQLITE_CORRUPT, "an index of the collection has no table");
  int rc = Begin(store, 0);
  if (rc != SQLITE_OK) return FailSql(store, rc, "a read");
  OpenCursor(store, store->entryCursor, root, 0);
  const MdeRange all = {NULL, 0, 0, NULL, 0, 0};
  const int ranged = rangeCount ? rangeCount : 1;
  for (int r = 0; r < ranged && rc == SQLITE_OK; r++) {
    const MdeRange *current = rangeCount ? &ranges[r] : &all;
    int empty = 0;
    rc = StartRange(store, store->entryCursor, current, 0, NULL, 0, &empty);
    while (rc == SQLITE_OK && !empty) {
      u32 size;
      const uint8_t *payload = PayloadOf(store, store->entryCursor, &size);
      int keyLength = 0;
      int keyOffset = payload ? Field(payload, (int)size, 0, &keyLength) : -1;
      if (!payload) rc = Fail(store, SQLITE_NOMEM, "out of memory");
      else if (keyOffset < 0) rc = Fail(store, SQLITE_CORRUPT, "a record of a table is not a key and a value");
      if (rc != SQLITE_OK || PastRange(current, payload + keyOffset, keyLength, 0)) break;
      (*count)++;
      rc = sqlite3BtreeNext(store->entryCursor, 0);
      if (rc == SQLITE_DONE) {
        rc = SQLITE_OK;
        break;
      }
    }
  }
  sqlite3BtreeCloseCursor(store->entryCursor);
  EndRead(store);
  if (rc != SQLITE_OK && !store->message[0]) FailSql(store, rc, "a read");
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
