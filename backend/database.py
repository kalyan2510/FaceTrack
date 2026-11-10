"""
FaceTrack - Database layer
===========================
SQLite database helpers, schema creation and realistic seed data.

Tables
------
Admin      : administrator accounts (passwords stored as PBKDF2 hashes)
Students   : student master data
Face_Data  : one row per captured face sample
Attendance : one row per student per day (UNIQUE constraint prevents duplicates)
"""

import os
import sqlite3
import random
from datetime import datetime, timedelta

from werkzeug.security import generate_password_hash

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE_DIR = os.path.join(BASE_DIR, "database")
DATABASE_PATH = os.path.join(DATABASE_DIR, "attendance.db")

DEFAULT_ADMIN_NAME = "Dr. Rakesh Menon"
DEFAULT_ADMIN_EMAIL = os.environ.get("FACETRACK_ADMIN_EMAIL", "admin@facetrack.com")
DEFAULT_ADMIN_PASSWORD = os.environ.get("FACETRACK_ADMIN_PASSWORD", "Admin@123")


# ---------------------------------------------------------------------------
# Connection helpers
# ---------------------------------------------------------------------------
def get_connection():
    """Return a new SQLite connection with row access by column name."""
    os.makedirs(DATABASE_DIR, exist_ok=True)
    conn = sqlite3.connect(DATABASE_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def row_to_dict(row):
    return dict(row) if row is not None else None


def rows_to_dicts(rows):
    return [dict(row) for row in rows]


# ---------------------------------------------------------------------------
# Schema + seed
# ---------------------------------------------------------------------------
SCHEMA = """
CREATE TABLE IF NOT EXISTS Admin (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'Administrator',
    created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Students (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id      TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    department      TEXT NOT NULL,
    year            TEXT NOT NULL,
    section         TEXT NOT NULL DEFAULT 'A',
    email           TEXT,
    phone           TEXT,
    photo_path      TEXT,
    face_registered INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Face_Data (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id  TEXT NOT NULL,
    sample_path TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES Students(student_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS Attendance (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id  TEXT NOT NULL,
    date        TEXT NOT NULL,
    time        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'Present',
    confidence  REAL,
    marked_by   TEXT NOT NULL DEFAULT 'Face Recognition',
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (student_id, date),
    FOREIGN KEY (student_id) REFERENCES Students(student_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attendance_date ON Attendance(date);
CREATE INDEX IF NOT EXISTS idx_attendance_student ON Attendance(student_id);
CREATE INDEX IF NOT EXISTS idx_face_student ON Face_Data(student_id);
"""


SEED_STUDENTS = [
    ("CSE2023001", "Aarav Sharma", "Computer Science", "III Year", "A", "aarav.sharma@facetrack.edu", "9876543210"),
    ("CSE2023002", "Diya Patel", "Computer Science", "III Year", "A", "diya.patel@facetrack.edu", "9876543211"),
    ("CSE2023003", "Rohan Verma", "Computer Science", "III Year", "B", "rohan.verma@facetrack.edu", "9876543212"),
    ("IT2023004", "Ananya Iyer", "Information Technology", "III Year", "A", "ananya.iyer@facetrack.edu", "9876543213"),
    ("IT2023005", "Kabir Singh", "Information Technology", "III Year", "A", "kabir.singh@facetrack.edu", "9876543214"),
    ("ECE2023006", "Meera Nair", "Electronics & Comm.", "II Year", "A", "meera.nair@facetrack.edu", "9876543215"),
    ("ECE2023007", "Arjun Reddy", "Electronics & Comm.", "II Year", "B", "arjun.reddy@facetrack.edu", "9876543216"),
    ("ME2023008", "Ishita Gupta", "Mechanical Engg.", "II Year", "A", "ishita.gupta@facetrack.edu", "9876543217"),
    ("ME2023009", "Vivaan Joshi", "Mechanical Engg.", "II Year", "B", "vivaan.joshi@facetrack.edu", "9876543218"),
    ("EEE2023010", "Sara Khan", "Electrical & Electronics", "III Year", "A", "sara.khan@facetrack.edu", "9876543219"),
    ("CSE2023011", "Aditya Rao", "Computer Science", "IV Year", "A", "aditya.rao@facetrack.edu", "9876543220"),
    ("IT2023012", "Nisha Kulkarni", "Information Technology", "IV Year", "B", "nisha.kulkarni@facetrack.edu", "9876543221"),
    ("ECE2023013", "Dev Malhotra", "Electronics & Comm.", "III Year", "A", "dev.malhotra@facetrack.edu", "9876543222"),
    ("AIML2023014", "Riya Chatterjee", "AI & Machine Learning", "II Year", "A", "riya.chatterjee@facetrack.edu", "9876543223"),
    ("AIML2023015", "Karthik Menon", "AI & Machine Learning", "III Year", "B", "karthik.menon@facetrack.edu", "9876543224"),
]


def _seed_admin(conn):
    existing = conn.execute("SELECT COUNT(*) AS c FROM Admin").fetchone()["c"]
    if existing:
        return
    conn.execute(
        "INSERT INTO Admin (name, email, password_hash, role) VALUES (?, ?, ?, ?)",
        (
            DEFAULT_ADMIN_NAME,
            DEFAULT_ADMIN_EMAIL,
            generate_password_hash(DEFAULT_ADMIN_PASSWORD),
            "Administrator",
        ),
    )


def _seed_students(conn):
    existing = conn.execute("SELECT COUNT(*) AS c FROM Students").fetchone()["c"]
    if existing:
        return
    for index, (sid, name, dept, year, section, email, phone) in enumerate(SEED_STUDENTS):
        conn.execute(
            """INSERT INTO Students
               (student_id, name, department, year, section, email, phone, face_registered)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (sid, name, dept, year, section, email, phone, 0),
        )


def _seed_attendance(conn):
    """Generate believable attendance for the last 75 days (Sundays off)."""
    existing = conn.execute("SELECT COUNT(*) AS c FROM Attendance").fetchone()["c"]
    if existing:
        return

    rng = random.Random(2026)
    students = conn.execute("SELECT student_id FROM Students ORDER BY id").fetchall()
    if not students:
        return

    today = datetime.now().date()
    # Per-student reliability so charts show natural variation.
    reliability = {row["student_id"]: rng.uniform(0.78, 0.97) for row in students}

    start = today - timedelta(days=74)
    rows = []
    day = start
    while day <= today:
        if day.weekday() != 6:  # Sunday is a holiday
            for row in students:
                sid = row["student_id"]
                # Slight day-of-week effect (Mondays a little lower).
                chance = reliability[sid] - (0.04 if day.weekday() == 0 else 0)
                if rng.random() < chance:
                    minute = rng.randint(0, 38)
                    punch = f"09:{minute:02d}:{rng.randint(0, 59):02d}"
                    rows.append(
                        (
                            sid,
                            day.isoformat(),
                            punch,
                            "Present",
                            round(rng.uniform(82.0, 98.5), 1),
                            "Face Recognition",
                        )
                    )
        day += timedelta(days=1)

    conn.executemany(
        """INSERT OR IGNORE INTO Attendance
           (student_id, date, time, status, confidence, marked_by)
           VALUES (?, ?, ?, ?, ?, ?)""",
        rows,
    )


def _sync_face_registration(conn):
    """Keep face_registered truthful: 1 only when a sample actually exists.

    Seeded students start with no biometric samples, so they must not appear as
    registered until the user captures a validated face on the registration page.
    """
    conn.execute(
        """UPDATE Students
           SET face_registered = CASE
               WHEN EXISTS (SELECT 1 FROM Face_Data f WHERE f.student_id = Students.student_id)
               THEN 1 ELSE 0 END"""
    )


def init_db():
    """Create all tables and seed first-run data. Safe to call repeatedly.

    The administrator account is always seeded when the Admin table is empty.
    Sample students and generated attendance are opt-in only: set
    FACETRACK_SEED_DEMO=1 (or true/yes/on) before the first backend start.
    Real deployments therefore never mix fabricated data into live reports.
    """
    os.makedirs(DATABASE_DIR, exist_ok=True)
    conn = get_connection()
    try:
        conn.executescript(SCHEMA)
        _seed_admin(conn)
        if seed_demo_enabled():
            _seed_students(conn)
            _seed_attendance(conn)
        _sync_face_registration(conn)
        conn.commit()
    finally:
        conn.close()


def seed_demo_enabled():
    value = os.environ.get("FACETRACK_SEED_DEMO", "").strip().lower()
    return value in ("1", "true", "yes", "on")


# ---------------------------------------------------------------------------
# Admin queries
# ---------------------------------------------------------------------------
def get_admin_by_email(email):
    conn = get_connection()
    try:
        return row_to_dict(
            conn.execute("SELECT * FROM Admin WHERE lower(email) = lower(?)", (email,)).fetchone()
        )
    finally:
        conn.close()


def get_admin(admin_id):
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT id, name, email, role, created_at FROM Admin WHERE id = ?", (admin_id,)
        ).fetchone()
        return row_to_dict(row)
    finally:
        conn.close()


def update_admin_profile(admin_id, name, email):
    conn = get_connection()
    try:
        conn.execute(
            "UPDATE Admin SET name = ?, email = ? WHERE id = ?",
            (name.strip(), email.strip().lower(), admin_id),
        )
        conn.commit()
        return get_admin(admin_id)
    finally:
        conn.close()


def update_admin_password(admin_id, password_hash):
    conn = get_connection()
    try:
        conn.execute("UPDATE Admin SET password_hash = ? WHERE id = ?", (password_hash, admin_id))
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Student queries
# ---------------------------------------------------------------------------
STUDENT_SELECT = """
SELECT s.*,
       (SELECT COUNT(*) FROM Face_Data f WHERE f.student_id = s.student_id) AS face_samples
FROM Students s
"""


def get_student(student_id):
    conn = get_connection()
    try:
        row = conn.execute(STUDENT_SELECT + " WHERE s.student_id = ?", (student_id,)).fetchone()
        return row_to_dict(row)
    finally:
        conn.close()


def list_students(search="", department="", year=""):
    sql = STUDENT_SELECT + " WHERE 1 = 1"
    params = []
    if search:
        like = f"%{search.strip()}%"
        sql += " AND (s.name LIKE ? OR s.student_id LIKE ? OR s.email LIKE ? OR s.phone LIKE ?)"
        params.extend([like, like, like, like])
    if department:
        sql += " AND s.department = ?"
        params.append(department)
    if year:
        sql += " AND s.year = ?"
        params.append(year)
    sql += " ORDER BY s.id ASC"
    conn = get_connection()
    try:
        return rows_to_dicts(conn.execute(sql, params).fetchall())
    finally:
        conn.close()


def create_student(data):
    conn = get_connection()
    try:
        cur = conn.execute(
            """INSERT INTO Students
               (student_id, name, department, year, section, email, phone, photo_path, face_registered)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                data["student_id"].strip(),
                data["name"].strip(),
                data["department"].strip(),
                data["year"].strip(),
                data.get("section", "A").strip() or "A",
                (data.get("email") or "").strip().lower() or None,
                (data.get("phone") or "").strip() or None,
                data.get("photo_path"),
                1 if data.get("face_registered") else 0,
            ),
        )
        conn.commit()
        return get_student_by_pk(cur.lastrowid)
    finally:
        conn.close()


def get_student_by_pk(pk):
    conn = get_connection()
    try:
        row = conn.execute(STUDENT_SELECT + " WHERE s.id = ?", (pk,)).fetchone()
        return row_to_dict(row)
    finally:
        conn.close()


def update_student(student_id, data):
    conn = get_connection()
    try:
        conn.execute(
            """UPDATE Students SET
                 name = ?, department = ?, year = ?, section = ?,
                 email = ?, phone = ?, photo_path = COALESCE(?, photo_path),
                 updated_at = CURRENT_TIMESTAMP
               WHERE student_id = ?""",
            (
                data["name"].strip(),
                data["department"].strip(),
                data["year"].strip(),
                data.get("section", "A").strip() or "A",
                (data.get("email") or "").strip().lower() or None,
                (data.get("phone") or "").strip() or None,
                data.get("photo_path"),
                student_id,
            ),
        )
        conn.commit()
        return get_student(student_id)
    finally:
        conn.close()


def set_face_registered(student_id, registered=True):
    conn = get_connection()
    try:
        conn.execute(
            "UPDATE Students SET face_registered = ?, updated_at = CURRENT_TIMESTAMP WHERE student_id = ?",
            (1 if registered else 0, student_id),
        )
        conn.commit()
    finally:
        conn.close()


def set_student_photo(student_id, photo_path):
    conn = get_connection()
    try:
        conn.execute(
            "UPDATE Students SET photo_path = ?, updated_at = CURRENT_TIMESTAMP WHERE student_id = ?",
            (photo_path, student_id),
        )
        conn.commit()
    finally:
        conn.close()


def delete_student(student_id):
    conn = get_connection()
    try:
        cur = conn.execute("DELETE FROM Students WHERE student_id = ?", (student_id,))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def departments():
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT DISTINCT department FROM Students ORDER BY department"
        ).fetchall()
        return [r["department"] for r in rows]
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Face sample queries
# ---------------------------------------------------------------------------
def add_face_sample(student_id, sample_path):
    conn = get_connection()
    try:
        conn.execute(
            "INSERT INTO Face_Data (student_id, sample_path) VALUES (?, ?)",
            (student_id, sample_path),
        )
        conn.commit()
        count = conn.execute(
            "SELECT COUNT(*) AS c FROM Face_Data WHERE student_id = ?", (student_id,)
        ).fetchone()["c"]
        return count
    finally:
        conn.close()


def list_face_samples(student_id):
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM Face_Data WHERE student_id = ? ORDER BY id ASC", (student_id,)
        ).fetchall()
        return rows_to_dicts(rows)
    finally:
        conn.close()


def count_face_samples(student_id):
    conn = get_connection()
    try:
        return conn.execute(
            "SELECT COUNT(*) AS c FROM Face_Data WHERE student_id = ?", (student_id,)
        ).fetchone()["c"]
    finally:
        conn.close()


def all_face_samples():
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT f.*, s.name FROM Face_Data f
               LEFT JOIN Students s ON s.student_id = f.student_id
               ORDER BY f.student_id, f.id"""
        ).fetchall()
        return rows_to_dicts(rows)
    finally:
        conn.close()


if __name__ == "__main__":
    init_db()
    print(f"[FaceTrack] Database ready at {DATABASE_PATH}")
    print(f"[FaceTrack] Admin login: {DEFAULT_ADMIN_EMAIL} / {DEFAULT_ADMIN_PASSWORD}")
