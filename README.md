# Inkyridion
Inky captures individual records. Ridion organizes the same encrypted vault into a timeline, indexes, and two-month packets.

## Open the app
Unzip the complete folder and serve it from a static HTTPS host. For local use on a computer, run `python3 -m http.server 8000` in the folder containing index.html and open http://localhost:8000. On iPhone, open the HTTPS address in Safari and choose Share → Add to Home Screen.

If upgrading an installed copy, export and test an encrypted backup in Settings first. Serve the update from the same address and browser profile to access the existing vault. To move to another address or device, restore the encrypted backup there.

## Using the workspaces (Save & Send)
**Enter once. Store once. Link anywhere. Generate when ready.**

1. **Create** — From the Dashboard choose a documentation form: Incident Report (INCD), Concerns Raised (CONC), Communication Log (COMM), Evidence Intake (EVID), Police Report (POL), or Parenting Exchange (EXCH). Other record types (parenting issue, financial, court, child & care) are on Inky. Attach evidence and link stored records with **＋ Link a stored record**.
2. **Save & Send** — validates required fields, assigns the record ID, and stores the record, its attachments, and the number counters in one IndexedDB transaction. The confirmation ("Record INCD005 saved successfully to the Records Library.") with **View Record | New Entry | Return to Dashboard** appears only after the transaction completes. If it fails, the form is kept and **Try again** reuses the same submission ID. Save & Send is internal storage only — nothing is sent to another person, server, attorney, or court.
3. **Store & organize** — the record appears immediately in the Records Library, Ridion calendar and timeline, master index, evidence index, and report builder (all derived from the stored records, never separate copies). Open a record to add links, mark it **Ready for Report**, or **Correct this record** (same ID, next revision; earlier versions kept).
4. **Generate Report** — Reports compiles the selected records (optionally only those marked Ready for Report) into a printable packet. Records in a generated report show **Included in Report**; source records are never altered or deleted.
5. Back up regularly in Settings. Backups include records, files, and drafts. Exported reports and packet ZIPs contain readable data.

### Record status
| Status | Meaning |
|---|---|
| Draft | Saved with **Save draft**, encrypted, but not in the Records Library and not numbered |
| Stored | In the Records Library |
| Ready for Report | Independent selection made by the user |
| Included in Report | Listed in the log of a generated report |

### Color guide
Generated records and reports use the project color guide: a Cotton header band with the Inkyridion logo, Seaworthy headings and table headers, and one palette color per record group — Incident (Clay), Concerns (Lavender), Communications (Moody Blue), Evidence (Slate), Police (Seaworthy), Parenting & exchanges (Sage), Child & Care (Green Onyx), Financial (Moss), Court (Oakmoss). Text uses a darker shade of each color where needed for readability. The palette lives in `Lib.PAL` / `Lib.CAT` in `lib.js`.

## Technical notes
- **Storage:** IndexedDB `inkyridion-vault` (version 2; upgrades only add stores) — `drafts` (encrypted unfinished entries), `meta` (salt, iteration count, encrypted check value, encrypted settings including record counters), `records` (one encrypted JSON per item), `files` (encrypted original bytes). Each save is a single transaction. localStorage is not used.
- **Encryption:** PBKDF2-SHA-256, 600,000 iterations, random 16-byte salt → AES-GCM-256 with a fresh 12-byte nonce per object. Auto-lock after 5–30 minutes.
- **Records made here** are stored as the record's own PDF (with its embedded `documentation-record` v2 data) plus any attached files, linked by SHA-256 fingerprint. If a record contains characters the built-in PDF can't show (emoji, non-Latin scripts), it is saved as record data (JSON) instead and can be printed.
- **Records:** each keeps a permanent internal UUID (`recordUuid`, stable across revisions), the human-readable ID, type, title, event/creation/modification dates, form data, attachment references (SHA-256), related IDs, status, and change history. A `submissionId` per Save & Send makes repeated clicks and retries idempotent. Possible duplicates (same type and date with a similar description, or an identical attachment) trigger a warning, never automatic deletion.
- **Links:** stored once on the record that made them and shown on both records. Invalid IDs, self-links, and repeat links are refused; removing a link or a linked record asks first.
- **Numbering:** independent counter per type (POL and EXCH continue from the older POLI and EXC sequences), kept in the encrypted settings and always continued past every ID already in the library, so imports and restores never cause duplicates. Inky number backups can be imported in Settings.
- **Imports:** Inky v2 (`%DOCREC2-BEGIN`…), historical v1 (`%LUMIDOCKET_MANIFEST_V1_BEGIN`…), file-name and text inference for PDFs without data (marked "check"), exact-duplicate, revision, and ID-conflict handling.
- **Reports:** built-in PDF writer (US Letter, Helvetica, selectable text), color-guide design with the logo (embedded JPEG from `assets/logo-doc.js`), unique report IDs `PKT-YYYY-NNNN`, source digest in every footer. ZIP `manifest.json` (`documentation-packet-manifest` v1) lists SHA-256 for every other file.
- **Offline:** service worker caches the app after the first visit. The app makes no network requests.

## Known limitations
No sync between devices or people. Reports and ZIPs are not encrypted. Browser storage can be cleared — keep tested backups. Printed/scanned PDFs can't be read automatically. A fingerprint shows a file is unchanged, not who made it or that it's true. Reports are organizational summaries, not court-issued or certified documents.

Generated labels use contextual wording. More details offers Event, Occurrence, Episode, Interaction, Situation, or Matter. Episode is selected by the writer when a pattern is documented. Calls and police contacts default to Interaction. Court and financial matters default to Matter. Record codes remain the stable cross-reference.
