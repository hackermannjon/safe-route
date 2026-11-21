# Safe Route

Route planning for truck drivers. Enter an origin and a destination.
Safe Route returns the fastest truck route with its distance, driving time and main roads.

## Run locally

Requirements: Python 3.14 and Node 22. No API keys are needed.

```bash
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
python manage.py runserver 8000
```

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. In development the Vite server proxies `/api` to Django on port 8000,
so `VITE_API_URL` stays empty. The app also opens from a phone on the same network.

## Tests

```bash
cd backend && . .venv/bin/activate
python -m pytest -q && ruff check . && ruff format --check .

cd frontend
npx vitest run && npm run lint && npm run build && npm run format:check
```

Backend tests mock every external call with `respx`, so they need no network.
