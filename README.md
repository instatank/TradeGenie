# TradeForge Journal

A low-friction personal trading journal for discretionary crypto and Indian market trading.

The app is intentionally personal: no auth, no teams, no payments, no trade signals, and no exchange API sync in the MVP.

## Project Memory

- `AGENTS.md` is the source-of-truth operating guide for Codex/agent context.
- `PENDING_TASKS.md` is the working backlog and recommended next sequence.
- Update these files when architecture, deployment, storage, or major workflow decisions change.

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Recharts
- Zod
- date-fns
- PapaParse
- Firebase Admin / Firestore for deployed persistence
- Local JSON fallback for development when Firebase env vars are not set

## Local Setup

```bash
npm install
npm run seed
npm run dev
```

Open:

```text
http://localhost:3000
```

Without Firebase env vars, data is stored locally in:

```text
data/tradeforge-store.json
```

That file is ignored by git.

## Firebase Setup

For Vercel, create a Firebase service account and add these environment variables:

```bash
FIREBASE_PROJECT_ID="your-project-id"
FIREBASE_CLIENT_EMAIL="firebase-adminsdk-...@your-project.iam.gserviceaccount.com"
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_STORAGE_BUCKET="your-project-id.firebasestorage.app"
```

The private key should keep escaped newlines as `\n`. The app converts them at runtime.

Screenshot uploads use Firebase Storage when Firebase is configured. Create/enable Cloud Storage for Firebase in the Firebase console, then set `FIREBASE_STORAGE_BUCKET` to the bucket name shown there without `gs://`. For example, if Firebase shows `gs://PROJECT_ID.firebasestorage.app`, use `PROJECT_ID.firebasestorage.app`.

For local Firebase development, you can either use the same three env vars in `.env.local`, or use:

```bash
GOOGLE_APPLICATION_CREDENTIALS="/absolute/path/to/service-account.json"
```

## Vercel Setup

1. Create a new Vercel project pointing to this repository.
2. Framework preset: Next.js.
3. Build command: `npm run build`.
4. Install command: `npm install`.
5. Add Firebase env vars in Project Settings -> Environment Variables, including `FIREBASE_STORAGE_BUCKET`.
6. Optional: add `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`, default `claude-sonnet-4-6`) for real transcript structuring. The deterministic local extractor works without it.

## Seed Data

```bash
npm run seed
```

The seed script adds:

- Default mistake tags
- 5 sample trades
- 3 sample transcripts
- 3 sample lessons
- 2 sample daily journals

When Firebase env vars are present, seed writes to Firestore. Otherwise it writes to the local JSON fallback.

## Key Flows

- Dashboard metrics and simple behavior charts
- Voice/transcript inbox with review-before-confirm AI extraction
- Beginner daily check-in and EOD review
- Quick trade note
- Trade detail with exit review, mistakes, lessons, screenshots, and raw execution linking
- Lesson bank
- CSV import with manual mapping
- Weekly review generation

## AI Behavior

If `ANTHROPIC_API_KEY` is present and AI is enabled in settings, transcript structuring uses Claude (`ANTHROPIC_MODEL`, default `claude-sonnet-4-6`) with structured outputs for schema-valid extraction.

If the key is missing, the app uses a deterministic extractor so the journal remains usable locally and on Vercel.

The app does not give financial advice or trade recommendations.
