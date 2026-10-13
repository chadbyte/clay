# Mate Knowledge workflow and migration guide

This guide describes the currently supported Mate Knowledge workflow. It is intentionally generic: narrative material belongs in guarded Markdown documents, while structured records belong in a Knowledge database. The import tools map external source rows into that database without accepting filesystem paths or caller-selected owners.

## Supported tool surface

Text documents:

- `read_knowledge_document` reads current Markdown content and its stable `documentId` and `revision`.
- `create_knowledge_document` creates safe nested Markdown paths.
- `update_knowledge_document` replaces content only with the current `expectedRevision`.
- `list_knowledge_document_history` lists recoverable revisions.
- `restore_knowledge_document` restores a selected version with a current-revision precondition.

Structured records:

- `list_databases` discovers database summaries; summaries are not row content.
- `read_database` reads the selected database schema, views, revision, and count.
- `query_database` uses stable field ids, typed filters, explicit sorts, bounded pages, cursors, and filter-scoped count/numeric sums.
- `read_database_record` reads a row by stable database and record IDs.
- `create_database_record` and `update_database_record` use typed values, stable field IDs, revisions, and retry operation IDs.
- `archive_database_record`, `recover_database_record`, and `retry_database_sync` provide recoverable lifecycle and projection retry behavior.
- `import_database_records` imports up to 100 source rows or 256 KiB per batch with immutable source namespace/key/payload identity.
- `read_database_import_progress` returns bounded source-to-native record mappings for later ID-based corrections.

Database list/search summaries are discovery projections, not row content. A workflow that needs row values must discover the database, read its schema, query with an explicit filter, and read individual records by returned IDs. Numeric totals must come from the query result for the same filter scope, never from a page count or an unfiltered search. Text search and text-document reads retain their own content and revision semantics.

## Workflow recipes

### Daily narrative capture

1. Use `create_knowledge_document` for a new narrative or multiline Markdown document.
2. Preserve wiki links as text; use the returned `documentId` and `revision` for later edits.
3. On update, supply `expectedRevision`. If it is rejected, call `read_knowledge_document`, merge against the returned content, and retry with the new revision.
4. Treat thrown errors or error responses as failures. If a successful response includes a revision/id plus `indexSyncPending`, the canonical document is saved but indexing is pending; report that exact state, do not call it indexed, and do not blindly retry the mutation. `syncError` identifies the projection problem and is not permission to create a duplicate document.

Example update shape:

```json
{
  "documentId": "<stable-document-id>",
  "content": "# Daily note\nSee [[areas/project-plan]].\n",
  "expectedRevision": "<revision-from-read>"
}
```

### Structured follow-up or finance records

1. Use `list_databases` to discover candidates, then `read_database` to inspect the schema and stable field IDs.
2. Use `query_database` with typed filters such as category, spender/contact, status, or date; provide explicit sorts and a bounded limit.
3. Use the returned count and numeric sums for the exact filter scope. Follow returned stable record IDs with `read_database_record` when full row content is needed.
4. For corrections, use `update_database_record` with the row revision and an operation ID. A rejected revision requires rereading the row before retrying.

A follow-up cadence or date cutoff is caller-provided input. Knowledge tools do not schedule reminders or invent a cutoff.

### Source-row import

1. Discover and read the target database schema first. Map each source field to a stable database field id; preserve the original source payload in each row.
2. Call `import_database_records` with `databaseId`, the current `expectedDatabaseRevision`, a fresh `operationId`, `sourceNamespace`, and rows containing `sourceKey`, `sourcePayload`, and typed `values`. The import fingerprint covers both the immutable source payload and supplied values.
3. Represent record references with `type: "record"`, `sourceNamespace`, and `sourceKey`. Same-batch forward references are supported; cross-database references must already be imported in the current Mate.
4. On an uncertain response, replay the exact operation id and identical payload while its receipt is active. After receipt expiry, use a fresh operation id with the current database revision only after checking progress. A changed payload or values for an existing source key is a source conflict, not a correction; use `update_database_record` after resolving the returned native record id.
5. Use `read_database_import_progress` to map source keys to native record IDs, then query and correct records through normal revision-guarded CRUD. Human corrections are preserved by source replay because imported mappings are immutable.

Import writes may return `projectionPending` or `projectionError`: the canonical database revision and records are saved, but the summary projection is pending or failed. Report that exact state and use `retry_database_sync` only for the projection; do not repeat the import blindly.

### Storage maintenance and backup

The import implementation uses a bounded datastore maintenance API. Reads, writes, recovery, and compaction are serialized; there are no background timers. Compaction is triggered when the journal exceeds the greater of 1 MiB or three times live data, or after 64 writes with at least 1 MiB reclaimable. A maintenance failure does not undo a successful canonical write; later writes retry maintenance, and persistent growth can reject the next write with `STORAGE_MAINTENANCE_BLOCKED`. `readStorageStatus` exposes internal live/journal bytes, peak bytes, compaction, recovery, and error state; it is not a public Mate tool.

The accepted database test run imported 8,563 vocabulary rows and 537 finance rows, then verified isolated-process restart and backup replay with counts, references, and totals. The storage test run also covers all four storage failure/concurrency cases. Its measured 8,563-row run reported a 33,483,840-byte peak journal and 25,718,220-byte final journal. The independently verified 20,000-row run measured a 59,093,150-byte peak journal, 44,432,487-byte final journal, 14,811,046-byte aggregate, 14,811,047 live bytes, 132 compactions, and 200 canonical plus 200 projection writes. The normal configured summary path adds a second aggregate status write per batch.

Verification commands:

```sh
node --test test/knowledge-db-import.test.js test/knowledge-db-import-storage.test.js
```

Back up only with writes quiesced. Restore into a separate location and fresh process, then verify database counts, source references, and filter-scoped totals. Do not copy datastore files while mutations are active. A temporary compaction snapshot requires an additional live-data-sized disk copy.

### Correction and recovery

After a save, create a fresh service binding or process and verify that the document or record can be read by stable ID. For text, use `list_knowledge_document_history` and `restore_knowledge_document` with the current revision. For databases, use the record revision and recoverable archive tools. A foreign Mate, foreign user, shared/private-invalid session, or stale captured session must be refused.

## Acceptance checklist

- Create, fresh read, correction, and stale-write rejection work through actual session-bound handlers.
- Text wiki-link content survives agent edits and history restoration.
- Structured queries return expected filtered counts and sums, with pagination not mistaken for totals.
- Import handlers preserve source identity, replay exact operations, reject changed-source payloads, resolve supported references, and expose progress mappings.
- Stable IDs, not name guesses, are used for subsequent reads and updates.
- A newly bound service and the isolated restart/backup replay checks see saved state by stable IDs, references, and totals.
- Projection errors and pending states distinguish canonical save from indexing status; only actual errors are failures, and mutations are not retried blindly.
- Clay readiness includes the Driver-runtime check that Gmail and Google Calendar `get_profile` both succeeded. Target-Mate integration checks remain reserved for the actual migration; no Argo Mate is created here.

## Limits and pending work

Nested Markdown is bounded by the existing file-store name/content/history limits. Import batches are bounded at 100 rows and 256 KiB; the database aggregate is bounded at 20,000 records and 16 MiB including stored history, mappings, archives, and receipts. Up to 500 live mutation receipts are shared across import and ordinary writes within the 24-hour retry window. Fingerprints cover both the original `sourcePayload` and typed `values`; after receipt expiry, a fresh operation ID and current database revision are required. The 20,000-row ceiling is distinct from the aggregate byte ceiling: not every payload set fits within 16 MiB. Database schemas, record fields, query pages, filters, and retry receipts remain bounded by the existing database service. Text fields accept multiline strings, while narrative multiline content is usually clearer in text documents.

The public import interface and bounded storage maintenance are implemented and covered by the cited synthetic tests. This documents user-scope readiness only; it does not claim deployed or live-migration readiness. Gmail and Google Calendar `get_profile` succeeded in the Driver runtime, while target-Mate integration checks remain reserved for the actual migration. No live migration or Argo Mate creation is performed here.
