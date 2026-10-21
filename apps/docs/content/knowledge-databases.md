# Knowledge databases

A Knowledge database is a typed table with records, schemas, views, and recoverable history. Use it when the same fields recur across many items—for example a research register with title, status, source, and review date.

## Create a database and schema

1. Open **Knowledge** in the intended workspace.
2. Open the create menu and choose **New database**.
3. Enter a database name and create it.
4. Open **Schema**.
5. Use **Add field**, choose names and types, then **Save schema**.

Supported types are **title**, **text**, **number**, **boolean**, **date**, **select**, **multi-select**, and **reference**. Select fields have options. References can point to eligible Knowledge documents or records.

Keep a useful title field and choose types when adding a field. Existing field types are locked in the schema editor. Use **Required** to require a value and **Archived** to retire an eligible field or select option while preserving its identity and recorded data. The title field cannot be archived. Renaming a field is different from creating another field with a similar name.

## Add and edit records

Select **New record**, complete the fields, and save. Select an existing row, then **Edit fullscreen** to change it. A record's history belongs to that record; a table view is a presentation of the same stored records.

Use **Archive** for a record you want removed from the active listing. **Archived records** switches the listing, and **Recover fullscreen** lets you review recovery before confirming. The same principle applies to an archived database through recoverable Knowledge.

For a reference field, choose **Text item** or **Database record** and the target database where needed. A document reference uses its stable item ID; the record input uses `databaseId:recordId`. Ask the assistant to locate the exact eligible target when you do not know its identifier. A filename or row position is not a substitute for a stable ID.

References can show missing or unavailable targets. That status does not grant access to another owner's content. Open a record's detail to inspect its recorded revision history; a failed or stale save should not be treated as a new committed revision.

## Save views

Open **Views**, choose or create a **New view**, and set its name, displayed columns, filter, and sorting. Select **Save view**. Use the **Table view** selector to return to a saved view.

For example, a “Needs review” view can filter the status field and sort by review date. Choose the field, an operator such as `eq` (equals), `contains`, `empty`, or a supported comparison, and a value appropriate to the field type. Choose a sort field and Ascending/Descending direction. A filtered-out record is not deleted.

The compact editor handles one filter and one sort. If an existing view contains several, those controls are locked while the name and columns remain editable; the existing filter/sort order is preserved. Do not recreate a complex view merely to change its name. Clear or change the selected view before concluding that an import or save lost data.

## Import through the assistant

The Knowledge tools support structured imports; there is no general CSV-upload button implied here. Ask an eligible assistant to inspect a source, map fields to the existing schema, and import the reviewed rows.

Imports use stable source identities and immutable source payloads. The supported tool accepts up to **100 rows and 256 KiB per batch**. Ask for import progress and native record IDs. Reimporting changed data under the same source identity can conflict; later corrections should update the native records.

If a save reports a stale revision, reload current state and reconcile your draft. If storage succeeded but projection sync failed, use **Retry sync** and inspect existing records before importing again.

See [Knowledge documents](/docs/knowledge-documents) and [Stop and recovery](/docs/stop-recovery).
