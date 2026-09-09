# Packaging the Web App as a Windows `.exe`

The CT Technical Instruction web app is wrapped as a desktop application with
[Electron](https://www.electronjs.org/) and packaged into a Windows installer
with [electron-builder](https://www.electron.build/). The whole app (React UI,
label templates, fonts, PDF/OCR assets) is bundled into a single `.exe`. At
runtime it talks to Supabase directly over HTTPS — no local server, Node
process, or dev proxy is needed.

## What gets produced

Running the packaging command produces, in the `release/` folder:

- **`CT Technical Instruction Setup <version>.exe`** — the NSIS installer.
  Users run it once; it installs to Program Files (or a folder they pick) and
  creates Desktop + Start Menu shortcuts.
- **`CT-Technical-Instruction-<version>-portable.exe`** — a single-file
  portable build that runs without installing.

## Build it on Windows (recommended)

On any Windows machine with [Node.js 18+](https://nodejs.org/):

```bash
npm install
npm run dist:win
```

The two `.exe` files appear in `release/`.

Other useful scripts:

| Script | What it does |
| --- | --- |
| `npm run electron:dev` | Run the app in Electron against the Vite dev server (hot reload). |
| `npm run electron:start` | Build the web assets and launch them in Electron (no installer). |
| `npm run dist:win` | Build the NSIS installer **and** the portable `.exe`. |
| `npm run dist:dir` | Build just the unpacked app folder (fast, for testing). |

## Build it from Linux / macOS

electron-builder can build a Windows installer from Linux or macOS, but it
needs **wine** (and mono) installed to stamp and sign the Windows binaries:

```bash
# Debian/Ubuntu, for example
sudo apt-get install -y wine mono-devel
npm install
npm run dist:win
```

Without wine you can still produce the **unpacked** Windows app, which is a
fully working `release/win-unpacked/CT Technical Instruction.exe` (just not the
single-file installer):

```bash
npm install
npx electron-builder --win --dir
```

## Build it in CI (no local Windows needed)

A GitHub Actions workflow at `.github/workflows/build-windows-exe.yml` builds
the installer on a Windows runner. Trigger it manually from the **Actions** tab
(*Build Windows EXE* → *Run workflow*) and download the `.exe` files from the
run's **Artifacts** section.

## App icon

The icon is `build/icon.png` (256×256). Replace that file with your own square
PNG (≥ 256×256) to rebrand the installer, shortcuts, and window.

## Notes

- The build sets Vite's `base` to `./` (relative paths) so the app loads
  correctly from `file://` inside Electron. The regular `npm run build` used for
  the Vercel/web deployment keeps absolute paths and is unaffected.
- The installer is currently **unsigned**. Windows SmartScreen may warn on first
  run; users can click *More info → Run anyway*. To ship a signed build, add a
  code-signing certificate to the electron-builder `win` config.
- The `print-agent/` PowerShell utility is a separate tool that runs on the
  printer PC and is **not** part of this desktop app.
