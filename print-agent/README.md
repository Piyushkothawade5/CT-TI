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
- **`print`** — copies the saved item-code label to a temp working file, then
  `patch-serial.js` **injects the TI's starting serial**. Then (auto mode) it prints via
  **BarTender XML Script** (`bartend.exe /XMLScript=…`) with `<NumberSerializedLabels>qty</…>`
  — a **single** headless job that produces all `qty` labels, BarTender incrementing the
  serial across them (e.g. 300 labels = one job, not 300). The temp file is deleted afterward.

Quota is **reserve → confirm**: clicking Print calls `reserve_ti_labels`, which reserves the
serial range against the TI quantity and queues the job. The count is only *committed* against
the TI when this agent reports the job `done` (a DB trigger moves reserved→issued); if the job
ends in `error`, the reservation is released, so **a failed print never consumes quota**. Once a
TI's printed count reaches its quantity it locks; an **admin** unlocks it in the webapp.

## Print modes (`autoPrint` in config.json)

- **`autoPrint: true`** (default) — fully headless: inject the serial, then one
  **XML Script** job (`/XMLScript`) prints all `qty` serialized labels. Nothing opens on
  screen, the operator can't touch the serial, and 300 labels is one job. If BarTender
  raises an error dialog (e.g. wrong/missing printer), the agent reads it, kills BarTender,
  and marks the job `error` — it never leaves a batch half-printed or hanging.
- **`autoPrint: false`** — manual: the agent opens the label in BarTender with the serial
  injected; the operator sets the quantity in the Print dialog and clicks **Print**.

**The label must have serialization turned ON** on the `Sr No` field, or BarTender ignores
the quantity and prints 1. Enable it once when you first correct/save each template.

The real "can't exceed qty" cap is always the **server quota**, independent of print mode.

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
