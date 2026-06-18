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

This project now includes a Supabase schema in `supabase/schema.sql`.

### Create the Database

1. Create or open a Supabase project.
2. Open the Supabase SQL Editor.
3. Paste and run the full contents of `supabase/schema.sql`.
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

## Project Structure

```text
ct-ti-app/
├── supabase/
│   └── schema.sql          Supabase tables, indexes, policies, and TI number functions
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
