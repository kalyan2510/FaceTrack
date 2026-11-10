# FaceTrack — Smart Face Recognition Attendance System

FaceTrack is a complete attendance management system built with **Flask + OpenCV + SQLite** on the backend and **HTML5, CSS3, JavaScript, Bootstrap 5, Chart.js and Font Awesome** on the frontend.

It supports real webcam face registration and recognition through OpenCV's **Haar Cascade + LBPH** recognizer, duplicate-safe daily attendance, student management, analytics, and Excel/CSV/print exports. The frontend is fully static and can be served with VS Code Live Server or GitHub Pages.

> **Honesty guarantee:** FaceTrack never pretends that recognition succeeded. A sample is only saved when exactly one valid face is detected. A student is only marked present when the LBPH model returns a match inside the configured distance threshold. Unknown faces are reported as **Unknown** and are never marked present. The browser-only **Demo Mode** clearly labels every simulated action and never claims a real face match.

---

## 1. Features

- **Authentication** — admin login with hashed passwords and bearer-token sessions.
- **Dashboard** — today's stats, weekly/monthly Chart.js charts, recent attendance, quick actions and notifications.
- **Students** — create, edit, search, filter, delete and optionally upload a profile photo.
- **Face Registration** — browser webcam capture; every frame is validated by OpenCV; only a single face is accepted; samples are stored locally and the LBPH model retrains automatically.
- **Take Attendance** — live recognition loop with manual scan, confidence display, unknown-face handling and duplicate prevention through a unique database constraint.
- **Attendance Records** — daily roster and student-wise percentages, date navigation, search by **name or student ID**, department/status filters, manual marking for today, Excel/CSV export and print.
- **Reports & Analytics** — overall KPIs, daily/weekly/monthly/department charts, student-wise table, range presets, exports and print.
- **Settings** — admin profile, password change, preferred camera, scan interval, preview mirroring, live system diagnostics, connection test, demo reset and logout.
- **Demo Mode fallback** — when the Flask backend is offline, the UI shows a clear warning and uses realistic `localStorage` sample data. Face capture and recognition are disabled, and simulated attendance is explicitly labelled.

---

## 2. Project structure

```
FaceTrack/
├── backend/
│   ├── app.py                  # Flask REST API
│   ├── attendance_manager.py   # attendance, daily/weekly/monthly/report logic
│   ├── database.py             # SQLite schema, seed admin + 15 students + attendance
│   ├── excel_export.py         # openpyxl Excel + CSV generation
│   ├── face_recognition.py     # Haar Cascade detection + LBPH recognition
│   ├── requirements.txt
│   ├── database/
│   │   └── attendance.db       # created automatically on first run
│   ├── dataset/                # registered face samples (local only)
│   └── trainer/                # LBPH model + labels JSON
├── frontend/
│   ├── login.html
│   ├── index.html              # dashboard
│   ├── students.html
│   ├── face-registration.html
│   ├── attendance.html
│   ├── records.html
│   ├── reports.html
│   ├── settings.html
│   ├── css/
│   │   ├── style.css
│   │   └── responsive.css
│   ├── js/
│   │   ├── config.js           # ← change API_BASE_URL here
│   │   ├── app.js              # shared API client, demo store, layout
│   │   ├── dashboard.js
│   │   ├── students.js
│   │   ├── face-registration.js
│   │   ├── attendance.js
│   │   ├── records.js
│   │   ├── reports.js
│   │   └── settings.js
│   └── assets/images/
│       ├── logo.svg
│       └── login-illustration.svg
├── .github/workflows/pages.yml # optional GitHub Pages deployment
├── .gitignore
└── README.md
```

---

## 3. Requirements

| Component | Version |
|---|---|
| Python | 3.10+ (tested with 3.13) |
| Flask | 3.x |
| OpenCV contrib | 4.x (`opencv-contrib-python`) |
| Excel export | OpenPyXL 3.x |
| CSV export | Python standard library `csv` |
| Browser | Chrome, Edge or Firefox with webcam access |

> **Important:** install **`opencv-contrib-python` only**. Do not install `opencv-python` or `opencv-python-headless` at the same time — they overwrite the same `cv2` package and can break `cv2.CascadeClassifier` / `cv2.face`.
>
> **Pandas is not used anywhere in FaceTrack.** Excel files are written directly with OpenPyXL and CSV files with the built-in `csv` module. This avoids pandas' compiled DLLs, which some Windows Application Control policies block.

---

## 4. Run the backend (Windows PowerShell)

```powershell
cd D:\FaceTrack\backend

# Optional but recommended: virtual environment
python -m venv venv
.\venv\Scripts\Activate.ps1

# Install dependencies
pip install -r requirements.txt

# Start the API
python app.py
```

Expected output:

```
==============================================================
  FaceTrack API - Smart Face Recognition Attendance System
==============================================================
  API root      : http://127.0.0.1:5000/api
  Health check  : http://127.0.0.1:5000/api/health
  Admin login   : <admin email> / <admin password>
  Database      : ...\backend\database\attendance.db
  OpenCV        : 4.14.0
  LBPH available: True
```

Leave this terminal open. On the very first run the backend creates the SQLite database and
seeds the administrator account. **Sample students and sample attendance are opt-in only** —
set `FACETRACK_SEED_DEMO=1` before the first start if you want the 15 demo students and
75 days of demo attendance. Without it, the database starts empty (except for the admin)
so no fake data ever appears in live reports.

### Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `FACETRACK_HOST` | Bind host | `127.0.0.1` |
| `FACETRACK_PORT` | Bind port | `5000` |
| `FACETRACK_DEBUG` | Flask debug mode (`1` = on) | off |
| `FACETRACK_ADMIN_EMAIL` | Admin email when DB is created | `admin@facetrack.com` |
| `FACETRACK_ADMIN_PASSWORD` | Admin password when DB is created | `Admin@123` |
| `FACETRACK_CORS_ORIGINS` | Allowed CORS origins (comma-separated, or `*`) | Live Server ports 5500/5501 |
| `FACETRACK_SEED_DEMO` | Seed demo students + attendance (`1` = on) | off |

By default CORS only allows the local static frontend (`http://127.0.0.1:5500`,
`http://localhost:5500`, plus port 5501). Set `FACETRACK_CORS_ORIGINS=*` for a hosted
deployment, or list your frontend origin(s).

### Change the default password

Sign in, open **Settings → Password & Security**, and update it before real use.
If the admin password has already been changed, use the new credentials to log in.

---

## 5. Run the frontend

### Option A — VS Code Live Server (recommended for local use)

1. Open the `D:\FaceTrack\frontend` folder in VS Code.
2. Install the **Live Server** extension.
3. Right-click `login.html` → **Open with Live Server**.
4. The app opens at `http://127.0.0.1:5500/login.html`.

The backend must be running at `http://127.0.0.1:5000/api`.

### Option B — Python static server

```powershell
cd D:\FaceTrack\frontend
python -m http.server 5500
```

Then open <http://127.0.0.1:5500/login.html>.

### Connect the frontend to a different backend

Edit **only** `frontend/js/config.js`:

```js
window.FACETRACK_CONFIG = {
  API_BASE_URL: "http://127.0.0.1:5000/api",
  ...
};
```

Examples:

```js
// Backend hosted over HTTPS (required for GitHub Pages)
API_BASE_URL: "https://your-facetrack-api.onrender.com/api"
```

For local development the frontend may be served from `http://127.0.0.1:5500` while the API runs on `http://127.0.0.1:5000`; CORS is already enabled for `/api/*`.

> **Camera note:** browsers only allow `getUserMedia()` on `localhost` or HTTPS. A plain-HTTP LAN address such as `http://192.168.1.10:5500` will block the camera.

---

## 6. Login and Demo Mode

### Live backend

- URL: `http://127.0.0.1:5500/login.html`
- Email: `admin@facetrack.com` (default) — or the email set via `FACETRACK_ADMIN_EMAIL`
- Password: `Admin@123` (default) — or the password set via `FACETRACK_ADMIN_PASSWORD`; change it in Settings after first login

If the admin credentials were already changed, use those instead. The temporary QA admin created during testing (`qa-temp@facetrack.local`) has been removed.

### Demo Mode (no backend required)

Click **Use Demo Mode** on the login page, or simply open the frontend while Flask is stopped. The app then:

- shows a visible **Demo Mode** banner and sidebar status;
- uses realistic sample data stored under `facetrack_demo_v3`;
- **disables face capture, face validation and live recognition**;
- offers a clearly labelled **Run Simulated Scan (Demo)** button on the attendance page;
- marks demo exports with `DEMO — sample data only`.

Demo Mode is a UI preview. It does **not** prove that face recognition works on your machine.

---

## 7. How face registration and recognition work

### Registration

1. Select a student on **Face Registration**.
2. Press **Start Camera** and allow browser access.
3. Press **Capture Sample**. The frame is sent to `POST /api/faces/validate`.
4. The backend runs Haar Cascade detection:
   - no face → sample rejected (`NO_FACE`);
   - more than one face → sample rejected (`MULTIPLE_FACES`);
   - exactly one face → thumbnail accepted by the UI.
5. Repeat for **3–5 samples** with slight angle/expression changes.
6. Press **Register Face**. Each accepted sample is saved under `backend/dataset/<student_id>/` and the LBPH model retrains automatically.

Only **validated, single-face** samples are accepted. Nothing is uploaded to a third-party service.

### Attendance

1. Open **Take Attendance** and press **Start Camera**.
2. The browser sends a frame to `POST /api/recognition/recognize` every scan interval (default 2.6 s).
3. Haar Cascade detects faces; LBPH compares them with the trained model.
4. If the distance is below `FACETRACK_MATCH_THRESHOLD` (default `72`), the student is recognised.
5. Attendance is written once per student per day. The `UNIQUE(student_id, date)` constraint blocks duplicates.
6. Unknown or low-confidence faces are reported as **Unknown** and are **not** marked present.

### Tuning recognition

- `FACETRACK_MATCH_THRESHOLD` (backend env var) controls strictness. Lower = stricter.
- Keep `frontend/js/config.js → MATCH_THRESHOLD` in sync for display purposes.
- Better results come from **even lighting**, **no backlight**, and **3–5 varied samples per student**.

---

## 8. API reference

Base URL: `http://127.0.0.1:5000/api`

All routes except `/health`, `/auth/login` and `/` require:

```
Authorization: Bearer <token>
```

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/health` | Backend, database and OpenCV status |
| POST | `/auth/login` | Login, returns bearer token |
| POST | `/auth/logout` | Invalidate current token |
| GET | `/auth/me` | Current admin |
| PUT | `/admin/profile` | Update name/email |
| POST | `/admin/change-password` | Change password |
| GET | `/students` | List/search students (`search`, `department`, `year`) |
| POST | `/students` | Create student |
| GET | `/students/<id>` | Student details + 30-day summary |
| PUT | `/students/<id>` | Update student |
| DELETE | `/students/<id>` | Delete student + samples |
| POST | `/students/<id>/photo` | Upload profile photo (multipart `photo`) |
| GET | `/students/<id>/photo` | Profile photo |
| GET | `/faces/model` | Engine capabilities, model and session state |
| GET | `/faces/status/<id>` | Sample count and registration status |
| POST | `/faces/validate` | Validate exactly one face (no storage) |
| POST | `/faces/register` | Save a validated sample and retrain |
| POST | `/faces/train` | Manually retrain the LBPH model |
| POST | `/recognition/start` | Open a recognition session |
| POST | `/recognition/stop` | Close the session |
| GET | `/recognition/status` | Session state |
| POST | `/recognition/recognize` | Recognize one base64 frame and mark attendance |
| GET | `/attendance/daily` | Daily roster (`date`, `search`, `department`, `status`) |
| GET | `/attendance/records` | Flat records (`from`, `to`, `search`, `department`) |
| GET | `/attendance/student/<id>` | One student's history |
| POST | `/attendance/mark` | Manual attendance (today only) |
| GET | `/attendance/summary` | Today's live summary + recent check-ins |
| GET | `/attendance/export` | Excel/CSV export (`format`, `from`, `to`, `search`, `department`) |
| GET | `/dashboard/stats` | Dashboard payload |
| GET | `/reports/overview` | Report KPIs, daily/weekly/monthly/departments |
| GET | `/reports/students` | Student-wise percentages (`from`, `to`) |
| GET | `/settings/system` | Runtime diagnostics and record counts |
| GET | `/settings/departments` | Department list |

### Example via PowerShell

```powershell
$base = "http://127.0.0.1:5000/api"
$login = Invoke-RestMethod "$base/auth/login" -Method Post `
  -ContentType "application/json" `
  -Body (@{ email = "admin@facetrack.com"; password = "Admin@123" } | ConvertTo-Json)

$headers = @{ Authorization = "Bearer $($login.token)" }

Invoke-RestMethod "$base/students" -Headers $headers | ConvertTo-Json -Depth 4
Invoke-RestMethod "$base/reports/overview?from=2026-10-12&to=2026-11-10" -Headers $headers | ConvertTo-Json -Depth 5
```

---

## 9. Export and print

- **Excel** uses `openpyxl` on the backend and SheetJS in Demo Mode.
- **CSV** uses UTF-8 with a BOM so Excel opens Indian names correctly.
- Exports respect the active date range, search **name or student ID**, and department filter.
- **Print** uses the browser print dialog with dedicated print CSS (sidebar, filters and action buttons are hidden).

---

## 10. Upload to GitHub

From `D:\FaceTrack`:

```powershell
cd D:\FaceTrack

git init
git add .
git commit -m "Initial FaceTrack project"

# Create an empty repository on github.com first, then:
git remote add origin https://github.com/YOUR-USERNAME/FaceTrack.git
git branch -M main
git push -u origin main
```

If Git asks for credentials, use a **GitHub personal access token** as the password, or sign in with GitHub Desktop / Git Credential Manager.

> The `.gitignore` excludes the generated SQLite database, `__pycache__`, virtual environments, face samples and trained models. On first backend run these are regenerated. If you specifically want to ship the seeded database, remove the `backend/database/*.db` rule before committing.

---

## 11. Deploy the frontend to GitHub Pages

GitHub Pages can only serve a repository root or a `/docs` folder from a branch. Because this project keeps the frontend inside `/frontend`, use the included **GitHub Actions** workflow.

### Steps

1. Push the repository to GitHub (see above).
2. Open **Settings → Pages** in the repository.
3. Under **Build and deployment → Source**, choose **GitHub Actions**.
4. The workflow `.github/workflows/pages.yml` publishes only the `frontend` folder on every push to `main`.
5. Wait for the **Deploy FaceTrack frontend to GitHub Pages** action to finish.
6. Open the URL shown in the action summary:
   `https://YOUR-USERNAME.github.io/FaceTrack/`

### Before using the hosted frontend

1. Deploy the Flask backend to an **HTTPS** host (Render, Railway, Fly.io, PythonAnywhere, etc.).
2. Update `frontend/js/config.js`:

   ```js
   API_BASE_URL: "https://your-facetrack-api.onrender.com/api"
   ```

3. Commit and push again so Pages rebuilds.
4. HTTPS Pages **cannot** call a plain `http://127.0.0.1:5000` backend (mixed-content block). The login page will show the backend as offline and offer Demo Mode.

### Manual alternative

If you prefer branch-based Pages, copy the frontend into a `docs` folder, set **Settings → Pages → Deploy from a branch → main /docs**, and keep the same relative paths.

---

## 12. Windows PowerShell quick reference

```powershell
# Backend
cd D:\FaceTrack\backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt

# FaceTrack does not use pandas. Clean it out of an older venv if present.
pip uninstall -y pandas python-dateutil tzdata

# Verify the app imports and pandas is not loaded
python -c "import app, sys; print('app OK, pandas loaded:', 'pandas' in sys.modules)"

python app.py

# Frontend (second terminal)
cd D:\FaceTrack\frontend
python -m http.server 5500
# then open http://127.0.0.1:5500/login.html

# Check API health
Invoke-RestMethod http://127.0.0.1:5000/api/health | ConvertTo-Json -Depth 5

# Fix a broken OpenCV install
pip uninstall -y opencv-python opencv-python-headless opencv-contrib-python
pip install opencv-contrib-python==4.11.0.86
python -c "import cv2; print(cv2.__version__, hasattr(cv2, 'face'))"
```

If PowerShell blocks virtual-environment activation:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\venv\Scripts\Activate.ps1
```

---

## 13. Troubleshooting

| Symptom | Fix |
|---|---|
| Login says backend offline | Start Flask: `cd backend; python app.py`. Check <http://127.0.0.1:5000/api/health>. |
| `ImportError: DLL load failed while importing timestamps/lib` — “Application Control policy has blocked this file” | This comes from pandas, which FaceTrack no longer imports. Remove pandas from the project venv (`pip uninstall -y pandas python-dateutil tzdata`) or recreate the venv from `requirements.txt`. No Windows Security setting needs to be changed. |
| `cv2 has no attribute CascadeClassifier` | You have `opencv-python` installed alongside contrib. Uninstall both and reinstall `opencv-contrib-python`. |
| `cv2 has no attribute face` | LBPH comes from `opencv-contrib-python`, not `opencv-python`. Reinstall the contrib package. |
| Camera does not start | Use Chrome/Edge on `localhost` or HTTPS; allow camera permission; close other apps using the camera. |
| CORS error | Run the backend from the project, keep `/api/*` CORS enabled, and do not open `login.html` via `file://`. |
| GitHub Pages login cannot reach API | Use an HTTPS backend URL in `config.js`; mixed content is blocked. |
| Session expired | Tokens last 12 hours and are cleared when Flask restarts. Sign in again. |
| Sample rejected | Ensure exactly one well-lit face is in frame; move closer; avoid sunglasses/masks. |
| Unknown face during attendance | Register 3–5 samples, improve lighting, or raise the threshold slightly (lower = stricter). |
| Duplicate attendance | Expected: one record per student per day. The API returns `already_marked: true`. |
| Reset demo data | Settings → Data & Session → **Reset demo data** (Demo Mode only). |
| Reset live data | Delete `backend/database/attendance.db` and restart Flask to reseed. **This permanently deletes all live attendance.** |

---

## 14. Security and privacy notes

- Passwords are stored as Werkzeug hashes, never plain text.
- Bearer tokens are held in memory server-side and expire after 12 hours; restarting Flask invalidates them.
- Face samples and the LBPH model stay on the machine running the backend. There is no cloud face API.
- Demo Mode data lives only in the browser's `localStorage`.
- For production, put the API behind HTTPS, change the default admin password, restrict CORS origins, and use a persistent database backup strategy.
- The in-memory token store is intentionally simple for a campus project. For multi-user production deployments, use a database-backed session store or JWT with refresh tokens.

---

## 15. Project status

The application is complete and verified locally:

- Python syntax and imports checked with both the system interpreter and the project venv on Python 3.13.
- All JavaScript files pass `node --check`.
- Backend health, login, students CRUD, daily/records/search, reports, settings, manual attendance, duplicate prevention, face-validation error paths, Excel/CSV export and logout tested through the live API.
- Excel exports are generated by OpenPyXL and CSV exports by the standard `csv` module. **Pandas is not imported at runtime** (`pandas loaded: False` after `import app`).
- Browser end-to-end tests passed in both **Demo Mode** and **Live API** mode with no console errors and no failed network requests.
- The real face pipeline was verified end-to-end with a temporary test image: single-face validation, three sample registrations, automatic LBPH training, successful recognition, duplicate-attendance prevention, and full cleanup after deleting the test student.
- **No biometric data is shipped.** If demo seeding was opted in, seed students intentionally have zero face samples and `face_registered = 0`; the database sync keeps that flag truthful against `Face_Data`. Register each real student from the Face Registration page.
- In the current database, sample/demo rows were removed after verification. One real student (`CSE2023001`) with five captured face samples was retained so the LBPH model has a working profile; all other seeded students and all seeded attendance rows were deleted.
- Real face recognition requires a webcam and the running Flask + OpenCV backend. Demo Mode intentionally does not simulate successful recognition.

### First-run state

- **Students:** none by default (set `FACETRACK_SEED_DEMO=1` for 15 demo students). Register real students from the Face Registration page.
- **Attendance:** none by default (demo seeding adds 75 days only when opted in).
- **Face data:** `backend/dataset/` and `backend/trainer/` start empty; the LBPH model trains automatically after the first registration.
- **Demo Mode:** completely separate `localStorage` dataset; it never reads or writes live SQLite data.
- **Admin credentials:** the default is `admin@facetrack.com` / `Admin@123`, but these may have been changed. Use Settings → Password & Security to set your own.

**Default credentials:** `admin@facetrack.com` / `Admin@123` — change them in Settings after first login.
