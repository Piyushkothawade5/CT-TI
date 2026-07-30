# CT Technical Instruction System

A React + Vite app for managing CT (Current Transformer) Technical Instructions.

## Local Setup

### Prerequisites

- Node.js 18+
- npm 9+
- A Supabase project, if you want shared database storage

### Install & Run

```bash
npm install
npm run dev
```

Open http://localhost:5173 in your browser.

## Supabase Database

This project now includes a consolidated Supabase bootstrap schema in `supabase/bootstrap_complete.sql`.

### Create the Database

1. Create or open a Supabase project.
2. Open the Supabase SQL Editor.
3. Paste and run the full contents of `supabase/bootstrap_complete.sql`.
4. Copy your project URL and anon public key from Project Settings > API.
5. Create a local `.env` file from `.env.example`:

```bash
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

6. Restart the Vite dev server.

When those two environment variables are present, the app reads and writes:

- `ct_items`
- `ct_ti_records`
- `ct_ti_counter`

If the Supabase environment variables are missing, the app falls back to browser `localStorage` so it can still run offline during development.

## Build for Production

```bash
npm run build
npm run preview
```

## Label Printing

The app downloads dynamic BarTender `.btw` label files directly in the browser, using fixed-size templates bundled in `public/label-templates`:

```text
CT-TI App -> bundled .btw template -> generated TI .btw download
```

Use `docs/bartender-label-download.md` for the current BarTender UltraLite workflow. No local helper, Node service, or printer PC installer is required.

## Drawing Storage

New item drawings can be uploaded through a Cloudflare Worker/R2 endpoint. The app saves only the returned drawing link in Supabase item master records. Use `docs/cloudflare-drawing-storage.md` and run `supabase/item_drawing_links_patch.sql` for existing Supabase projects.

## Project Structure

```text
ct-ti-app/
├── supabase/
│   ├── bootstrap_complete.sql  Full production bootstrap schema including Work Orders
│   └── schema.sql              Base TI schema and auth policies
├── src/
│   ├── api-client/         Supabase/localStorage API hooks
│   ├── components/
│   │   ├── ti-form/        TI form components and PDF generation
│   │   └── ui/             shadcn/ui components
│   ├── hooks/              Custom React hooks
│   ├── lib/                Utilities
│   ├── pages/
│   │   ├── home.tsx        Main TI form page
│   │   ├── login.tsx       Login page
│   │   └── not-found.tsx
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── public/
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```
