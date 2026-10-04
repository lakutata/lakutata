# @lakutata/mutex

The locks of the lakutata framework (`lakutata/com/mutex`): mutual exclusion between the instances and the processes of
an application. See `doc/en/Mutex.md` of the package lakutata.

```typescript
components: {mutex: {class: Mutex, driver: {type: 'redis', url: 'redis://cache:6379'}}}

await mutex.synchronized('report:daily', async (lock) => { ... })
```

Its stores: memory (a process), file (the processes of a host), Redis, PostgreSQL and MySQL (their advisory locks, or a
table). `npm run test:stores` tests them with Redis, PostgreSQL and MySQL in Docker.
