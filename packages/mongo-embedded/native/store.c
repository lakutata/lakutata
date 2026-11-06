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
** of a collection, 'k' + its id the count of its documents, 'u' + its id its UUID (16 bytes), 'x' + its id the
** definitions of its indexes (BSON, as the client writes them; the ids and the counts as 8 bytes, big endian), 'g' the
** generation of the oplog (the last opening), 'i' the UUID of the database, 'o' the bytes of the oplog, 'd' while the
** counts (and the bytes of the oplog) are not written. The counts
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

/* The format of the file: 2 since the keys of the _id are the ones of the indexes (ordered), 3 since the UUID of the
** collections and the oplog of the change streams */
#define MDE_FORMAT 3

/* The bytes the oplog may hold beyond its limit before its oldest events are deleted: its deletions made in batches */
#define MDE_OPLOG_SLACK (1024 * 1024)

typedef struct Collection {
  int64_t id;
  Pgno root;
  int64_t count;
  uint8_t uuid[16];
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
  /* The name it opened: the path of its file, or the name of a database in memory */
  char *file;
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
  /* The transaction of a session open (mde_begin), and the collections as they were when it began (their counts, the
  ** definitions of their indexes, whether the counts were written, the state of the oplog), restored by its abort */
  int transaction;
  Collection *saved;
  int savedCount;
  int savedDirty;
  int64_t savedNextSeq;
  int64_t savedOplogBytes;
  /* The oplog: its root page, the generation of this opening, the sequence of its next event, its bytes and the most
  ** of them (0: no event written); the events queued for the next commit, the ones it appended and their bytes; the
  ** mark of the counts written by it (the row 'd'); the UUID of the database */
  Pgno oplog;
  int64_t generation;
  int64_t nextSeq;
  int64_t oplogBytes;
  int64_t oplogLimit;
  MdeBuffer queued;
  int queuedCount;
  int64_t pendingSeq;
  int64_t pendingBytes;
  int marking;
  uint8_t database[16];
  /* An opening keeping no events: the events lost when it opened, as the row 'l' tells them (zeros when the database
  ** had none: else the start of its generation, the events of the openings before deleted, and the cluster time of the
  ** last one), and the cluster time of the last event deleted (*hasOpenTime) */
  uint8_t openLost[24];
  uint8_t openTime[8];
  int hasOpenTime;
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

typedef struct MemoryNode MemoryNode;

typedef struct MdeFile {
  sqlite3_file base;
  /* The file of the default VFS, allocated after this one; NULL for a file in memory */
  sqlite3_file *real;
  /* A file in memory: its content, the lock this handle holds, the locks it holds on the shared memory (a bit for each
  ** lock) and whether it maps it */
  MemoryNode *memory;
  int lock;
  unsigned shmShared;
  unsigned shmExclusive;
  int shmMapped;
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

/*
** The files of the databases in memory. A database in memory is opened under a name of its own (MDE_MEMORY and a
** number, mde_open_memory), which the VFS keeps in memory with its WAL and the memory its connections share (the index
** of the WAL): two connections to it (the one writing and the one reading beside the transaction of a session) share
** them, as the connections to a file share its file. The locks of the files and of the shared memory are kept in
** memory too, between the connections of this process (each file belongs to one database, which no other process
** opens). A file is freed when its last handle closes: the database once its last connection is closed.
*/
#define MDE_MEMORY "mde-memory:"

struct MemoryNode {
  MemoryNode *next;
  char *name;
  uint8_t *data;
  sqlite3_int64 size;
  size_t capacity;
  int handles;
  /* The handles holding a shared lock; the ones holding the reserved, pending and exclusive locks */
  int shared;
  MdeFile *reserved;
  MdeFile *pending;
  MdeFile *exclusive;
  /* The shared memory: its regions, the handles mapping it, and its locks: the handles holding each one shared, the
  ** one holding it exclusive */
  volatile void **regions;
  int regionCount;
  int mapped;
  int shmShared[SQLITE_SHM_NLOCK];
  MdeFile *shmExclusive[SQLITE_SHM_NLOCK];
};

/* The files in memory not deleted, and the mutex of all of them */
static MemoryNode *memoryFiles;
static sqlite3_mutex *memoryMutex;
static sqlite3_int64 memoryNames;

static int IsMemory(const char *name) { return name && strncmp(name, MDE_MEMORY, sizeof(MDE_MEMORY) - 1) == 0; }

static MemoryNode *FindMemory(const char *name) {
  for (MemoryNode *node = memoryFiles; node; node = node->next)
    if (strcmp(node->name, name) == 0) return node;
  return NULL;
}

/* A file taken out of the files not deleted */
static void Unlink(MemoryNode *node) {
  for (MemoryNode **at = &memoryFiles; *at; at = &(*at)->next) {
    if (*at == node) {
      *at = node->next;
      return;
    }
  }
}

static void FreeMemory(MemoryNode *node) {
  for (int i = 0; i < node->regionCount; i++) free((void *)node->regions[i]);
  free((void *)node->regions);
  free(node->data);
  free(node->name);
  free(node);
}

static int MemoryRead(sqlite3_file *base, void *data, int amount, sqlite3_int64 offset) {
  MemoryNode *node = ((MdeFile *)base)->memory;
  sqlite3_mutex_enter(memoryMutex);
  sqlite3_int64 available = node->size > offset ? node->size - offset : 0;
  int copied = available < amount ? (int)available : amount;
  if (copied > 0) memcpy(data, node->data + offset, (size_t)copied);
  sqlite3_mutex_leave(memoryMutex);
  if (copied == amount) return SQLITE_OK;
  memset((uint8_t *)data + copied, 0, (size_t)(amount - copied));
  return SQLITE_IOERR_SHORT_READ;
}

static int MemoryWrite(sqlite3_file *base, const void *data, int amount, sqlite3_int64 offset) {
  MemoryNode *node = ((MdeFile *)base)->memory;
  int rc = SQLITE_OK;
  sqlite3_mutex_enter(memoryMutex);
  size_t end = (size_t)offset + (size_t)amount;
  if (!Reserve(&node->data, &node->capacity, end)) {
    rc = SQLITE_IOERR_NOMEM;
  } else {
    if (offset > node->size) memset(node->data + node->size, 0, (size_t)(offset - node->size));
    memcpy(node->data + offset, data, (size_t)amount);
    if ((sqlite3_int64)end > node->size) node->size = (sqlite3_int64)end;
  }
  sqlite3_mutex_leave(memoryMutex);
  return rc;
}

static int MemoryTruncate(sqlite3_file *base, sqlite3_int64 size) {
  MemoryNode *node = ((MdeFile *)base)->memory;
  sqlite3_mutex_enter(memoryMutex);
  if (size < node->size) node->size = size;
  sqlite3_mutex_leave(memoryMutex);
  return SQLITE_OK;
}

static int MemorySync(sqlite3_file *base, int flags) {
  (void)base;
  (void)flags;
  return SQLITE_OK;
}

static int MemoryFileSize(sqlite3_file *base, sqlite3_int64 *size) {
  MemoryNode *node = ((MdeFile *)base)->memory;
  sqlite3_mutex_enter(memoryMutex);
  *size = node->size;
  sqlite3_mutex_leave(memoryMutex);
  return SQLITE_OK;
}

/* Whether a lock is held by another handle than file */
static int Other(const MdeFile *holder, const MdeFile *file) { return holder && holder != file; }

/* The locks of SQLite on a file (shared, reserved, pending, exclusive), as the default VFS takes them */
static int MemoryLock(sqlite3_file *base, int level) {
  MdeFile *file = (MdeFile *)base;
  MemoryNode *node = file->memory;
  int rc = SQLITE_OK;
  sqlite3_mutex_enter(memoryMutex);
  if (file->lock < level) {
    if (file->lock == SQLITE_LOCK_NONE) {
      if (Other(node->pending, file) || Other(node->exclusive, file)) {
        rc = SQLITE_BUSY;
      } else {
        node->shared++;
        file->lock = SQLITE_LOCK_SHARED;
      }
    }
    if (rc == SQLITE_OK && level == SQLITE_LOCK_RESERVED) {
      if (Other(node->reserved, file) || Other(node->pending, file) || Other(node->exclusive, file)) {
        rc = SQLITE_BUSY;
      } else {
        node->reserved = file;
        file->lock = SQLITE_LOCK_RESERVED;
      }
    } else if (rc == SQLITE_OK && level == SQLITE_LOCK_EXCLUSIVE) {
      if (Other(node->pending, file) || Other(node->exclusive, file)) {
        rc = SQLITE_BUSY;
      } else {
        /* Pending: no new shared lock, until the other ones are released */
        node->pending = file;
        if (node->shared > 1) {
          file->lock = SQLITE_LOCK_PENDING;
          rc = SQLITE_BUSY;
        } else {
          node->exclusive = file;
          file->lock = SQLITE_LOCK_EXCLUSIVE;
        }
      }
    }
  }
  sqlite3_mutex_leave(memoryMutex);
  return rc;
}

static int MemoryUnlock(sqlite3_file *base, int level) {
  MdeFile *file = (MdeFile *)base;
  MemoryNode *node = file->memory;
  sqlite3_mutex_enter(memoryMutex);
  if (file->lock > level) {
    if (node->reserved == file) node->reserved = NULL;
    if (node->pending == file) node->pending = NULL;
    if (node->exclusive == file) node->exclusive = NULL;
    if (level == SQLITE_LOCK_NONE) node->shared--;
    file->lock = level;
  }
  sqlite3_mutex_leave(memoryMutex);
  return SQLITE_OK;
}

static int MemoryCheckReservedLock(sqlite3_file *base, int *reserved) {
  MemoryNode *node = ((MdeFile *)base)->memory;
  sqlite3_mutex_enter(memoryMutex);
  *reserved = node->reserved || node->pending || node->exclusive;
  sqlite3_mutex_leave(memoryMutex);
  return SQLITE_OK;
}

static int MemoryFileControl(sqlite3_file *base, int op, void *argument) {
  (void)base;
  (void)op;
  (void)argument;
  return SQLITE_NOTFOUND;
}

static int MemorySectorSize(sqlite3_file *base) {
  (void)base;
  return 4096;
}

static int MemoryDeviceCharacteristics(sqlite3_file *base) {
  (void)base;
  return SQLITE_IOCAP_POWERSAFE_OVERWRITE | SQLITE_IOCAP_SAFE_APPEND | SQLITE_IOCAP_SEQUENTIAL;
}

static int MemoryShmMap(sqlite3_file *base, int region, int size, int extend, void volatile **memory) {
  MdeFile *file = (MdeFile *)base;
  MemoryNode *node = file->memory;
  int rc = SQLITE_OK;
  *memory = NULL;
  sqlite3_mutex_enter(memoryMutex);
  if (!file->shmMapped) {
    file->shmMapped = 1;
    node->mapped++;
  }
  if (region >= node->regionCount && extend) {
    volatile void **regions = realloc((void *)node->regions, sizeof(void *) * (size_t)(region + 1));
    if (!regions) {
      rc = SQLITE_IOERR_NOMEM;
    } else {
      node->regions = regions;
      for (; node->regionCount <= region; node->regionCount++) {
        node->regions[node->regionCount] = calloc(1, (size_t)size);
        if (!node->regions[node->regionCount]) {
          rc = SQLITE_IOERR_NOMEM;
          break;
        }
      }
    }
  }
  if (rc == SQLITE_OK && region < node->regionCount) *memory = node->regions[region];
  sqlite3_mutex_leave(memoryMutex);
  return rc;
}

/* The locks of the shared memory released by a handle */
static void ReleaseShm(MdeFile *file, unsigned mask) {
  MemoryNode *node = file->memory;
  for (int i = 0; i < SQLITE_SHM_NLOCK; i++) {
    if (!(mask & (1u << i))) continue;
    if (file->shmShared & (1u << i)) node->shmShared[i]--;
    if (node->shmExclusive[i] == file) node->shmExclusive[i] = NULL;
  }
  file->shmShared &= ~mask;
  file->shmExclusive &= ~mask;
}

static int MemoryShmLock(sqlite3_file *base, int offset, int count, int flags) {
  MdeFile *file = (MdeFile *)base;
  MemoryNode *node = file->memory;
  const unsigned mask = ((1u << (offset + count)) - 1u) & ~((1u << offset) - 1u);
  int rc = SQLITE_OK;
  sqlite3_mutex_enter(memoryMutex);
  if (flags & SQLITE_SHM_UNLOCK) {
    ReleaseShm(file, mask);
  } else if (flags & SQLITE_SHM_SHARED) {
    if (!((file->shmShared | file->shmExclusive) & mask)) {
      if (Other(node->shmExclusive[offset], file)) {
        rc = SQLITE_BUSY;
      } else {
        node->shmShared[offset]++;
        file->shmShared |= mask;
      }
    }
  } else {
    for (int i = offset; i < offset + count && rc == SQLITE_OK; i++)
      if (Other(node->shmExclusive[i], file) || node->shmShared[i] > ((file->shmShared & (1u << i)) ? 1 : 0)) rc = SQLITE_BUSY;
    if (rc == SQLITE_OK) {
      for (int i = offset; i < offset + count; i++) node->shmExclusive[i] = file;
      file->shmExclusive |= mask;
    }
  }
  sqlite3_mutex_leave(memoryMutex);
  return rc;
}

static void MemoryShmBarrier(sqlite3_file *base) {
  (void)base;
  sqlite3MemoryBarrier();
}

static int MemoryShmUnmap(sqlite3_file *base, int deleteFlag) {
  MdeFile *file = (MdeFile *)base;
  MemoryNode *node = file->memory;
  sqlite3_mutex_enter(memoryMutex);
  ReleaseShm(file, (1u << SQLITE_SHM_NLOCK) - 1u);
  if (file->shmMapped) {
    file->shmMapped = 0;
    node->mapped--;
  }
  if (deleteFlag && node->mapped == 0) {
    for (int i = 0; i < node->regionCount; i++) free((void *)node->regions[i]);
    free((void *)node->regions);
    node->regions = NULL;
    node->regionCount = 0;
  }
  sqlite3_mutex_leave(memoryMutex);
  return SQLITE_OK;
}

static int MemoryFetch(sqlite3_file *base, sqlite3_int64 offset, int amount, void **pointer) {
  (void)base;
  (void)offset;
  (void)amount;
  *pointer = NULL;
  return SQLITE_OK;
}

static int MemoryUnfetch(sqlite3_file *base, sqlite3_int64 offset, void *pointer) {
  (void)base;
  (void)offset;
  (void)pointer;
  return SQLITE_OK;
}

static int MemoryClose(sqlite3_file *base) {
  MdeFile *file = (MdeFile *)base;
  MemoryNode *node = file->memory;
  MemoryShmUnmap(base, 0);
  MemoryUnlock(base, SQLITE_LOCK_NONE);
  sqlite3_mutex_enter(memoryMutex);
  if (--node->handles == 0) {
    Unlink(node);
    FreeMemory(node);
  }
  sqlite3_mutex_leave(memoryMutex);
  file->memory = NULL;
  return SQLITE_OK;
}

static const sqlite3_io_methods memoryMethods = {
    3, MemoryClose, MemoryRead, MemoryWrite, MemoryTruncate, MemorySync, MemoryFileSize, MemoryLock, MemoryUnlock,
    MemoryCheckReservedLock, MemoryFileControl, MemorySectorSize, MemoryDeviceCharacteristics, MemoryShmMap,
    MemoryShmLock, MemoryShmBarrier, MemoryShmUnmap, MemoryFetch, MemoryUnfetch};

/* A file in memory opened: created when it is not there (and the flags tell to) */
static int OpenMemory(const char *name, MdeFile *file, int flags, int *outFlags) {
  int rc = SQLITE_OK;
  sqlite3_mutex_enter(memoryMutex);
  MemoryNode *node = FindMemory(name);
  if (!node && !(flags & SQLITE_OPEN_CREATE)) {
    rc = SQLITE_CANTOPEN;
  } else if (!node) {
    node = calloc(1, sizeof(MemoryNode));
    if (node) node->name = malloc(strlen(name) + 1);
    if (!node || !node->name) {
      free(node);
      node = NULL;
      rc = SQLITE_NOMEM;
    } else {
      strcpy(node->name, name);
      node->next = memoryFiles;
      memoryFiles = node;
    }
  }
  if (node) node->handles++;
  sqlite3_mutex_leave(memoryMutex);
  if (rc != SQLITE_OK) return rc;
  file->memory = node;
  file->base.pMethods = &memoryMethods;
  if (outFlags) *outFlags = flags;
  return SQLITE_OK;
}

static int MdeOpen(sqlite3_vfs *vfs, sqlite3_filename name, sqlite3_file *base, int flags, int *outFlags) {
  (void)vfs;
  MdeFile *file = (MdeFile *)base;
  memset(file, 0, sizeof(MdeFile));
  if (IsMemory(name)) return OpenMemory(name, file, flags, outFlags);
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
  if (!IsMemory(name)) return mdeRealVfs->xDelete(mdeRealVfs, name, syncDir);
  /* Out of the files not deleted (its handles still reading it), freed with its last handle */
  sqlite3_mutex_enter(memoryMutex);
  MemoryNode *node = FindMemory(name);
  if (node) {
    Unlink(node);
    if (node->handles == 0) FreeMemory(node);
  }
  sqlite3_mutex_leave(memoryMutex);
  return SQLITE_OK;
}

static int MdeAccess(sqlite3_vfs *vfs, const char *name, int flags, int *result) {
  (void)vfs;
  if (!IsMemory(name)) return mdeRealVfs->xAccess(mdeRealVfs, name, flags, result);
  /* As the default VFS tells it: an empty file is not there */
  sqlite3_mutex_enter(memoryMutex);
  MemoryNode *node = FindMemory(name);
  *result = node && (flags != SQLITE_ACCESS_EXISTS || node->size > 0);
  sqlite3_mutex_leave(memoryMutex);
  return SQLITE_OK;
}

static int MdeFullPathname(sqlite3_vfs *vfs, const char *name, int size, char *out) {
  (void)vfs;
  if (!IsMemory(name)) return mdeRealVfs->xFullPathname(mdeRealVfs, name, size, out);
  snprintf(out, (size_t)size, "%s", name);
  return SQLITE_OK;
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
    memoryMutex = sqlite3_mutex_alloc(SQLITE_MUTEX_STATIC_VFS2);

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
** by mde_commit or mde_abort, and a failure of the function leaves it to be aborted. The end of a write writes the
** events queued to the oplog first (AppendQueued), in its transaction.
*/

static int AppendQueued(MdeStore *store);
static void Settle(MdeStore *store, int rc);

/* The transaction of the b-tree layer of a function: a read, or a write */
static int Begin(MdeStore *store, int write) {
  return store->transaction ? SQLITE_OK : sqlite3BtreeBeginTrans(store->bt, write, 0);
}

/* The end of the transaction of a write: committed when rc is SQLITE_OK (the error of the commit given), else rolled
** back (rc given) */
static int End(MdeStore *store, int rc) {
  if (rc == SQLITE_OK) rc = AppendQueued(store);
  if (!store->transaction) {
    if (rc == SQLITE_OK) rc = sqlite3BtreeCommit(store->bt);
    else sqlite3BtreeRollback(store->bt, SQLITE_OK, 0);
  }
  Settle(store, rc);
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
  if (rc == SQLITE_OK) rc = AppendQueued(store);
  if (!store->transaction) {
    if (rc == SQLITE_OK) rc = Exec(store, "COMMIT", "the catalog");
    if (rc != SQLITE_OK) sqlite3_exec(store->db, "ROLLBACK", 0, 0, 0);
  }
  Settle(store, rc);
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

/* The row 'd' written (the counts and the bytes of the oplog not written from now on) by the transaction open, when
** it is not there: Settle marks them once it commits */
static int MarkDirty(MdeStore *store) {
  if (store->countsDirty || store->marking) return SQLITE_OK;
  const uint8_t key[1] = {'d'}, value[1] = {1};
  OpenCursor(store, store->metaCursor, store->meta, 1);
  int rc = Put(store, store->metaCursor, key, 1, value, 1);
  sqlite3BtreeCloseCursor(store->metaCursor);
  if (rc == SQLITE_OK) store->marking = 1;
  return rc;
}

/* The size of a record of two blobs (Record): the bytes of an event in the oplog, as its payload */
static int64_t RecordSize(int a, int b) {
  return 1 + sqlite3VarintLen((u64)a * 2 + 12) + sqlite3VarintLen((u64)b * 2 + 12) + (int64_t)a + b;
}

/* The key of an event of the oplog: its generation and its sequence, 8 bytes each, big endian */
static void EventKey(uint8_t *key, int64_t generation, int64_t sequence) {
  PutBigEndian(key, generation);
  PutBigEndian(key + 8, sequence);
}

/* The cluster time of an event (its increment, then its time, 4 bytes each, little endian): its last field (t, a
** timestamp: 0x11 't' 0, then its 8 bytes), before the end of its BSON; the end of an event at least */
static int EventTime(const uint8_t *event, int size, uint8_t *time) {
  if (size < 12 || event[size - 12] != 0x11 || event[size - 11] != 't' || event[size - 10] != 0) return 0;
  memcpy(time, event + size - 9, 8);
  return 1;
}

/* The oldest events of the oplog deleted, in the transaction open, until it holds its limit of bytes at most: the key
** and the cluster time of the last one deleted written (the row 'l'), so that a position or a time before it fails
** (ChangeStreamHistoryLost) */
static int Trim(MdeStore *store) {
  uint8_t lost[24];
  int deleted = 0;
  int rc = OpenCursor(store, store->entryCursor, store->oplog, 1);
  while (rc == SQLITE_OK && store->oplogBytes + store->pendingBytes > store->oplogLimit) {
    int empty = 0;
    rc = sqlite3BtreeFirst(store->entryCursor, &empty);
    if (rc != SQLITE_OK || empty) break;
    const int64_t size = (int64_t)sqlite3BtreePayloadSize(store->entryCursor);
    /* Its key first in its record, in the part of its cell on the page */
    u32 local = 0;
    const uint8_t *payload = sqlite3BtreePayloadFetch(store->entryCursor, &local);
    int keyLength = 0;
    int keyOffset = payload ? Field(payload, (int)local, 0, &keyLength) : -1;
    if (keyOffset < 0 || keyLength != 16) {
      rc = Fail(store, SQLITE_CORRUPT, "a record of the oplog is not an event");
      break;
    }
    memcpy(lost, payload + keyOffset, 16);
    /* Its cluster time at the end of its record (the event its last field), read alone */
    uint8_t tail[12];
    if (size < 12 || sqlite3BtreePayload(store->entryCursor, (u32)size - 12, 12, tail) != SQLITE_OK || !EventTime(tail, 12, lost + 16))
      memset(lost + 16, 0, 8);
    deleted = 1;
    rc = sqlite3BtreeDelete(store->entryCursor, 0);
    if (rc == SQLITE_OK) store->pendingBytes -= size;
  }
  sqlite3BtreeCloseCursor(store->entryCursor);
  if (rc == SQLITE_OK && deleted) {
    const uint8_t key[1] = {'l'};
    OpenCursor(store, store->metaCursor, store->meta, 1);
    rc = Put(store, store->metaCursor, key, 1, lost, 24);
    sqlite3BtreeCloseCursor(store->metaCursor);
  }
  return rc;
}

/* The key and the cluster time of the last event the oplog lost (the row 'l': deleted by its limit, or by an opening
** keeping none, its time then zeros), 24 bytes, in the read or the transaction open: zeros when it lost none */
static int ReadLost(MdeStore *store, uint8_t *lost) {
  memset(lost, 0, 24);
  const uint8_t key[1] = {'l'};
  int res = 0;
  OpenCursor(store, store->metaCursor, store->meta, 0);
  int rc = Seek(store, store->metaCursor, key, 1, &res);
  if (rc == SQLITE_OK && res == 0) {
    u32 size;
    const uint8_t *payload = PayloadOf(store, store->metaCursor, &size);
    int length = 0;
    int offset = payload ? Field(payload, (int)size, 1, &length) : -1;
    if (offset >= 0 && (length == 16 || length == 24)) memcpy(lost, payload + offset, length);
  }
  sqlite3BtreeCloseCursor(store->metaCursor);
  return rc;
}

/* The cluster time of the last event of the oplog, in the read or the transaction open: *has 0 when it has none */
static int LastTime(MdeStore *store, uint8_t *time, int *has) {
  *has = 0;
  OpenCursor(store, store->entryCursor, store->oplog, 0);
  int empty = 0;
  int rc = sqlite3BtreeLast(store->entryCursor, &empty);
  if (rc == SQLITE_OK && !empty) {
    u32 size;
    const uint8_t *payload = PayloadOf(store, store->entryCursor, &size);
    int length = 0;
    int offset = payload ? Field(payload, (int)size, 1, &length) : -1;
    if (offset >= 0) *has = EventTime(payload + offset, length, time);
  }
  sqlite3BtreeCloseCursor(store->entryCursor);
  return rc;
}

/* The events queued written to the oplog in the transaction open (none when it holds no event: its limit 0), each one
** the next sequence of the generation; beyond its limit and its slack, its oldest events deleted */
static int AppendQueued(MdeStore *store) {
  if (!store->queuedCount || store->oplogLimit <= 0 || !store->oplog) return SQLITE_OK;
  int rc = MarkDirty(store);
  if (rc != SQLITE_OK) return rc;
  OpenCursor(store, store->entryCursor, store->oplog, 1);
  for (size_t at = 0; at + 4 <= store->queued.size && rc == SQLITE_OK;) {
    uint32_t size;
    memcpy(&size, store->queued.data + at, 4);
    uint8_t key[16];
    EventKey(key, store->generation, store->nextSeq + store->pendingSeq);
    int res = 0;
    rc = Seek(store, store->entryCursor, key, 16, &res);
    if (rc == SQLITE_OK && res == 0) rc = Fail(store, SQLITE_CORRUPT, "an event of the oplog is there already");
    if (rc == SQLITE_OK) rc = Insert(store, store->entryCursor, key, 16, store->queued.data + at + 4, (int)size, res);
    if (rc == SQLITE_OK) {
      store->pendingSeq++;
      store->pendingBytes += RecordSize(16, (int)size);
    }
    at += 4 + size;
  }
  sqlite3BtreeCloseCursor(store->entryCursor);
  if (rc == SQLITE_OK && store->oplogBytes + store->pendingBytes > store->oplogLimit + MDE_OPLOG_SLACK) rc = Trim(store);
  return rc;
}

/* The outcome of the end of a write: the events it appended and their bytes counted, the counts marked as not
** written when it wrote the row 'd' (when it was committed, or is in the transaction of a session: its abort restores
** them); the events queued dropped */
static void Settle(MdeStore *store, int rc) {
  if (rc == SQLITE_OK) {
    store->nextSeq += store->pendingSeq;
    store->oplogBytes += store->pendingBytes;
    if (store->marking) store->countsDirty = 1;
  }
  store->pendingSeq = 0;
  store->pendingBytes = 0;
  store->marking = 0;
  store->queued.size = 0;
  store->queuedCount = 0;
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
  store->oplog = 0;
  while ((rc = sqlite3_step(statement)) == SQLITE_ROW) {
    const char *name = (const char *)sqlite3_column_text(statement, 0);
    Pgno root = (Pgno)sqlite3_column_int64(statement, 1);
    if (strcmp(name, "meta") == 0) {
      store->meta = root;
    } else if (strcmp(name, "oplog") == 0) {
      store->oplog = root;
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
    if (key[0] == 'g' && keySize == 1 && valueSize == 8) store->generation = BigEndian(value);
    if (key[0] == 'o' && keySize == 1 && valueSize == 8) store->oplogBytes = BigEndian(value);
    if (key[0] == 'i' && keySize == 1 && valueSize == 16) memcpy(store->database, value, 16);
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
  /* The counts, the UUID and the definitions of the indexes, now the collections are known */
  rc = sqlite3_prepare_v2(store->db, "SELECT k, v FROM meta WHERE k >= x'6b' AND k < x'6c' OR k >= x'75' AND k < x'76' OR k >= x'78' AND k < x'79'", -1, &statement, 0);
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
    } else if (key[0] == 'u' && valueSize == 16) {
      memcpy(collection->uuid, value, 16);
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

static int RunBlobs(MdeStore *store, const char *sql, const uint8_t *const *blobs, const int *sizes, int count);

/* The oplog of the connection writing: its table made when it is missing, a new generation (the last one plus one;
** random for a database in memory, so that the tokens of another one never match), the UUID of the database made when
** it has none, the limit of its bytes */
static int OpenOplog(MdeStore *store, const MdeOptions *options) {
  int rc = Exec(store, "CREATE TABLE IF NOT EXISTS oplog(k BLOB PRIMARY KEY, v BLOB) WITHOUT ROWID", "the oplog");
  if (rc == SQLITE_OK) rc = LoadRoots(store);
  if (rc != SQLITE_OK) return rc;
  if (IsMemory(store->file)) {
    uint64_t random = 0;
    sqlite3_randomness(sizeof(random), &random);
    store->generation = (int64_t)(random >> 17) + 1;
  } else {
    store->generation++;
  }
  static const uint8_t none[16] = {0};
  if (memcmp(store->database, none, 16) == 0) sqlite3_randomness(16, store->database);
  uint8_t generation[8];
  PutBigEndian(generation, store->generation);
  const uint8_t *blobs[] = {generation, store->database};
  const int sizes[] = {8, 16};
  rc = RunBlobs(store, "INSERT INTO meta(k, v) VALUES (x'67', ?1), (x'69', ?2) ON CONFLICT(k) DO UPDATE SET v = excluded.v", blobs, sizes, 2);
  /* An opening keeping no events (oplogSize 0): the events of the openings before deleted with their bytes, so that
  ** their space is freed; the row 'l' the end of this generation, so that a token of it or of one before it fails
  ** (ChangeStreamHistoryLost) once an oplog is kept again, the writes of this opening not being in it. This opening
  ** keeps the start of its generation as lost when the database had events (the cluster time of the last one) */
  memset(store->openLost, 0, 24);
  store->hasOpenTime = 0;
  if (rc == SQLITE_OK && options->oplogBytes <= 0) {
    sqlite3_stmt *statement;
    rc = sqlite3_prepare_v2(store->db, "SELECT (SELECT v FROM meta WHERE k = x'6c'), (SELECT v FROM oplog ORDER BY k DESC LIMIT 1)", -1, &statement, 0);
    if (rc != SQLITE_OK) return FailSql(store, rc, "the oplog");
    int history = 0;
    if (sqlite3_step(statement) == SQLITE_ROW) {
      const uint8_t *lost = sqlite3_column_blob(statement, 0);
      const int lostSize = sqlite3_column_bytes(statement, 0);
      for (int i = 0; lost && i < lostSize; i++) history |= lost[i] != 0;
      const uint8_t *last = sqlite3_column_blob(statement, 1);
      if (last) {
        history = 1;
        store->hasOpenTime = EventTime(last, sqlite3_column_bytes(statement, 1), store->openTime);
      }
    }
    sqlite3_finalize(statement);
    if (history) EventKey(store->openLost, store->generation, 0);
    if (store->hasOpenTime) memcpy(store->openLost + 16, store->openTime, 8);
    /* The time of the events of this opening not known: the openings after it fail the times before their oldest event */
    uint8_t end[24] = {0};
    EventKey(end, store->generation, INT64_MAX);
    const uint8_t *ends[] = {end};
    const int endSizes[] = {24};
    rc = Exec(store,
              "BEGIN IMMEDIATE; DELETE FROM oplog;"
              "INSERT INTO meta(k, v) VALUES (x'6f', x'0000000000000000') ON CONFLICT(k) DO UPDATE SET v = excluded.v;",
              "the oplog");
    if (rc == SQLITE_OK) rc = RunBlobs(store, "INSERT INTO meta(k, v) VALUES (x'6c', ?1) ON CONFLICT(k) DO UPDATE SET v = excluded.v", ends, endSizes, 1);
    if (rc == SQLITE_OK) rc = Exec(store, "COMMIT", "the oplog");
    if (rc == SQLITE_OK) store->oplogBytes = 0;
    else sqlite3_exec(store->db, "ROLLBACK", NULL, NULL, NULL);
  }
  store->nextSeq = 1;
  store->oplogLimit = options->oplogBytes;
  return rc;
}


/* The frames of the WAL after a commit of SQL (a commit of the b-tree layer calls no hook: precondition 4) */
static int WalHook(void *context, sqlite3 *db, const char *name, int frames) {
  (void)db;
  (void)name;
  ((MdeStore *)context)->frames = frames;
  return SQLITE_OK;
}

/* The documents of each collection counted, and the bytes of the oplog (the connection before did not close): the
** counts stay to be written */
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
  store->oplogBytes = 0;
  if (rc == SQLITE_OK && store->oplog) {
    int empty = 0;
    OpenCursor(store, store->cursor, store->oplog, 0);
    rc = sqlite3BtreeFirst(store->cursor, &empty);
    while (rc == SQLITE_OK && !empty) {
      store->oplogBytes += (int64_t)sqlite3BtreePayloadSize(store->cursor);
      rc = sqlite3BtreeNext(store->cursor, 0);
      if (rc == SQLITE_DONE) {
        rc = SQLITE_OK;
        break;
      }
    }
    sqlite3BtreeCloseCursor(store->cursor);
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
    const uint8_t key[1] = {'o'};
    uint8_t value[8];
    PutBigEndian(value, store->oplogBytes);
    rc = Put(store, store->metaCursor, key, 1, value, 8);
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
  const char *vfs = MdeVfs();
  /* A database in memory: a file in memory of a name of its own (its connections share it) */
  char memory[64];
  if (strcmp(file, ":memory:") == 0) {
    sqlite3_mutex_enter(memoryMutex);
    snprintf(memory, sizeof(memory), "%s%lld", MDE_MEMORY, (long long)++memoryNames);
    sqlite3_mutex_leave(memoryMutex);
    file = memory;
  }
  if (store) store->file = malloc(strlen(file) + 1);
  if (!store || !store->file) {
    free(store);
    snprintf(message, size, "out of memory");
    return SQLITE_NOMEM;
  }
  strcpy(store->file, file);
  int rc = sqlite3_open_v2(file, &store->db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_NOMUTEX, vfs);
  if (rc != SQLITE_OK) {
    snprintf(message, size, "%s: %s", file, store->db ? sqlite3_errmsg(store->db) : "cannot open");
    sqlite3_close(store->db);
    free(store->file);
    free(store);
    return rc;
  }
  /* A database in memory is gone with its last connection: no checkpoint at its closing */
  if (IsMemory(file)) sqlite3_db_config(store->db, SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE, 1, (int *)0);
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
  if (rc == SQLITE_OK && options->reader) rc = Exec(store, "PRAGMA query_only = 1", "the settings");
  if (rc == SQLITE_OK && !options->checkpoints) {
    if (!options->reader)
      rc = Exec(store,
                "CREATE TABLE IF NOT EXISTS meta(k BLOB PRIMARY KEY, v BLOB) WITHOUT ROWID;"
                "INSERT OR IGNORE INTO meta(k, v) VALUES (x'66', x'00000003'), (x'6e', x'0000000000000001');",
                "the catalog");
    if (rc == SQLITE_OK) rc = LoadCatalog(store);
    /* The oplog, made once the format is checked; a new generation for this opening (a random one in memory, where
    ** a database is new each time), the UUID of the database made once */
    if (rc == SQLITE_OK && !options->reader) rc = OpenOplog(store, options);
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
    /* The counts of a reader are the ones of the connection writing (mde_refresh) */
    if (rc == SQLITE_OK && store->recount && !options->reader) rc = Recount(store);
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
  mde_abort(store);
  if (store->bt && store->countsDirty) WriteCounts(store);
  mde_buffer_free(&store->queued);
  sqlite3_free(store->cursor);
  sqlite3_free(store->metaCursor);
  sqlite3_free(store->entryCursor);
  if (store->probe) sqlite3DbFree(store->db, store->probe);
  if (store->info) sqlite3KeyInfoUnref(store->info);
  sqlite3_close(store->db);
  free(store->file);
  for (int i = 0; i < store->collectionCount; i++) FreeCollection(&store->collections[i]);

  free(store->collections);
  free(store->record);
  free(store->payload);
  mde_buffer_free(&store->entryValue);
  free(store);
}

const char *mde_file(MdeStore *store) { return store->file; }

/* A copy of a collection (its name, the definitions of its indexes, its tables): 0, or SQLITE_NOMEM */
static int CopyCollection(Collection *to, const Collection *from) {
  *to = *from;
  to->name = malloc(strlen(from->name) + 1);
  to->indexes = from->indexesSize > 0 ? malloc((size_t)from->indexesSize) : NULL;
  to->tables = malloc(sizeof(int64_t) * (size_t)(from->tableCount + 1));
  to->tableRoots = malloc(sizeof(Pgno) * (size_t)(from->tableCount + 1));
  to->tableCapacity = from->tableCount + 1;
  if (!to->name || (from->indexesSize > 0 && !to->indexes) || !to->tables || !to->tableRoots) {
    FreeCollection(to);
    return SQLITE_NOMEM;
  }
  strcpy(to->name, from->name);
  if (to->indexes) memcpy(to->indexes, from->indexes, (size_t)from->indexesSize);
  if (from->tableCount) {
    memcpy(to->tables, from->tables, sizeof(int64_t) * (size_t)from->tableCount);
    memcpy(to->tableRoots, from->tableRoots, sizeof(Pgno) * (size_t)from->tableCount);
  }
  return SQLITE_OK;
}

static void FreeSaved(MdeStore *store) {
  for (int i = 0; i < store->savedCount; i++) FreeCollection(&store->saved[i]);
  free(store->saved);
  store->saved = NULL;
  store->savedCount = 0;
}

/* The collections kept as they are, for an abort */
static int SaveCollections(MdeStore *store) {
  store->saved = malloc(sizeof(Collection) * (size_t)(store->collectionCount + 1));
  if (!store->saved) return SQLITE_NOMEM;
  for (int i = 0; i < store->collectionCount; i++) {
    if (CopyCollection(&store->saved[i], &store->collections[i]) != SQLITE_OK) {
      FreeSaved(store);
      return SQLITE_NOMEM;
    }
    store->savedCount++;
  }
  store->savedDirty = store->countsDirty;
  store->savedNextSeq = store->nextSeq;
  store->savedOplogBytes = store->oplogBytes;
  return SQLITE_OK;
}

/* The collections kept put back */
static void RestoreCollections(MdeStore *store) {
  for (int i = 0; i < store->collectionCount; i++) FreeCollection(&store->collections[i]);
  free(store->collections);
  store->collections = store->saved;
  store->collectionCount = store->savedCount;
  store->collectionCapacity = store->savedCount + 1;
  store->countsDirty = store->savedDirty;
  store->nextSeq = store->savedNextSeq;
  store->oplogBytes = store->savedOplogBytes;
  Settle(store, SQLITE_ABORT);

  store->saved = NULL;
  store->savedCount = 0;
}

int mde_begin(MdeStore *store) {
  store->message[0] = 0;
  if (store->transaction) return Fail(store, SQLITE_MISUSE, "a transaction is open");
  if (SaveCollections(store) != SQLITE_OK) return Fail(store, SQLITE_NOMEM, "out of memory");
  int rc = Exec(store, "BEGIN IMMEDIATE", "a transaction");
  if (rc != SQLITE_OK) {
    FreeSaved(store);
    return rc;
  }
  store->transaction = 1;
  return SQLITE_OK;
}

int mde_commit(MdeStore *store) {
  store->message[0] = 0;
  if (!store->transaction) return Fail(store, SQLITE_MISUSE, "no transaction is open");
  int rc = Exec(store, "COMMIT", "a transaction");
  if (rc != SQLITE_OK) {
    /* Not committed: rolled back, its message kept */
    char message[sizeof(store->message)];
    memcpy(message, store->message, sizeof(message));
    mde_abort(store);
    memcpy(store->message, message, sizeof(message));
    return rc;
  }
  FreeSaved(store);
  store->transaction = 0;
  return SQLITE_OK;
}

int mde_abort(MdeStore *store) {
  if (!store->transaction) return SQLITE_OK;
  sqlite3_exec(store->db, "ROLLBACK", 0, 0, 0);
  store->transaction = 0;
  RestoreCollections(store);
  /* The tables made or dropped in it are not there, or there again (precondition 5) */
  return LoadRoots(store);
}

int mde_in_transaction(MdeStore *store) { return store->transaction; }

int mde_refresh(MdeStore *reader, MdeStore *writer) {
  reader->message[0] = 0;
  for (int i = 0; i < reader->collectionCount; i++) FreeCollection(&reader->collections[i]);
  reader->collectionCount = 0;
  int rc = LoadCatalog(reader);
  if (rc == SQLITE_OK) rc = LoadRoots(reader);
  if (rc != SQLITE_OK) return rc;
  for (int i = 0; i < reader->collectionCount; i++) {
    const Collection *source = Find(writer, reader->collections[i].id);
    reader->collections[i].count = source ? source->count : 0;
  }
  return SQLITE_OK;
}

int mde_collections(MdeStore *store, MdeBuffer *out) {

  for (int i = 0; i < store->collectionCount; i++) {
    const Collection *collection = &store->collections[i];
    uint32_t length = (uint32_t)strlen(collection->name);
    uint32_t indexesSize = (uint32_t)collection->indexesSize;
    uint32_t tableCount = (uint32_t)collection->tableCount;
    if (!Append(out, &length, 4) || !Append(out, collection->name, length) || !Append(out, &collection->id, 8) ||
        !Append(out, &collection->count, 8) || !Append(out, collection->uuid, 16) || !Append(out, &indexesSize, 4) ||
        !Append(out, collection->indexes, indexesSize) ||
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

int mde_create_collection(MdeStore *store, const char *name, const uint8_t *given, const uint8_t *definitions,
                          int definitionsSize, int64_t *id) {
  int length = (int)strlen(name);
  /* A UUID of its own when none is given */
  uint8_t uuid[16];
  if (given) memcpy(uuid, given, 16);
  else sqlite3_randomness(16, uuid);
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
  uint8_t idValue[8], countKey[9], zero[8] = {0}, nextValue[8], uuidKey[9], definitionsKey[9];
  if (!nameKey) rc = Fail(store, SQLITE_NOMEM, "out of memory");
  if (rc == SQLITE_OK) {
    nameKey[0] = 'c';
    memcpy(nameKey + 1, name, length);
    PutBigEndian(idValue, next);
    countKey[0] = 'k';
    PutBigEndian(countKey + 1, next);
    PutBigEndian(nextValue, next + 1);
    uuidKey[0] = 'u';
    PutBigEndian(uuidKey + 1, next);
    const uint8_t *blobs[] = {nameKey, idValue, countKey, zero, nextValue, uuidKey, uuid};
    const int sizes[] = {length + 1, 8, 9, 8, 8, 9, 16};
    rc = RunBlobs(store, "INSERT INTO meta(k, v) VALUES (?1, ?2), (?3, ?4), (x'6e', ?5), (?6, ?7) ON CONFLICT(k) DO UPDATE SET v = excluded.v", blobs, sizes, 7);
  }
  /* Its definitions (its options), when given */
  if (rc == SQLITE_OK && definitionsSize > 0) {
    definitionsKey[0] = 'x';
    PutBigEndian(definitionsKey + 1, next);
    const uint8_t *blobs[] = {definitionsKey, definitions};
    const int sizes[] = {9, definitionsSize};
    rc = RunBlobs(store, "INSERT INTO meta(k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = excluded.v", blobs, sizes, 2);
  }
  free(nameKey);
  rc = EndSql(store, rc);
  if (rc != SQLITE_OK) return rc;
  rc = AddCollection(store, next, name, length);
  if (rc != SQLITE_OK) return Fail(store, rc, "out of memory");
  Collection *created = &store->collections[store->collectionCount - 1];
  memcpy(created->uuid, uuid, 16);
  if (definitionsSize > 0) {
    int failed;
    uint8_t *copy = CopyOf(definitions, definitionsSize, &failed);
    if (failed) return Fail(store, SQLITE_NOMEM, "out of memory");
    KeepDefinitions(created, copy, definitionsSize);
  }
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
  uint8_t countKey[9], indexesKey[9], uuidKey[9];
  countKey[0] = 'k';
  PutBigEndian(countKey + 1, collection->id);
  indexesKey[0] = 'x';
  PutBigEndian(indexesKey + 1, collection->id);
  uuidKey[0] = 'u';
  PutBigEndian(uuidKey + 1, collection->id);
  char sql[64];
  snprintf(sql, sizeof(sql), "DROP TABLE c%lld", (long long)collection->id);
  int rc = Exec(store, sql, "the table of a collection");
  for (int i = 0; i < collection->tableCount && rc == SQLITE_OK; i++) {
    snprintf(sql, sizeof(sql), "DROP TABLE i%lld_%lld", (long long)collection->id, (long long)collection->tables[i]);
    rc = Exec(store, sql, "the table of an index");
  }
  if (rc == SQLITE_OK) {
    const uint8_t *blobs[] = {nameKey, countKey, indexesKey, uuidKey};
    const int sizes[] = {nameSize, 9, 9, 9};
    rc = RunBlobs(store, "DELETE FROM meta WHERE k = ?1 OR k = ?2 OR k = ?3 OR k = ?4", blobs, sizes, 4);
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

/* Whether the entry of an index not unique the cursor is on (its key, then the key of the _id: its value) holds a key
** of the index (*holds) */
static int HoldsKey(MdeStore *store, BtCursor *cursor, const uint8_t *key, int keySize, int *holds) {
  *holds = 0;
  u32 size;
  const uint8_t *payload = PayloadOf(store, cursor, &size);
  if (!payload) return Fail(store, SQLITE_NOMEM, "out of memory");
  int keyLength = 0, valueLength = 0;
  int keyOffset = Field(payload, (int)size, 0, &keyLength);
  int valueOffset = Field(payload, (int)size, 1, &valueLength);
  if (keyOffset < 0 || valueOffset < 0) return Fail(store, SQLITE_CORRUPT, "an entry of an index is not a key");
  *holds = keyLength - valueLength == keySize && memcmp(payload + keyOffset, key, (size_t)keySize) == 0;
  return SQLITE_OK;
}

/* Whether another document holds the key of a new entry of an index not unique (its key, then the key of the _id: its
** value) prepared to be unique (prepareUnique), the cursor moved by Seek next to its place (res, not 0): the entries
** of a key are next to each other, ordered by the keys of their _id, so another document holds it when an entry next
** to the place holds it. The cursor is moved by Seek again (res) */
static int PreparedDuplicate(MdeStore *store, BtCursor *cursor, const uint8_t *key, int keySize, int valueSize, int *res,
                             int *duplicate) {
  int prefix = keySize - valueSize;
  int rc = SQLITE_OK;
  if (!sqlite3BtreeEof(cursor)) rc = HoldsKey(store, cursor, key, prefix, duplicate);
  if (rc != SQLITE_OK || *duplicate) return rc;
  if (!sqlite3BtreeEof(cursor)) {
    rc = *res < 0 ? sqlite3BtreeNext(cursor, 0) : sqlite3BtreePrevious(cursor, 0);
    if (rc == SQLITE_OK) rc = HoldsKey(store, cursor, key, prefix, duplicate);
    else if (rc == SQLITE_DONE) rc = SQLITE_OK;
  }
  if (rc != SQLITE_OK || *duplicate) return rc;
  return Seek(store, cursor, key, keySize, res);
}

/* An entry of an index written (removed or inserted) in the transaction open: *duplicate when its key is unique (1)
** or prepared to be unique (2, prepareUnique: an index not unique refusing new duplicates) and another document holds
** it */
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
      if (unique == 2) rc = PreparedDuplicate(store, store->entryCursor, key, keySize, valueSize, &res, duplicate);
      if (rc == SQLITE_OK && !*duplicate) rc = Insert(store, store->entryCursor, key, keySize, value, valueSize, res);
    } else if (unique == 1) {
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

/* The order of two entries deferred (mde_write): by their indexes, their keys, then their places in the write */
static int CompareEntries(const void *a, const void *b) {
  const MdeEntry *x = *(const MdeEntry *const *)a, *y = *(const MdeEntry *const *)b;
  if (x->index != y->index) return x->index < y->index ? -1 : 1;
  const int size = x->keySize < y->keySize ? x->keySize : y->keySize;
  const int order = memcmp(x->key, y->key, (size_t)size);
  if (order) return order;
  if (x->keySize != y->keySize) return x->keySize < y->keySize ? -1 : 1;
  return x < y ? -1 : x > y ? 1 : 0;
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
  /* The entries of the indexes neither unique nor prepared to be unique: written once the changes are, sorted by their
  ** indexes and their keys, so that their b-trees take them in their order (their order does not matter otherwise:
  ** their keys hold the _id of their documents; two of one key keep their order) */
  const MdeEntry **deferred = entryCount > 1 ? malloc((size_t)entryCount * sizeof(*deferred)) : NULL;
  int deferredCount = 0;
  for (int i = 0; i < count && rc == SQLITE_OK; i++) {
    const MdeChange *change = &changes[i];
    /* The entries of the change: removed before it, inserted after it */
    int first = entry;
    while (entry < entryCount && entries[entry].change == i) entry++;
    for (int k = first; k < entry && rc == SQLITE_OK; k++) {
      if (deferred && !entries[k].unique) {
        if (entries[k].remove) deferred[deferredCount++] = &entries[k];
        continue;
      }
      if (entries[k].remove)
        rc = PutEntry(store, collection, entries[k].index, entries[k].unique, 1, entries[k].key, entries[k].keySize,
                      entries[k].value, entries[k].valueSize, &duplicate);
    }
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
      if (deferred && !entries[k].unique) {
        deferred[deferredCount++] = &entries[k];
        continue;
      }
      rc = PutEntry(store, collection, entries[k].index, entries[k].unique, 0, entries[k].key, entries[k].keySize,
                    entries[k].value, entries[k].valueSize, &duplicate);
      if (rc == SQLITE_OK && duplicate) {
        rc = MDE_DUPLICATE_KEY;
        *failed = i;
        *failedIndex = entries[k].index;
      }
    }
  }
  if (rc == SQLITE_OK && deferredCount) {
    qsort(deferred, (size_t)deferredCount, sizeof(*deferred), CompareEntries);
    for (int k = 0; k < deferredCount && rc == SQLITE_OK; k++)
      rc = PutEntry(store, collection, deferred[k]->index, 0, deferred[k]->remove, deferred[k]->key, deferred[k]->keySize,
                    deferred[k]->value, deferred[k]->valueSize, &duplicate);
  }
  free(deferred);
  sqlite3BtreeCloseCursor(store->cursor);
  if (rc == SQLITE_OK && definitions) rc = PutDefinitions(store, id, definitions, definitionsSize);
  /* The first write of the connection: the counts not written from now on */
  if (rc == SQLITE_OK && delta != 0) rc = MarkDirty(store);
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
        if (keysOnly == 2) {
          /* The entry: its key (kept in last), then its value */
          uint32_t keySize = (uint32_t)keyLength, length = (uint32_t)valueLength;
          if (!Append(out, &keySize, 4) || !Append(out, last->data, last->size) || !Append(out, &length, 4) ||
              !Append(out, store->entryValue.data, store->entryValue.size))
            rc = Fail(store, SQLITE_NOMEM, "out of memory");
          else given++;
        } else if (keysOnly) {
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

void mde_drop_events(MdeStore *store) {
  store->queued.size = 0;
  store->queuedCount = 0;
}

int mde_queue_events(MdeStore *store, const uint8_t *const *events, const int *sizes, int count) {

  for (int i = 0; i < count; i++) {
    uint32_t size = (uint32_t)sizes[i];
    if (!Append(&store->queued, &size, 4) || !Append(&store->queued, events[i], size)) return Fail(store, SQLITE_NOMEM, "out of memory");
    store->queuedCount++;
  }
  return SQLITE_OK;
}

int mde_append_events(MdeStore *store) {
  store->message[0] = 0;
  if (!store->queuedCount) return SQLITE_OK;
  int rc = Begin(store, 1);
  if (rc != SQLITE_OK) {
    Settle(store, rc);
    return FailSql(store, rc, "the oplog");
  }
  rc = End(store, SQLITE_OK);
  if (rc != SQLITE_OK) return store->message[0] ? rc : FailSql(store, rc, "the oplog");
  store->frames = sqlite3PagerWalCallback(sqlite3BtreePager(store->bt));
  return SQLITE_OK;
}

int mde_oplog_read(MdeStore *store, const uint8_t *after, int afterSize, int maxEvents, size_t maxBytes, MdeBuffer *out,
                   MdeBuffer *last, int *done, uint8_t *lost) {
  *done = 1;
  memset(lost, 0, 16);
  store->message[0] = 0;
  if (!store->oplog) return SQLITE_OK;
  int rc = Begin(store, 0);
  if (rc != SQLITE_OK) return FailSql(store, rc, "a read of the oplog");
  /* The events lost, as the read sees them */
  uint8_t lostRow[24];
  rc = ReadLost(store, lostRow);
  memcpy(lost, lostRow, 16);
  if (rc != SQLITE_OK) {
    EndRead(store);
    return FailSql(store, rc, "a read of the oplog");
  }
  OpenCursor(store, store->entryCursor, store->oplog, 0);
  const MdeRange all = {NULL, 0, 0, NULL, 0, 0};
  int empty = 0, given = 0;
  rc = StartRange(store, store->entryCursor, &all, 0, after, afterSize, &empty);
  while (rc == SQLITE_OK && !empty) {
    u32 size;
    const uint8_t *payload = PayloadOf(store, store->entryCursor, &size);
    int keyLength = 0, valueLength = 0;
    int keyOffset = payload ? Field(payload, (int)size, 0, &keyLength) : -1;
    int valueOffset = payload ? Field(payload, (int)size, 1, &valueLength) : -1;
    if (!payload) {
      rc = Fail(store, SQLITE_NOMEM, "out of memory");
      break;
    }
    if (keyOffset < 0 || valueOffset < 0 || keyLength != 16) {
      rc = Fail(store, SQLITE_CORRUPT, "a record of the oplog is not an event");
      break;
    }
    uint32_t length = (uint32_t)valueLength;
    last->size = 0;
    if (!Append(out, &length, 4) || !Append(out, payload + keyOffset, 16) || !Append(out, payload + valueOffset, valueLength) ||
        !Append(last, payload + keyOffset, 16)) {
      rc = Fail(store, SQLITE_NOMEM, "out of memory");
      break;
    }
    given++;
    rc = sqlite3BtreeNext(store->entryCursor, 0);
    if (rc == SQLITE_DONE) {
      rc = SQLITE_OK;
      break;
    }
    if (rc == SQLITE_OK && (given >= maxEvents || out->size >= maxBytes)) {
      *done = 0;
      break;
    }
  }
  sqlite3BtreeCloseCursor(store->entryCursor);
  EndRead(store);
  if (rc != SQLITE_OK && !store->message[0]) FailSql(store, rc, "a read of the oplog");
  return rc;
}

int mde_oplog_state(MdeStore *store, int64_t *generation, int64_t *nextSeq, uint8_t *first, int *hasFirst,
                    uint8_t *database, uint8_t *lost, uint8_t *lastTime, int *hasLastTime) {
  store->message[0] = 0;
  *generation = store->generation;
  *nextSeq = store->nextSeq;
  memcpy(database, store->database, 16);
  *hasFirst = 0;
  /* An opening keeping no events: the ones lost when it opened */
  memcpy(lost, store->openLost, 24);
  memcpy(lastTime, store->openTime, 8);
  *hasLastTime = store->hasOpenTime;
  if (!store->oplog || store->oplogLimit <= 0) return SQLITE_OK;
  int rc = Begin(store, 0);
  if (rc != SQLITE_OK) return FailSql(store, rc, "a read of the oplog");
  rc = ReadLost(store, lost);
  if (rc == SQLITE_OK) rc = LastTime(store, lastTime, hasLastTime);
  if (rc != SQLITE_OK) {
    EndRead(store);
    return FailSql(store, rc, "a read of the oplog");
  }
  OpenCursor(store, store->entryCursor, store->oplog, 0);
  int empty = 0;
  rc = sqlite3BtreeFirst(store->entryCursor, &empty);
  if (rc == SQLITE_OK && !empty) {
    u32 size;
    const uint8_t *payload = PayloadOf(store, store->entryCursor, &size);
    int keyLength = 0;
    int keyOffset = payload ? Field(payload, (int)size, 0, &keyLength) : -1;
    if (keyOffset >= 0 && keyLength == 16) {
      memcpy(first, payload + keyOffset, 16);
      *hasFirst = 1;
    }
  }
  sqlite3BtreeCloseCursor(store->entryCursor);
  EndRead(store);
  return rc == SQLITE_OK ? rc : FailSql(store, rc, "a read of the oplog");
}

int mde_sync_wal(MdeStore *store) {

  if (IsMemory(store->file)) return SQLITE_OK;
  sqlite3_file *wal = NULL;
  int rc = sqlite3_file_control(store->db, "main", SQLITE_FCNTL_JOURNAL_POINTER, &wal);
  if (rc != SQLITE_OK) return FailSql(store, rc, "the WAL");
  /* No WAL yet: nothing written to sync. SQLITE_SYNC_FULL: F_FULLFSYNC on the platforms of Apple */
  if (!wal || !wal->pMethods) return SQLITE_OK;
  rc = wal->pMethods->xSync(wal, SQLITE_SYNC_FULL);
  return rc == SQLITE_OK ? rc : Fail(store, rc, "the WAL could not be synced");
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
