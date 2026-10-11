# Knowledge databases

Mate Knowledge has two canonical item types: portable Markdown text documents and first-class databases. Existing `.jsonl` Knowledge sources remain read-only legacy text-index inputs; they are never interpreted or migrated as writable databases.

## Storage and durability

Each owning Mate project stores all databases in `knowledge/.clay-db/databases.db` using the installed `@seald-io/nedb`. One NeDB document is the bounded aggregate for one database: schema, Table views, records, archive state, histories, actor attribution, revisions, and recent idempotency receipts. The serialized aggregate is capped at 8 MiB before commit. A process-wide registry owns each open NeDB file and serializes mutations per database, preventing two Clay service objects in one process from maintaining divergent datastore caches. This does not claim coordination or transactions across multiple operating-system processes. Mutations replace one aggregate with a revision precondition. This is deliberately a single-document durability boundary because NeDB has no multi-document transactions.

After a canonical mutation, Clay projects a versioned `knowledge-database-summary` record into the existing append-only common Knowledge backend. That projection contains discovery metadata, not flattened rows. A projection failure leaves the NeDB mutation committed, marks synchronization pending, and can be retried idempotently; Clay does not claim rollback or atomicity across the two stores.

## Data contract

- Stable database, field, option, view, and record ids make renames safe.
- Exactly one active `title` field is required. Other supported types are `text`, `number`, `boolean`, `date`, `select`, `multi-select`, and owner-scoped `reference`.
- Values are keyed by stable field id. Unknown fields, unsafe object keys, non-finite numbers, invalid dates/options, and unresolved or cross-Mate references are rejected.
- Live or recoverable values protect their fields, select option ids, and reference targets from destructive schema changes. Fields and options must be archived rather than silently removed. Views are reconciled when a field is archived.
- Database and record writes use optimistic revisions. Mutation tools require an operation id containing its creation time. The exact id and payload can be retried during the 24-hour receipt window; expired ids and reuse with a different payload are rejected. Each database retains up to 500 unexpired receipts and rejects new mutation ids while that capacity is full instead of discarding live deduplication evidence.
- Saved views are named Table views with selected columns, validated filters and sorts, deterministic id tie-breaking, opaque query-bound cursors, count totals, and sums for numeric fields.

## Product surface

The Knowledge explorer lists text and database items together and keeps the same tabs/navigation model. Tables, archived-record browsing, record details, and bounded history are read-only in the ordinary companion pane. Database creation, rename/archive, schema/view editing, record forms, and record recovery use fullscreen or captured custom-modal interaction. Database tools are available only in an exact live Mate session and derive the Mate, owner, project, and actor from that server binding. Canonical `list_databases` and `retry_database_sync` tools do not depend on the summary projection.
