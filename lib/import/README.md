# Server import caller contract

`readRows` accepts picked-file bytes, reads CSV or the first XLSX worksheet, and
returns every heading. `matchHeadings` reports matched, unread and missing
fields. `checkRows` keeps all rows and problems. Run these on the server before
creating an immutable review for the current actor. Browser components never
import `lib/import/index.js`, a generated client or records access.

`saveRows(checked, { model, prepare })` uses one atomic `modelBatch` and returns
`{savedIds, savedCount}` only after confirmation. It supports simple String,
Boolean, Int, Float and Json createMany rows. DateTime, Decimal, BigInt, Bytes,
enums, relations, tags and operation objects are refused. Explicitly map and
convert source cells in `prepare`; CSV strings are not a universal model import.
Bounds may refuse before a write. An unforeseeable generated result or transport
failure can remain unconfirmed after a write. Never claim every refusal saved
zero, or offer blind retry. `undoRows(ids, {model})` returns the actual removed
count, which can be lower than the saved count.

## Authority and UI callbacks

The application selects a fixed model from its selected schema on the server.
For tenant/owner apps it derives the current actor and owner from the trusted
session and enforces that ownership on every operation. A heading, source row,
client model string or owner column is never authority. The generic helper keeps
the selected project/store authority; it cannot invent an app's tenant policy.

Render `ImportCheck` from `components/ui/import-check` with `checked`, `headings`,
`fieldLabels` from the app's translations, and an opaque `reviewKey`. Store the
immutable checked rows, model and owner with that key server-side. Keys are
unique and never reused; replace the key when file, mapping or review changes.
The server expires keys and caps its review/receipt store. Authorize the review
against the current actor each time. Serialize/consume its save intent so a
repeat or concurrent submission cannot write it again, including after doubt.

The browser callback `onSave(reviewKey)` calls that authorized server action.
Only after `saveRows` confirms, store its IDs with the model, actor/owner and
review identity in a server-held undo receipt. Return `{savedCount, receipt}`
where receipt is an opaque string of at most 128 characters. Never return a
client-controlled model/owner or accept client IDs as an undo grant.
`onUndo(receipt)` reauthorizes actor/owner/review, rejects foreign, expired or
already used receipts, serializes/consumes the undo intent and calls `undoRows`
with the server-held IDs/model. Return only confirmed `{removedCount}`.
If either action's outcome is unknown, retain that state server-side for
inspection. Do not re-enable a spent save or undo grant by issuing another key.

A server caller's write core, after its authorization/one-use claim, is:

```js
// Only under lib/data/. Client input is the opaque review key, never rows/model.
const review = await claimReviewFor(currentActor, reviewKey);
// claimReviewFor checks actor/owner and claims one immutable pending review.
const result = await saveRows(review.checked, {
  model: 'Client', // fixed trusted selected-schema model
  prepare: row => ({ tax: row.tax, name: row.name, ownerId: review.ownerId }),
});
const receipt = await issueUndoFor(currentActor, review, 'Client', result.savedIds);
return { savedCount: result.savedCount, receipt };
```

`claimReviewFor` and `issueUndoFor` are application-owned authorization/state
operations, not exports of this part. Adapt the selected model's supported
scalar fields and owner policy. The example requires a scalar `ownerId` field;
never spread arbitrary file fields into the saved data. Its server action must
record unknown outcomes if save or receipt creation throws after the claim.
An undo action uses an equivalent claimed receipt, never client IDs.

ImportCheck rejects stale callback results, serializes save/undo, hides old
receipts on a new review and disables further actions after an unknown result.
Its counts describe reviewed rows; saved/removed words use confirmed replies.
Those UI safeguards supplement the server's authority and one-use state.
