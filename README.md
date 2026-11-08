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

## Run it for free with no card: GitHub Pages + Supabase (recommended)
`docs/` is a complete static app. The Random Forest runs **on the device** (`docs/core.js` + `docs/model.js`, exported from Python by `export_static_model.py`), Supabase handles sign-in and each user's saved profile and history. Nothing else to host.

1. **Upload `docs/` to your GitHub repository** (drag the whole `docs` folder onto Add file > Upload files, then Commit).
2. **GitHub > Settings > Pages:** Source = *Deploy from a branch*, Branch = `main`, Folder = `/docs`, Save. After a minute your app is at `https://<your-username>.github.io/<repo>/`.
3. **Supabase > Authentication > URL Configuration:** set *Site URL* to that address and add it under *Redirect URLs*. Email sign-up works immediately (users confirm by email by default). For Google, add the provider with a Google Cloud OAuth client.
4. Open the address on your phone: Safari > Share > Add to Home Screen, or Chrome > Install app.

Already done in your Supabase project "LuFoodd": the `profiles` and `assessments` tables, with Row Level Security. Each signed-in user can read and write only their own rows; anonymous visitors get nothing (tested). `docs/config.js` holds only public values (project URL and anon key). Never put the service-role key or database password in the repo.

## Optional: Python API (FastAPI) on a server
Not needed for the free route above. Use it if you want server-side models (XGBoost/SHAP) or a central API. It needs a host that accepts a card (Render, Railway, Cloud Run); Hugging Face Docker Spaces now require a paid plan. `render.yaml` and `Dockerfile` are included; set `DATABASE_URL` (Supabase Session pooler string with your password) in the host's settings, never in git. Opening the API's own address serves the same app and switches it to this API.

## Which front end later?
| Option | Best for |
|---|---|
| **PWA (`docs/`, now)** | demo, usability testing (Experiment 5), a thesis |
| **Capacitor** | App Store / Google Play without a rewrite |
| **FlutterFlow** | native Flutter app built visually; the UI must be rebuilt |
| **Lovable** | quick React + Supabase web app; the UI must be recreated |

## Before real users: what is NOT done
- **Sign-in against a live Supabase project is untested** (no internet in my workspace). The data rules (RLS) were tested on the real database. Without `docs/config.js` keys the app uses simulated sign-in.
- **The result is never less cautious than the 2-hour/4-hour guideline**, because the model's own cut-offs are placeholders.
- **Real data.** `app/simulate.py` uses placeholder growth parameters and label cut-offs. Fit them from ComBase / published studies (`../lufood_growth.py` has `fit_secondary_model` and `validate`), then validate on held-out real growth curves. Until then the metrics only show the pipeline works.
- **Seafood** is unsupported until its target hazard and data are chosen.
- **Explanations** use SHAP when installed (tree models), otherwise sampled Shapley values on the same 0-2 risk score. They explain the model, not the microbiology.
- Allergy preferences are stored but not used in risk estimates.
- Lock down `LUFOOD_ORIGINS`, add rate limiting and HTTPS before deploying.
