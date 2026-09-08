# CT-TI Label Print Agent

A small local agent for the **one** shop-floor print PC. It turns the webapp's
**Save Label** / **Print** actions into real BarTender activity, while the per-TI
quantity lock stays enforced on the server.

## What it does

The webapp writes rows into the Supabase `ct_print_jobs` queue. This agent polls that
queue and, for each job:

- **`save`** — writes the rough `.btw` into `C:\CTLabels\<itemCode>\<itemCode>.btw` and
  opens it in BarTender. You correct the label and press **Ctrl+S** to freeze it. That
  saved file is reused for every future TI with the same item code.
- **`print`** — copies the saved item-code label to a temp working file (named with the
  print job's unique GUID), then `patch-serial.js` **injects the TI's starting serial**, opens
  the label in BarTender, and **watches the Windows spooler to read how many labels were
  actually printed** — counting only spool jobs whose DocumentName carries our GUID (so other
  apps'/operators' jobs on the same printer are ignored). That real count is what gets recorded.

Quota model — **record the actual printed count** (never a number typed in the app):
clicking Print calls `begin_print`, which fixes the starting serial and queues the job (one
print session per TI at a time). The operator sets the quantity in BarTender's dialog and
prints; the agent reads the real number the printer produced and reports it, and a DB trigger
commits exactly that many against the TI. If nothing prints, nothing is counted. When the TI's
printed count reaches its quantity it locks; an **admin** unlocks it in the webapp. The webapp
status auto-refreshes, so the count appears there a few seconds after printing.

## Why manual mode (BarTender edition)

Fully-headless auto-printing needs BarTender **Automation edition** (command-line/`/XMLScript`).
Basic/Professional (or an expired Automation trial) reject it with **error #3112**, so the shop
runs **manual mode**: the agent opens the label, the operator prints, and the agent reads the
actual count. (`autoPrint: true` + `Invoke-XmlScriptPrint` remain in the agent for a future
Automation-edition upgrade, but are dormant unless a job carries a target count.)

**Requirements for a correct count:**
- **`printerName` in config.json is required** and must match the printer the operator actually
  prints to (the agent reads *that* printer's spooler). setup.bat auto-detects the SATO. If the PC
  has more than one SATO entry (e.g. `SATO SA408` and `SATO SA408 SEPL` on different USB ports),
  make sure `printerName` is the **exact** one selected in the label — otherwise the agent watches
  the wrong queue and counts 0.
- **`printPageOffset`** subtracts a fixed number of pages **per print job** from the spooler count.
  The SATO SA408 driver reports **one extra page per job** than it physically prints (a leading
  feed/config page), so set `printPageOffset: 1` for it (setup.bat now defaults to 1). If a printer
  reports the true count, set it to `0`. Verify by printing a known quantity and comparing the
  labels that come out to the count recorded in the app.
- **The label must have serialization turned ON** on the `Sr No` field (else BarTender won't let
  the operator print more than 1). Enable it once when first correcting/saving each template.

## Printer setup — REQUIRED (avoids "demonstration mode")

BarTender shows *Warning #2600* and enters **demonstration mode** — which **changes one
character in every barcode/text field** — whenever the selected printer is not a *supported*
(genuine SATO) printer. A demo-mode print produces **silently corrupted serials**, so this
must be prevented, not dismissed:

1. **Install the real SATO printer driver** on the print PC.
2. **Design each label for the SATO:** the first time you correct a label (the `save` step),
   pick the SATO printer in BarTender (File ▸ Print ▸ select SATO, or Page Setup) and **Ctrl+S**.
   The `.btw` then remembers the SATO and opens clean.
3. **Set `printerName`** in `config.json` to the exact SATO printer name (as it appears in
   Windows ▸ Printers). The agent passes `/PRN="…"` to force the supported printer.

If a demo-mode warning ever blocks a headless print, the agent's `printTimeoutSeconds` catches
the hang and marks the job `error` instead of printing corrupted labels — so a misconfigured
printer fails loudly rather than ruining a batch.

## Setup — one click

On the print PC, put this `print-agent` folder anywhere (clone the repo, or download the
repo ZIP from GitHub and copy the folder), then **double-click `setup.bat`**.

It asks for admin once, then does everything automatically:
- installs Node.js (via winget, or a direct download) if it isn't already there,
- runs `npm install`,
- auto-detects `bartend.exe` and the SATO printer,
- writes `config.json` (Supabase + agent login are baked in), and
- registers a scheduled task **"CT-TI Print Agent"** that starts the agent **at every logon**
  and starts it immediately.

After that the operator never launches anything — the agent is always running.

**Prerequisites on the print PC (do these first):**
1. The **SATO printer driver** is installed (see "Printer setup" above). Without it, BarTender
   prints in demonstration mode and corrupts a character per field.
2. `supabase/label_print_lock_patch.sql` has been applied once (already done for this project),
   and the agent login exists with `is_print_agent = true` (already created:
   `enggctpt@shubhadapolymers.com`).
3. Each item-code label under `C:\CTLabels\<itemCode>\` has been saved on this PC with the SATO
   printer selected and **serialization ON** on the `Sr No` field.

To watch the agent's live output for troubleshooting, run it in a console:
```
powershell -ExecutionPolicy Bypass -File .\print-agent.ps1
```
(The scheduled task runs the same thing minimized in the background.) To change anything later,
edit `config.json` and re-run `setup.bat`, or manage the task in **Task Scheduler**.

## Serial injection & the fallback

`patch-serial.js` replaces the value shown after **`Sr No :`** / **`SR.NO:`** on the saved
label (both formats and all 12 templates are handled, whether the file was last compressed by
the webapp or by BarTender). For it to work reliably, keep the serial as that visible text
object when you correct a label — don't delete or rename it. If the injector can't find it
(exit code 2), the agent still opens the label and records a note; just type the start serial
the webapp displayed.

## Security — agent credentials

`config.json` holds the agent's Supabase login in plaintext on the print PC. It is
`.gitignore`d and must **never** be committed. Before go-live:

- **Rotate `agentPassword` to a strong, unique secret** (the initial value was a weak
  placeholder). Change it in the Supabase dashboard (Authentication ▸ Users) or via an
  admin, then update `config.json` on the print PC and re-run `setup.bat`.
- Keep the agent account limited to `is_print_agent = true` (no `admin`/`user` role), so a
  leak of this file cannot create records or manage users — only process the print queue.
- Restrict OS access to the print PC and to `C:\CTLabels` to the operator account.

## Limitations (by design, basic license)

- **The folder isn't truly locked.** Because BarTender runs as the operator to save with
  Ctrl+S, that same account can reach `C:\CTLabels`. The server quota is the real cap. For
  true folder protection, have a **service account** own `C:\CTLabels` and launch BarTender
  as it (advanced).
- **Multi-tap templates with an external diagram image**: the `save` job ships only the
  `.btw`. Re-insert/relink the diagram once during your manual correction.
- **Full hands-free + a password-locked file** need the BarTender **Automation** edition;
  it drops into this same queue later (swap "open" for silent `/P /X` print).
