# Inkyridion
Inky captures individual records. Ridion organizes the same encrypted vault into a timeline, indexes, and two-month packets.

## Open the app
Unzip the complete folder and serve it from a static HTTPS host. For local use on a computer, run `python3 -m http.server 8000` in the folder containing index.html and open http://localhost:8000. On iPhone, open the HTTPS address in Safari and choose Share → Add to Home Screen.

If upgrading an installed copy, export and test an encrypted backup in Settings first. Serve the update from the same address and browser profile to access the existing vault. To move to another address or device, restore the encrypted backup there.

## Using the workspaces
1. Unlock Inky and write what happened. The date starts at today and can be edited. Use Record type for communications, police contacts, evidence, and specialized forms.
2. Attach evidence and save. New incidents, evidence, communications, and police contacts use INCD001, EVID001, COMM001, and POLI001. Previous IDs keep their original numbers. Each prefix has its own sequence. Financial receipts retain their RCP numbers.
3. Open Ridion to review two months of activity, the master index, or the evidence index. Library also supports imports and search.
4. Open Packets, check the dates and cases, and select Build packet. The initial period is the previous calendar month through today. Preview before printing or exporting a PDF or ZIP.
5. Back up regularly in Settings. Exported reports and packet ZIPs contain readable data. Encrypted vault backups require the passphrase.

## Technical notes
- **Storage:** IndexedDB `inkyridion-vault` — `meta` (salt, iteration count, encrypted check value, encrypted settings including record counters), `records` (one encrypted JSON per item), `files` (encrypted original bytes). Each save is a single transaction. localStorage is not used.
- **Encryption:** PBKDF2-SHA-256, 600,000 iterations, random 16-byte salt → AES-GCM-256 with a fresh 12-byte nonce per object. Auto-lock after 5–30 minutes.
- **Records made here** are stored as the record's own PDF (with its embedded `documentation-record` v2 data) plus any attached files, linked by SHA-256 fingerprint. If a record contains characters the built-in PDF can't show (emoji, non-Latin scripts), it is saved as record data (JSON) instead and can be printed.
- **Numbering:** independent counter per type, kept in the encrypted settings and always continued past every ID already in the library, so imports and restores never cause duplicates. Inky number backups can be imported in Settings.
- **Imports:** Inky v2 (`%DOCREC2-BEGIN`…), historical v1 (`%LUMIDOCKET_MANIFEST_V1_BEGIN`…), file-name and text inference for PDFs without data (marked "check"), exact-duplicate, revision, and ID-conflict handling.
- **Reports:** built-in PDF writer (US Letter, Helvetica, selectable text), neutral design with no branding, unique report IDs `PKT-YYYY-NNNN`, source digest in every footer. ZIP `manifest.json` (`documentation-packet-manifest` v1) lists SHA-256 for every other file.
- **Offline:** service worker caches the app after the first visit. The app makes no network requests.

## Known limitations
No sync between devices or people. Reports and ZIPs are not encrypted. Browser storage can be cleared — keep tested backups. Printed/scanned PDFs can't be read automatically. A fingerprint shows a file is unchanged, not who made it or that it's true. Reports are organizational summaries, not court-issued or certified documents.

Generated labels use contextual wording. More details offers Event, Occurrence, Episode, Interaction, Situation, or Matter. Episode is selected by the writer when a pattern is documented. Calls and police contacts default to Interaction. Court and financial matters default to Matter. Record codes remain the stable cross-reference.
