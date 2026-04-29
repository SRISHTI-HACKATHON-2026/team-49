# Care Companion

Care Companion is a lightweight chat-based web app that:

- detects tone (`LOW`, `MEDIUM`, `HIGH`) using backend rule-based logic
- stores user messages in MongoDB via Mongoose
- generates subtle conversational replies via OpenRouter

## Stack

- Next.js (App Router) + Tailwind CSS
- Next.js API routes (Node.js runtime)
- MongoDB + Mongoose
- OpenRouter Chat Completions API

## Environment Variables

Create `.env.local` from `.env.example`:

```bash
MONGODB_URI=mongodb://127.0.0.1:27017/care_companion
OPENROUTER_API_KEY=your_openrouter_api_key_here
OPENROUTER_MODEL=openai/gpt-4o-mini
```

## Run Locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## API Endpoints

- `POST /api/chat`
  - input: `{ "text": "..." }`
  - flow: detect tone -> store in DB -> generate OpenRouter reply
  - output: `{ "reply": "...", "tone": "LOW|MEDIUM|HIGH" }`

- `GET /api/history`
  - output: last 10 stored user messages (oldest to newest)
