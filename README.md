# LuFood backend

Software-only food-safety risk prediction from cumulative time-temperature exposure.
Four layers, matching the architecture diagram:

| Layer | Where | Tech |
|---|---|---|
| 1. User interface | `frontend/index.html` (served at `/`) | HTML/JS prototype (swap for React / Next.js / Flutter later) |
| 2. Data processing | `app/core.py` | Python, Pandas, NumPy |
| 3. AI prediction engine | `app/ml.py`, `train.py` | Logistic Regression, Random Forest, XGBoost (if installed); SHAP (if installed) |
| 4. Results and database | `app/db.py`, `app/main.py` | SQLite locally, PostgreSQL / Supabase via `DATABASE_URL` |

`app/service.py` holds the logic without any web framework, so it is easy to test. `app/main.py` is a thin FastAPI wrapper.

## Run it
```bash
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt          # add requirements-extra.txt for XGBoost + SHAP
python train.py                                        # trains models, saves models/model.joblib
pytest                                                 # core + API tests
uvicorn app.main:app --reload                          # open http://localhost:8000
```
Opening `http://localhost:8000` serves the app and switches it to this API ("Computed by: Random Forest via LuFood API" appears on the result). Opened anywhere else, the page falls back to its built-in model.

## API
| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | status and model info |
| POST | `/api/assess` | `{food: "chicken"\|"rice", total_hours, readings: [{hour, temp_c}]}` returns label, probabilities, contributions, recommendation, reference. Saved to history when `X-User-Id` is sent. |
| GET / DELETE | `/api/assessments` | history for `X-User-Id` |
| GET / PUT | `/api/profile` | name, allergies, cooking (`rare`/`some`/`often`/`daily`) |

Interactive docs: `http://localhost:8000/docs`.

## Supabase (PostgreSQL)
1. Create a project, copy the Postgres connection string (Project Settings > Database).
2. `cp .env.example .env`, set `DATABASE_URL`, and load it (e.g. `export $(grep -v '^#' .env | xargs)`).
3. Tables are created on first start. Enable Row Level Security if the browser will ever talk to Supabase directly.

## Which platform? (short answer)
This is a custom Python stack, so no builder replaces the backend: **FastAPI + the scikit-learn model must run on a server** (Render, Railway, Google Cloud Run or Fly.io), with **Supabase** for Postgres and Auth. The front end is the only part a platform choice changes:

| Option | Best for | Notes |
|---|---|---|
| **PWA (this folder, now)** | demo, usability testing, a thesis | installable from the browser on iOS/Android, no app-store approval, free |
| **Capacitor** | App Store / Google Play without a rewrite | wraps `frontend/index.html` in a native shell |
| **FlutterFlow** | native Flutter app built visually | calls this API through its API Manager; the UI must be rebuilt (the HTML cannot be imported) |
| **Lovable** | quick React + Supabase web app | tightly tied to Supabase; calls this API as an external API; the UI must be recreated |

## Install on a phone (PWA)
Serve the API over HTTPS (below), open the URL in Safari (iOS: Share > Add to Home Screen) or Chrome (Android: Install app). The manifest, service worker and icons are in `frontend/`. Offline, the app falls back to its built-in model.

## Deploy (your Supabase project "LuFoodd" is already set up)
Done already: the two tables exist in Supabase with Row Level Security on (only this backend can read them), and `render.yaml` holds your project URL and publishable key.

1. **GitHub:** create a repository and upload everything in this folder (Add file > Upload files).
2. **Database URL (secret):** Supabase dashboard > Connect > *Session pooler* connection string. Replace `[YOUR-PASSWORD]` with your database password. Never paste it in chat or commit it to git.
3. **Render:** New > Blueprint > pick the repo. When asked, set `DATABASE_URL` (step 2) and `LUFOOD_ORIGINS` (your Render address, e.g. `https://lufood.onrender.com`). Free services sleep when idle, so the first load can be slow.
4. **Supabase > Authentication > URL Configuration:** set Site URL and add a Redirect URL, both to your Render address. Email sign-in works immediately (by default users must confirm their email). For Google, add the Google provider and paste the Client ID/secret from Google Cloud.
5. Open your Render address, sign up, run an assessment. The result should say "via LuFood API", and a row appears in Supabase > Table Editor > assessments.

Token checking works with either key type: asymmetric keys (JWKS), a `SUPABASE_JWT_SECRET`, or, if neither, by asking Supabase Auth itself.
Untested here: the Docker build, Render, and live Supabase / Google sign-in (no network in my workspace).

## Before real users: what is NOT done
- **Authentication is wired but untested against a live Supabase project.** Without Supabase env vars the app uses simulated sign-in and the dev `X-User-Id` header.
- Profile and history are not yet loaded from the server on a new device (they sync up, not down).
- **Real data.** `app/simulate.py` uses placeholder growth parameters and label cut-offs. Fit them from ComBase / published studies (`../lufood_growth.py` has `fit_secondary_model` and `validate`), then validate on held-out real growth curves. Until then the metrics only show the pipeline works.
- **Seafood** is unsupported until its target hazard and data are chosen.
- **Explanations** use SHAP when installed (tree models), otherwise sampled Shapley values on the same 0-2 risk score. They explain the model, not the microbiology.
- Allergy preferences are stored but not used in risk estimates.
- Lock down `LUFOOD_ORIGINS`, add rate limiting and HTTPS before deploying.
