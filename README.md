# Reverie Companion

A senior- and dementia-friendly companion version of Reverie, built as a standalone app folder using the same broad architecture pattern: **Capacitor shell + Render-hosted API + Supabase backend**.

## Product focus

Reverie Companion is designed for older adults, people with memory decline, and their trusted family/caregivers. The first MVP covers:

1. Extremely simple large-button home screen
2. Voice-first memory capture and search
3. Daily memory board
4. Photo-based memory cards
5. Caregiver mode
6. Medicine and appointment reminders with escalation-ready data model
7. “Where did I keep it?” object-location memory

## Tech stack

- Frontend: Vite + React + TypeScript
- Mobile shell: Capacitor
- Backend: FastAPI, deployable on Render
- Database/Auth/Storage: Supabase

## Folder structure

```text
Reverie_Companion/
  api/                  FastAPI backend for reminders, summaries, health checks
  src/                  React app
  supabase/             SQL schema and RLS policies
  capacitor.config.ts   Capacitor mobile shell configuration
  render.yaml           Render deployment blueprint for API
```

## Local setup

```bash
cd Reverie_Companion
npm install
cp .env.example .env
npm run dev
```

For the API:

```bash
cd Reverie_Companion/api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

## Environment variables

Frontend:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_API_BASE_URL=http://localhost:8000
```

Render API:

```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ALLOWED_ORIGINS=https://your-frontend-domain.com,http://localhost:5173
```

## Supabase setup

Run `supabase/schema.sql` in the Supabase SQL editor. It creates tables for profiles, caregiver links, memories, object locations, daily board items, reminders, reminder acknowledgements, photo cards, and emergency contacts.

## Capacitor build

```bash
npm run build
npx cap add android
npx cap sync android
npx cap open android
```

The app uses browser speech APIs where available. On Android, speech support should be validated in the WebView/Capacitor build and can later be replaced with native plugins if needed.

## Notes

This is an MVP scaffold intended to be extended inside the existing Reverie development workflow. It intentionally uses larger visual elements, simpler navigation, and caregiver-aware data structures from day one.
