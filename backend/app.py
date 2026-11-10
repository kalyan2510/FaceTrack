"""
FaceTrack - Flask backend
=========================
REST API for the FaceTrack attendance management system.

Run:
    python app.py

Default API root:
    http://127.0.0.1:5000/api

The frontend is a separate static site (see ../frontend) and talks to this API
through frontend/js/config.js.  Nothing here pretends that face recognition
succeeded: unknown faces are reported as Unknown and are never marked present.
"""

import os
import re
import secrets
import shutil
import sys
from datetime import datetime, timedelta
from functools import wraps

from flask import Flask, g, jsonify, request, send_file
from flask_cors import CORS
from werkzeug.security import check_password_hash, generate_password_hash

import attendance_manager as am
import database as db
import face_recognition as face_module
from excel_export import (
    export_attendance_csv,
    export_attendance_excel,
    filename_for,
)

APP_VERSION = "1.0.0"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 12 * 1024 * 1024  # 12 MB request ceiling
app.config["JSON_SORT_KEYS"] = False

# Only the local static frontend (VS Code Live Server / python http.server) is
# allowed by default. Set FACETRACK_CORS_ORIGINS to a comma-separated list to
# add hosts, or to "*" for a hosted deployment.
DEFAULT_CORS_ORIGINS = [
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://127.0.0.1:5501",
    "http://localhost:5501",
]
_cors_env = os.environ.get("FACETRACK_CORS_ORIGINS", "").strip()
CORS_ORIGINS = (
    ["*"]
    if _cors_env == "*"
    else [origin.strip() for origin in _cors_env.split(",") if origin.strip()]
    or DEFAULT_CORS_ORIGINS
)

CORS(
    app,
    resources={r"/api/*": {"origins": CORS_ORIGINS}},
    allow_headers=["Content-Type", "Authorization"],
    expose_headers=["Content-Disposition"],
    methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
)

# In-memory bearer tokens. Restarting the backend invalidates them; the
# frontend then sends the user back to the login page. This is intentionally
# simple for a campus project, while passwords remain securely hashed.
TOKENS = {}
TOKEN_TTL = timedelta(hours=12)

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$")
STUDENT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{3,24}$")
PHONE_RE = re.compile(r"^[6-9]\d{9}$")
ALLOWED_PHOTO_EXT = {"png", "jpg", "jpeg", "webp"}
ALLOWED_YEARS = ["I Year", "II Year", "III Year", "IV Year"]


# ---------------------------------------------------------------------------
# Response helpers
# ---------------------------------------------------------------------------
def ok(data=None, status=200, **extra):
    payload = {"success": True}
    if isinstance(data, dict):
        payload.update(data)
    elif data is not None:
        payload["data"] = data
    payload.update(extra)
    return jsonify(payload), status


def fail(message, status=400, code=None, **extra):
    payload = {"success": False, "error": message}
    if code:
        payload["code"] = code
    payload.update(extra)
    return jsonify(payload), status


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
def issue_token(admin_id):
    token = secrets.token_urlsafe(32)
    TOKENS[token] = {"admin_id": admin_id, "expires": datetime.now() + TOKEN_TTL}
    return token


def current_token():
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        return header[7:].strip()
    return None


def require_auth(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        token = current_token()
        record = TOKENS.get(token) if token else None
        if not record or record["expires"] < datetime.now():
            if token:
                TOKENS.pop(token, None)
            return fail("Your session has expired. Please log in again.", 401, "UNAUTHORIZED")
        admin = db.get_admin(record["admin_id"])
        if not admin:
            return fail("Administrator account no longer exists.", 401, "UNAUTHORIZED")
        g.admin = admin
        g.token = token
        return view(*args, **kwargs)

    return wrapped


# ---------------------------------------------------------------------------
# Serializers
# ---------------------------------------------------------------------------
def serialize_student(student, include_photo_url=True):
    if not student:
        return None
    result = dict(student)
    result["face_registered"] = bool(result.get("face_registered"))
    result["face_samples"] = int(result.get("face_samples") or 0)
    if include_photo_url and result.get("photo_path"):
        result["photo_url"] = f"/api/students/{result['student_id']}/photo"
    else:
        result["photo_url"] = None
    return result


def normalized_phone(value):
    digits = re.sub(r"[^\d]", "", value or "")
    if digits.startswith("91") and len(digits) == 12:
        digits = digits[2:]
    return digits


def validate_student(payload, existing_id=None):
    errors = {}
    student_id = (payload.get("student_id") or "").strip()
    name = (payload.get("name") or "").strip()
    department = (payload.get("department") or "").strip()
    year = (payload.get("year") or "").strip()
    section = (payload.get("section") or "A").strip() or "A"
    email = (payload.get("email") or "").strip().lower()
    phone = normalized_phone(payload.get("phone"))

    if not existing_id:
        if not student_id:
            errors["student_id"] = "Student ID is required."
        elif not STUDENT_ID_RE.match(student_id):
            errors["student_id"] = "Use 3-24 letters, numbers, hyphen or underscore."
    if len(name) < 2 or len(name) > 60:
        errors["name"] = "Name must be between 2 and 60 characters."
    if not department:
        errors["department"] = "Department is required."
    if not year:
        errors["year"] = "Year is required."
    if email and not EMAIL_RE.match(email):
        errors["email"] = "Enter a valid email address."
    if phone and not PHONE_RE.match(phone):
        errors["phone"] = "Enter a valid 10-digit Indian mobile number."

    if errors:
        return None, errors

    return (
        {
            "student_id": existing_id or student_id,
            "name": name,
            "department": department,
            "year": year,
            "section": section[:4].upper(),
            "email": email,
            "phone": phone,
        },
        None,
    )


# ---------------------------------------------------------------------------
# Root + health
# ---------------------------------------------------------------------------
@app.get("/")
def root():
    return ok(
        {
            "app": "FaceTrack API",
            "tagline": "Smart Face Recognition Attendance System",
            "version": APP_VERSION,
            "api_base": "/api",
            "health": "/api/health",
            "documentation": "See README.md in the project root.",
        }
    )


@app.get("/api/health")
def health():
    database_status = "connected"
    try:
        conn = db.get_connection()
        conn.execute("SELECT 1").fetchone()
        conn.close()
    except Exception as exc:
        database_status = f"error: {exc}"
    return ok(
        {
            "status": "online" if database_status == "connected" else "degraded",
            "app": "FaceTrack",
            "version": APP_VERSION,
            "database": database_status,
            "face_engine": face_module.face_engine.capabilities(),
            "model": face_module.face_engine._model_info,
            "threshold": face_module.MATCH_THRESHOLD,
            "server_time": datetime.now().isoformat(timespec="seconds"),
        }
    )


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------
@app.post("/api/auth/login")
def login():
    payload = request.get_json(silent=True) or {}
    email = (payload.get("email") or "").strip()
    password = payload.get("password") or ""
    if not email or not password:
        return fail("Email and password are required.", 400, "VALIDATION_ERROR")

    admin = db.get_admin_by_email(email)
    if not admin or not check_password_hash(admin["password_hash"], password):
        return fail("Invalid email or password.", 401, "INVALID_CREDENTIALS")

    token = issue_token(admin["id"])
    return ok(
        {
            "token": token,
            "expires_in": int(TOKEN_TTL.total_seconds()),
            "admin": {
                "id": admin["id"],
                "name": admin["name"],
                "email": admin["email"],
                "role": admin["role"],
                "created_at": admin["created_at"],
            },
        }
    )


@app.post("/api/auth/logout")
@require_auth
def logout():
    TOKENS.pop(g.token, None)
    return ok({"message": "Logged out successfully."})


@app.get("/api/auth/me")
@require_auth
def me():
    return ok({"admin": g.admin})


@app.put("/api/admin/profile")
@require_auth
def update_profile():
    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()
    email = (payload.get("email") or "").strip().lower()
    if len(name) < 2 or len(name) > 60:
        return fail("Name must be between 2 and 60 characters.", 400, "VALIDATION_ERROR")
    if not EMAIL_RE.match(email):
        return fail("Enter a valid email address.", 400, "VALIDATION_ERROR")
    existing = db.get_admin_by_email(email)
    if existing and existing["id"] != g.admin["id"]:
        return fail("That email is already used by another administrator.", 409, "EMAIL_IN_USE")
    try:
        admin = db.update_admin_profile(g.admin["id"], name, email)
    except Exception:
        return fail("Could not update the profile.", 500, "PROFILE_UPDATE_FAILED")
    return ok({"message": "Profile updated successfully.", "admin": admin})


@app.post("/api/admin/change-password")
@require_auth
def change_password():
    payload = request.get_json(silent=True) or {}
    current = payload.get("current_password") or ""
    new = payload.get("new_password") or ""
    if not check_password_hash(
        db.get_admin_by_email(g.admin["email"])["password_hash"], current
    ):
        return fail("Current password is incorrect.", 400, "WRONG_PASSWORD")
    if len(new) < 8:
        return fail("New password must be at least 8 characters.", 400, "WEAK_PASSWORD")
    if not re.search(r"[A-Za-z]", new) or not re.search(r"\d", new):
        return fail("Use at least one letter and one number.", 400, "WEAK_PASSWORD")
    db.update_admin_password(g.admin["id"], generate_password_hash(new))
    # Invalidate all other sessions for safety.
    stale = [token for token, rec in TOKENS.items() if rec["admin_id"] == g.admin["id"]]
    for token in stale:
        TOKENS.pop(token, None)
    return ok({"message": "Password changed. Please log in again."})


# ---------------------------------------------------------------------------
# Student endpoints
# ---------------------------------------------------------------------------
@app.get("/api/students")
@require_auth
def get_students():
    search = request.args.get("search", "")
    department = request.args.get("department", "")
    year = request.args.get("year", "")
    students = [serialize_student(s) for s in db.list_students(search, department, year)]
    return ok(
        {
            "students": students,
            "count": len(students),
            "departments": db.departments(),
        }
    )


@app.get("/api/students/<student_id>")
@require_auth
def get_student(student_id):
    student = db.get_student(student_id)
    if not student:
        return fail("Student not found.", 404, "NOT_FOUND")
    student = serialize_student(student)
    history = am.get_student_history(
        student_id,
        (datetime.now() - timedelta(days=30)).date().isoformat(),
        datetime.now().date().isoformat(),
    )
    student["attendance_summary"] = {
        "classes_held": history["classes_held"],
        "present": history["present"],
        "absent": history["absent"],
        "percentage": history["percentage"],
    } if history else None
    return ok({"student": student})


@app.post("/api/students")
@require_auth
def add_student():
    payload = request.get_json(silent=True) or {}
    data, errors = validate_student(payload)
    if errors:
        return fail("Please correct the highlighted fields.", 422, "VALIDATION_ERROR", fields=errors)
    if db.get_student(data["student_id"]):
        return fail("A student with this ID already exists.", 409, "DUPLICATE_STUDENT_ID")
    try:
        student = db.create_student(data)
    except Exception as exc:
        if "UNIQUE" in str(exc).upper():
            return fail("A student with this ID already exists.", 409, "DUPLICATE_STUDENT_ID")
        return fail("Could not save the student.", 500, "CREATE_FAILED")
    return ok({"message": "Student added successfully.", "student": serialize_student(student)}, 201)


@app.put("/api/students/<student_id>")
@require_auth
def edit_student(student_id):
    existing = db.get_student(student_id)
    if not existing:
        return fail("Student not found.", 404, "NOT_FOUND")
    payload = request.get_json(silent=True) or {}
    data, errors = validate_student(payload, existing_id=student_id)
    if errors:
        return fail("Please correct the highlighted fields.", 422, "VALIDATION_ERROR", fields=errors)
    student = db.update_student(student_id, data)
    return ok({"message": "Student updated successfully.", "student": serialize_student(student)})


@app.delete("/api/students/<student_id>")
@require_auth
def remove_student(student_id):
    student = db.get_student(student_id)
    if not student:
        return fail("Student not found.", 404, "NOT_FOUND")
    db.delete_student(student_id)

    # Remove the student's face dataset folder and photo, then rebuild the
    # model so a deleted student can never be recognised again.
    safe_id = re.sub(r"[^A-Za-z0-9_-]", "_", student_id)
    folder = os.path.join(face_module.DATASET_DIR, safe_id)
    if os.path.isdir(folder):
        shutil.rmtree(folder, ignore_errors=True)
    if student.get("photo_path"):
        photo = os.path.join(face_module.BASE_DIR, student["photo_path"])
        if os.path.isfile(photo):
            try:
                os.remove(photo)
            except OSError:
                pass
    try:
        face_module.face_engine.train_model()
    except Exception:
        pass
    return ok({"message": f"{student['name']} was deleted."})


@app.post("/api/students/<student_id>/photo")
@require_auth
def upload_student_photo(student_id):
    student = db.get_student(student_id)
    if not student:
        return fail("Student not found.", 404, "NOT_FOUND")
    if "photo" not in request.files:
        return fail("No photo file was uploaded.", 400, "NO_FILE")
    file = request.files["photo"]
    if not file.filename:
        return fail("No photo file was selected.", 400, "NO_FILE")
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_PHOTO_EXT:
        return fail("Use a JPG, PNG or WebP image.", 415, "UNSUPPORTED_IMAGE")

    raw = file.read()
    if len(raw) > 5 * 1024 * 1024:
        return fail("Photo must be smaller than 5 MB.", 413, "PHOTO_TOO_LARGE")

    # Validate and normalise with OpenCV when available.
    cv2 = face_module.cv2
    import numpy as np

    if cv2 is not None:
        try:
            arr = np.frombuffer(raw, dtype=np.uint8)
            image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            if image is None:
                return fail("That file is not a readable image.", 415, "INVALID_IMAGE")
            height, width = image.shape[:2]
            max_side = max(width, height)
            if max_side > 640:
                scale = 640 / max_side
                image = cv2.resize(image, (int(width * scale), int(height * scale)))
            success, encoded = cv2.imencode(".jpg", image, [int(cv2.IMWRITE_JPEG_QUALITY), 88])
            if not success:
                return fail("Could not process the photo.", 500, "PHOTO_PROCESSING_FAILED")
            raw = encoded.tobytes()
            ext = "jpg"
        except Exception:
            return fail("That file is not a readable image.", 415, "INVALID_IMAGE")

    safe_id = re.sub(r"[^A-Za-z0-9_-]", "_", student_id)
    os.makedirs(face_module.PHOTO_DIR, exist_ok=True)
    filename = f"{safe_id}.{ext}"
    full_path = os.path.join(face_module.PHOTO_DIR, filename)
    with open(full_path, "wb") as handle:
        handle.write(raw)
    relative = os.path.relpath(full_path, face_module.BASE_DIR).replace("\\", "/")
    db.set_student_photo(student_id, relative)
    return ok(
        {
            "message": "Student photo updated.",
            "photo_url": f"/api/students/{student_id}/photo?t={int(datetime.now().timestamp())}",
        }
    )


@app.get("/api/students/<student_id>/photo")
def student_photo(student_id):
    student = db.get_student(student_id)
    if not student or not student.get("photo_path"):
        return fail("No photo available for this student.", 404, "NO_PHOTO")
    path = os.path.join(face_module.BASE_DIR, student["photo_path"])
    if not os.path.isfile(path):
        return fail("Photo file is missing.", 404, "NO_PHOTO")
    return send_file(path, mimetype="image/jpeg", max_age=60)


# ---------------------------------------------------------------------------
# Face registration endpoints
# ---------------------------------------------------------------------------
@app.get("/api/faces/model")
@require_auth
def model_status():
    engine = face_module.face_engine
    return ok(
        {
            "capabilities": engine.capabilities(),
            "model": engine._model_info,
            "session": engine.get_session(),
            "recommended_samples": 5,
        }
    )


@app.get("/api/faces/status/<student_id>")
@require_auth
def face_status(student_id):
    if not db.get_student(student_id):
        return fail("Student not found.", 404, "NOT_FOUND")
    data = face_module.face_engine.student_samples(student_id)
    data["engine"] = face_module.face_engine.capabilities()
    return ok(data)


@app.post("/api/faces/register")
@require_auth
def register_face():
    payload = request.get_json(silent=True) or {}
    student_id = (payload.get("student_id") or "").strip()
    image = payload.get("image") or ""
    if not student_id:
        return fail("Select a student before capturing a face.", 400, "VALIDATION_ERROR")
    if not image:
        return fail("No camera frame was captured.", 400, "NO_IMAGE")
    # Training once after a batch of samples is much faster than retraining
    # after every single capture. Clients can still request immediate training.
    train = payload.get("train", True)
    train = train if isinstance(train, bool) else str(train).lower() not in ("false", "0", "no")
    result = face_module.face_engine.register_face(student_id, image, train=train)
    if not result.get("success"):
        status = 503 if "unavailable" in (result.get("error") or "").lower() else 422
        return fail(result.get("error", "Face registration failed."), status, result.get("code"))
    return ok(result, 201)


@app.post("/api/faces/validate")
@require_auth
def validate_face():
    """Check a frame for exactly one face without storing it."""
    payload = request.get_json(silent=True) or {}
    image = payload.get("image") or ""
    if not image:
        return fail("No camera frame was captured.", 400, "NO_IMAGE")
    result = face_module.face_engine.validate_frame(image)
    if not result.get("success"):
        return fail(result.get("error", "No valid face detected."), 422, result.get("code"))
    return ok(result)


@app.post("/api/faces/train")
@require_auth
def train_faces():
    result = face_module.face_engine.train_model()
    if not result.get("success"):
        return fail(result.get("error", "Training failed."), 422, "TRAINING_FAILED")
    return ok(result)


# ---------------------------------------------------------------------------
# Recognition session endpoints
# ---------------------------------------------------------------------------
@app.post("/api/recognition/start")
@require_auth
def start_recognition():
    caps = face_module.face_engine.capabilities()
    if not caps["engine_ready"]:
        return fail(
            "Face engine unavailable. Install opencv-contrib-python and restart the backend.",
            503,
            "ENGINE_UNAVAILABLE",
            capabilities=caps,
        )
    if not caps["model_trained"]:
        return fail(
            "No trained face model. Register at least one student face first.",
            409,
            "MODEL_NOT_TRAINED",
            capabilities=caps,
        )
    session = face_module.face_engine.start_session()
    return ok({"message": "Recognition session started.", "session": session})


@app.post("/api/recognition/stop")
@require_auth
def stop_recognition():
    session = face_module.face_engine.stop_session()
    return ok({"message": "Recognition session stopped.", "session": session})


@app.get("/api/recognition/status")
@require_auth
def recognition_status():
    return ok(
        {
            "session": face_module.face_engine.get_session(),
            "summary": am.get_recognition_summary(),
        }
    )


@app.post("/api/recognition/recognize")
@require_auth
def recognize_frame():
    if not face_module.face_engine.session["active"]:
        return fail("Recognition session is not active. Press Start Camera first.", 409, "SESSION_NOT_ACTIVE")
    payload = request.get_json(silent=True) or {}
    image = payload.get("image") or ""
    if not image:
        return fail("No frame received.", 400, "NO_IMAGE")
    result = face_module.face_engine.recognize(image)
    if not result.get("success"):
        code = result.get("code")
        status = 409 if code == "MODEL_NOT_TRAINED" else 422
        return fail(result.get("error", "Recognition failed."), status, code)
    result["summary"] = am.get_recognition_summary()
    result["session"] = face_module.face_engine.get_session()
    return ok(result)


# ---------------------------------------------------------------------------
# Attendance endpoints
# ---------------------------------------------------------------------------
@app.get("/api/attendance/daily")
@require_auth
def daily_attendance():
    return ok(
        am.get_daily_records(
            request.args.get("date"),
            request.args.get("search", ""),
            request.args.get("department", ""),
            request.args.get("status", ""),
        )
    )


@app.get("/api/attendance/records")
@require_auth
def attendance_records():
    from_date = request.args.get("from")
    to_date = request.args.get("to")
    search = request.args.get("search") or request.args.get("student_id", "")
    department = request.args.get("department", "")
    rows = am.get_export_rows(from_date, to_date, search, department)
    return ok({"records": rows, "count": len(rows), "from": from_date, "to": to_date})


@app.get("/api/attendance/student/<student_id>")
@require_auth
def student_attendance(student_id):
    data = am.get_student_history(
        student_id, request.args.get("from"), request.args.get("to")
    )
    if not data:
        return fail("Student not found.", 404, "NOT_FOUND")
    return ok(data)


@app.post("/api/attendance/mark")
@require_auth
def manual_mark():
    payload = request.get_json(silent=True) or {}
    student_id = (payload.get("student_id") or "").strip()
    if not student_id:
        return fail("Student ID is required.", 400, "VALIDATION_ERROR")
    result = am.mark_attendance(student_id, confidence=None, marked_by="Admin (Manual)")
    if not result.get("success"):
        return fail(result.get("error", "Could not mark attendance."), 404, "NOT_FOUND")
    return ok(result)


@app.get("/api/attendance/summary")
@require_auth
def attendance_summary():
    return ok({"summary": am.get_recognition_summary()})


@app.get("/api/attendance/export")
@require_auth
def export_attendance():
    export_format = (request.args.get("format") or "excel").lower()
    from_date = request.args.get("from")
    to_date = request.args.get("to")
    search = request.args.get("search") or request.args.get("student_id", "")
    department = request.args.get("department", "")
    rows = am.get_export_rows(from_date, to_date, search, department)
    overview = am.get_report_overview(from_date, to_date)
    summary = overview["summary"]
    summary["present"] = len(rows) if (search or department) else summary["present"]

    if export_format == "csv":
        buffer = export_attendance_csv(rows)
        mimetype = "text/csv"
        name = filename_for("csv", from_date, to_date)
    else:
        buffer = export_attendance_excel(rows, from_date, to_date, summary)
        mimetype = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        name = filename_for("xlsx", from_date, to_date)
    return send_file(
        buffer,
        mimetype=mimetype,
        as_attachment=True,
        download_name=name,
        max_age=0,
    )


# ---------------------------------------------------------------------------
# Dashboard + reports
# ---------------------------------------------------------------------------
@app.get("/api/dashboard/stats")
@require_auth
def dashboard_stats():
    stats = am.get_dashboard_stats()
    stats["weekly"] = am.get_weekly_series(7)
    stats["monthly"] = am.get_monthly_series(6)
    stats["recent"] = am.recent_attendance(8)
    stats["departments"] = am.department_summary()
    return ok(
        {
            "stats": stats,
            "recent": stats["recent"],
            "weekly": stats["weekly"],
            "monthly": stats["monthly"],
            "departments": stats["departments"],
            "generated_at": datetime.now().isoformat(timespec="seconds"),
        }
    )


@app.get("/api/reports/overview")
@require_auth
def reports_overview():
    from_date = request.args.get("from")
    to_date = request.args.get("to")
    data = am.get_report_overview(from_date, to_date)
    data["departments"] = am.department_summary(from_date, to_date)
    data["generated_at"] = datetime.now().isoformat(timespec="seconds")
    return ok(data)


@app.get("/api/reports/students")
@require_auth
def reports_students():
    return ok(
        am.get_all_student_summaries(
            request.args.get("from"), request.args.get("to")
        )
    )


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
@app.get("/api/settings/system")
@require_auth
def system_information():
    conn = db.get_connection()
    try:
        counts = {
            "students": conn.execute("SELECT COUNT(*) AS c FROM Students").fetchone()["c"],
            "attendance": conn.execute("SELECT COUNT(*) AS c FROM Attendance").fetchone()["c"],
            "face_samples": conn.execute("SELECT COUNT(*) AS c FROM Face_Data").fetchone()["c"],
            "admins": conn.execute("SELECT COUNT(*) AS c FROM Admin").fetchone()["c"],
        }
    finally:
        conn.close()
    engine = face_module.face_engine
    return ok(
        {
            "app": "FaceTrack",
            "tagline": "Smart Face Recognition Attendance System",
            "version": APP_VERSION,
            "python": sys.version.split()[0],
            "database": "SQLite 3",
            "database_path": db.DATABASE_PATH,
            "face_engine": engine.capabilities(),
            "model": engine._model_info,
            "threshold": face_module.MATCH_THRESHOLD,
            "session": engine.get_session(),
            "counts": counts,
            "admin": g.admin,
            "server_time": datetime.now().isoformat(timespec="seconds"),
        }
    )


@app.get("/api/settings/departments")
@require_auth
def list_departments():
    return ok({"departments": db.departments()})


# ---------------------------------------------------------------------------
# Error handlers
# ---------------------------------------------------------------------------
@app.errorhandler(404)
def not_found(_error):
    if request.path.startswith("/api/"):
        return fail("API endpoint not found.", 404, "NOT_FOUND")
    return fail("Not found.", 404, "NOT_FOUND")


@app.errorhandler(405)
def method_not_allowed(_error):
    return fail("HTTP method not allowed for this endpoint.", 405, "METHOD_NOT_ALLOWED")


@app.errorhandler(413)
def too_large(_error):
    return fail("Request is too large. Keep images under 5 MB.", 413, "REQUEST_TOO_LARGE")


@app.errorhandler(500)
def server_error(error):
    app.logger.exception("Unhandled server error: %s", error)
    return fail("An unexpected server error occurred. Check the backend console.", 500, "SERVER_ERROR")


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------
db.init_db()


if __name__ == "__main__":
    host = os.environ.get("FACETRACK_HOST", "127.0.0.1")
    port = int(os.environ.get("FACETRACK_PORT", "5000"))
    debug = os.environ.get("FACETRACK_DEBUG", "0") == "1"
    caps = face_module.face_engine.capabilities()
    print("=" * 62)
    print("  FaceTrack API - Smart Face Recognition Attendance System")
    print("=" * 62)
    print(f"  API root      : http://{host}:{port}/api")
    print(f"  Health check  : http://{host}:{port}/api/health")
    print(f"  Admin login   : {db.DEFAULT_ADMIN_EMAIL} / {db.DEFAULT_ADMIN_PASSWORD}")
    print(f"  Database      : {db.DATABASE_PATH}")
    print(f"  OpenCV        : {caps['opencv_version'] or 'NOT INSTALLED'}")
    print(f"  LBPH available: {caps['lbph_available']}")
    print(f"  Model trained : {caps['model_trained']}")
    print("=" * 62)
    if not caps["lbph_available"]:
        print("  WARNING: Install opencv-contrib-python for face recognition.")
    app.run(host=host, port=port, debug=debug, use_reloader=debug)
