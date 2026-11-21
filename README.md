# Safe Route

Weather-aware route planning for truck drivers. Enter an origin, a destination, a departure time,
the cargo weight and how often to check the weather. Safe Route returns up to three truck routes
and forecasts the weather at checkpoints along each one for the hour the truck will be there. It
rates every checkpoint from Low to No Travel and recommends the route with the least exposure to
bad conditions.

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
