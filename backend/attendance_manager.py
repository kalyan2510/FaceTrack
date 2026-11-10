"""
FaceTrack - Attendance business logic
=====================================
All attendance calculations live here: marking, duplicate prevention,
daily rosters, percentages, dashboard statistics, chart series and exports.
"""

from datetime import datetime, timedelta
import sqlite3

from database import get_connection, rows_to_dicts, row_to_dict


def _today():
    return datetime.now().date()


def _parse_date(value, fallback=None):
    if not value:
        return fallback
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return fallback


def _total_students(conn):
    return conn.execute("SELECT COUNT(*) AS c FROM Students").fetchone()["c"]


def _pct(part, total):
    if not total:
        return 0.0
    return round((part / total) * 100, 1)


def _attach_photo_url(rows):
    """Add the API photo path to attendance rows that include photo_path."""
    for row in rows:
        if row.get("photo_path") and row.get("student_id"):
            row["photo_url"] = f"/api/students/{row['student_id']}/photo"
    return rows


# ---------------------------------------------------------------------------
# Marking
# ---------------------------------------------------------------------------
def mark_attendance(student_id, confidence=None, marked_by="Face Recognition", on_date=None):
    """Mark a student present for one day. Never creates duplicates.

    Returns a dict with ``already_marked`` so callers can tell the user
    honestly whether this scan created a new record or matched an existing one.
    """
    day = on_date or _today().isoformat()
    now = datetime.now().strftime("%H:%M:%S")

    conn = get_connection()
    try:
        student = conn.execute(
            "SELECT student_id, name, department, year, section FROM Students WHERE student_id = ?",
            (student_id,),
        ).fetchone()
        if not student:
            return {"success": False, "error": "Student not found"}

        try:
            cur = conn.execute(
                """INSERT INTO Attendance (student_id, date, time, status, confidence, marked_by)
                   VALUES (?, ?, ?, 'Present', ?, ?)""",
                (student_id, day, now, confidence, marked_by),
            )
            conn.commit()
            record = conn.execute(
                """SELECT a.*, s.name, s.department, s.year, s.section
                   FROM Attendance a JOIN Students s ON s.student_id = a.student_id
                   WHERE a.id = ?""",
                (cur.lastrowid,),
            ).fetchone()
            return {
                "success": True,
                "already_marked": False,
                "message": f"Attendance marked for {student['name']}",
                "attendance": row_to_dict(record),
            }
        except sqlite3.IntegrityError:
            existing = conn.execute(
                """SELECT a.*, s.name, s.department, s.year, s.section
                   FROM Attendance a JOIN Students s ON s.student_id = a.student_id
                   WHERE a.student_id = ? AND a.date = ?""",
                (student_id, day),
            ).fetchone()
            return {
                "success": True,
                "already_marked": True,
                "message": f"Attendance already recorded today for {student['name']}",
                "attendance": row_to_dict(existing),
            }
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Daily roster
# ---------------------------------------------------------------------------
def get_daily_records(date_str=None, search="", department="", status=""):
    day = _parse_date(date_str, _today()).isoformat()
    conn = get_connection()
    try:
        sql = """
        SELECT s.student_id, s.name, s.department, s.year, s.section,
               s.email, s.phone, s.photo_path, s.face_registered,
               CASE WHEN a.id IS NULL THEN 'Absent' ELSE 'Present' END AS status,
               a.time, a.confidence, a.marked_by, a.date
        FROM Students s
        LEFT JOIN Attendance a
               ON a.student_id = s.student_id AND a.date = ?
        WHERE 1 = 1
        """
        params = [day]
        if search:
            like = f"%{search.strip()}%"
            sql += " AND (s.name LIKE ? OR s.student_id LIKE ?)"
            params.extend([like, like])
        if department:
            sql += " AND s.department = ?"
            params.append(department)
        if status in ("Present", "Absent"):
            if status == "Present":
                sql += " AND a.id IS NOT NULL"
            else:
                sql += " AND a.id IS NULL"
        sql += " ORDER BY s.name ASC"

        rows = _attach_photo_url(rows_to_dicts(conn.execute(sql, params).fetchall()))
        present = sum(1 for row in rows if row["status"] == "Present")
        total = len(rows)
        return {
            "date": day,
            "summary": {
                "total": total,
                "present": present,
                "absent": total - present,
                "percentage": _pct(present, total),
            },
            "records": rows,
        }
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Student-wise data
# ---------------------------------------------------------------------------
def get_student_history(student_id, from_date=None, to_date=None):
    conn = get_connection()
    try:
        student = conn.execute(
            "SELECT * FROM Students WHERE student_id = ?", (student_id,)
        ).fetchone()
        if not student:
            return None

        start = _parse_date(from_date, _today() - timedelta(days=60))
        end = _parse_date(to_date, _today())
        rows = _attach_photo_url(
            rows_to_dicts(
                conn.execute(
                    """SELECT * FROM Attendance
                       WHERE student_id = ? AND date BETWEEN ? AND ?
                       ORDER BY date DESC""",
                    (student_id, start.isoformat(), end.isoformat()),
                ).fetchall()
            )
        )
        classes = conn.execute(
            "SELECT COUNT(DISTINCT date) AS c FROM Attendance WHERE date BETWEEN ? AND ?",
            (start.isoformat(), end.isoformat()),
        ).fetchone()["c"]
        present = len(rows)
        return {
            "student": dict(student),
            "from": start.isoformat(),
            "to": end.isoformat(),
            "classes_held": classes,
            "present": present,
            "absent": max(classes - present, 0),
            "percentage": _pct(present, classes),
            "records": rows,
        }
    finally:
        conn.close()


def get_all_student_summaries(from_date=None, to_date=None):
    """Attendance percentage for every student in a date range."""
    start = _parse_date(from_date, _today() - timedelta(days=60))
    end = _parse_date(to_date, _today())
    conn = get_connection()
    try:
        rows = rows_to_dicts(
            conn.execute(
                """SELECT s.student_id, s.name, s.department, s.year, s.section,
                          s.face_registered,
                          COUNT(a.id) AS present
                   FROM Students s
                   LEFT JOIN Attendance a
                          ON a.student_id = s.student_id
                         AND a.date BETWEEN ? AND ?
                   GROUP BY s.id
                   ORDER BY s.name""",
                (start.isoformat(), end.isoformat()),
            ).fetchall()
        )
        classes = conn.execute(
            "SELECT COUNT(DISTINCT date) AS c FROM Attendance WHERE date BETWEEN ? AND ?",
            (start.isoformat(), end.isoformat()),
        ).fetchone()["c"]
        for row in rows:
            row["classes_held"] = classes
            row["absences"] = max(classes - row["present"], 0)
            row["percentage"] = _pct(row["present"], classes)
        return {
            "from": start.isoformat(),
            "to": end.isoformat(),
            "classes_held": classes,
            "students": rows,
        }
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------
def get_dashboard_stats():
    today = _today()
    yesterday = today - timedelta(days=1)
    conn = get_connection()
    try:
        total_students = _total_students(conn)
        present_today = conn.execute(
            "SELECT COUNT(*) AS c FROM Attendance WHERE date = ?", (today.isoformat(),)
        ).fetchone()["c"]
        present_yesterday = conn.execute(
            "SELECT COUNT(*) AS c FROM Attendance WHERE date = ?", (yesterday.isoformat(),)
        ).fetchone()["c"]
        face_registered = conn.execute(
            "SELECT COUNT(*) AS c FROM Students WHERE face_registered = 1"
        ).fetchone()["c"]
        attendance_records = conn.execute("SELECT COUNT(*) AS c FROM Attendance").fetchone()["c"]

        return {
            "total_students": total_students,
            "present_today": present_today,
            "absent_today": max(total_students - present_today, 0),
            "attendance_percentage": _pct(present_today, total_students),
            "yesterday_percentage": _pct(present_yesterday, total_students),
            "face_registered": face_registered,
            "total_attendance_records": attendance_records,
            "date": today.isoformat(),
        }
    finally:
        conn.close()


def get_weekly_series(days=7):
    """Last `days` working days (Sundays are holidays) with present/absent counts."""
    conn = get_connection()
    try:
        total = _total_students(conn)
        result = []
        cursor = _today()
        while len(result) < days:
            if cursor.weekday() != 6:
                present = conn.execute(
                    "SELECT COUNT(*) AS c FROM Attendance WHERE date = ?", (cursor.isoformat(),)
                ).fetchone()["c"]
                result.append(
                    {
                        "date": cursor.isoformat(),
                        "label": cursor.strftime("%a %d"),
                        "present": present,
                        "absent": max(total - present, 0),
                        "percentage": _pct(present, total),
                        "is_today": cursor == _today(),
                    }
                )
            cursor -= timedelta(days=1)
        return list(reversed(result))
    finally:
        conn.close()


def get_monthly_series(months=6):
    """Attendance percentage for the last `months` calendar months."""
    conn = get_connection()
    try:
        total = _total_students(conn)
        today = _today()
        result = []
        for offset in range(months - 1, -1, -1):
            year = today.year
            month = today.month - offset
            while month <= 0:
                month += 12
                year -= 1
            start = datetime(year, month, 1).date()
            if month == 12:
                end = datetime(year + 1, 1, 1).date() - timedelta(days=1)
            else:
                end = datetime(year, month + 1, 1).date() - timedelta(days=1)
            if end > today:
                end = today

            classes = conn.execute(
                "SELECT COUNT(DISTINCT date) AS c FROM Attendance WHERE date BETWEEN ? AND ?",
                (start.isoformat(), end.isoformat()),
            ).fetchone()["c"]
            present = conn.execute(
                "SELECT COUNT(*) AS c FROM Attendance WHERE date BETWEEN ? AND ?",
                (start.isoformat(), end.isoformat()),
            ).fetchone()["c"]
            percentage = _pct(present, classes * total)
            result.append(
                {
                    "month": start.strftime("%b"),
                    "label": start.strftime("%b %Y"),
                    "present": present,
                    "percentage": percentage,
                    "classes": classes,
                }
            )
        return result
    finally:
        conn.close()


def recent_attendance(limit=8):
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT a.*, s.name, s.department, s.year, s.section, s.photo_path
               FROM Attendance a JOIN Students s ON s.student_id = a.student_id
               ORDER BY a.date DESC, a.time DESC LIMIT ?""",
            (limit,),
        ).fetchall()
        return rows_to_dicts(rows)
    finally:
        conn.close()


def department_summary(from_date=None, to_date=None):
    start = _parse_date(from_date, _today() - timedelta(days=60))
    end = _parse_date(to_date, _today())
    conn = get_connection()
    try:
        rows = rows_to_dicts(
            conn.execute(
                """SELECT s.department,
                          COUNT(DISTINCT s.student_id) AS students,
                          COUNT(a.id) AS present
                   FROM Students s
                   LEFT JOIN Attendance a
                          ON a.student_id = s.student_id
                         AND a.date BETWEEN ? AND ?
                   GROUP BY s.department
                   ORDER BY s.department""",
                (start.isoformat(), end.isoformat()),
            ).fetchall()
        )
        classes = conn.execute(
            "SELECT COUNT(DISTINCT date) AS c FROM Attendance WHERE date BETWEEN ? AND ?",
            (start.isoformat(), end.isoformat()),
        ).fetchone()["c"]
        for row in rows:
            row["percentage"] = _pct(row["present"], classes * row["students"])
        return rows
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------
def get_report_overview(from_date=None, to_date=None):
    end = _parse_date(to_date, _today())
    start = _parse_date(from_date, end - timedelta(days=29))
    if start > end:
        start, end = end, start

    conn = get_connection()
    try:
        total_students = _total_students(conn)
        present = conn.execute(
            "SELECT COUNT(*) AS c FROM Attendance WHERE date BETWEEN ? AND ?",
            (start.isoformat(), end.isoformat()),
        ).fetchone()["c"]
        classes = conn.execute(
            "SELECT COUNT(DISTINCT date) AS c FROM Attendance WHERE date BETWEEN ? AND ?",
            (start.isoformat(), end.isoformat()),
        ).fetchone()["c"]
        possible = classes * total_students
        students = get_all_student_summaries(start.isoformat(), end.isoformat())["students"]
        best = max(students, key=lambda s: s["percentage"], default=None)
        departments = department_summary(start.isoformat(), end.isoformat())

        return {
            "from": start.isoformat(),
            "to": end.isoformat(),
            "summary": {
                "total_students": total_students,
                "classes_held": classes,
                "present": present,
                "absent": max(possible - present, 0),
                "percentage": _pct(present, possible),
                "best_student": best,
            },
            "daily": get_weekly_series(7),
            "weekly": _weekly_series(8),
            "monthly": get_monthly_series(6),
            "departments": departments,
            "students": students,
        }
    finally:
        conn.close()


def _weekly_series(weeks=8):
    conn = get_connection()
    try:
        total = _total_students(conn)
        today = _today()
        # Start of the current week (Monday)
        week_start = today - timedelta(days=today.weekday())
        result = []
        for offset in range(weeks - 1, -1, -1):
            start = week_start - timedelta(weeks=offset)
            end = min(start + timedelta(days=6), today)
            present = conn.execute(
                "SELECT COUNT(*) AS c FROM Attendance WHERE date BETWEEN ? AND ?",
                (start.isoformat(), end.isoformat()),
            ).fetchone()["c"]
            classes = conn.execute(
                "SELECT COUNT(DISTINCT date) AS c FROM Attendance WHERE date BETWEEN ? AND ?",
                (start.isoformat(), end.isoformat()),
            ).fetchone()["c"]
            result.append(
                {
                    "week": start.isocalendar()[1],
                    "label": f"W{start.isocalendar()[1]}",
                    "range": f"{start.strftime('%d %b')} - {end.strftime('%d %b')}",
                    "present": present,
                    "percentage": _pct(present, classes * total),
                }
            )
        return result
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Export helpers
# ---------------------------------------------------------------------------
def get_export_rows(from_date=None, to_date=None, search="", department=""):
    """Attendance rows for export. `search` matches student name OR student ID."""
    end = _parse_date(to_date, _today())
    start = _parse_date(from_date, end - timedelta(days=29))
    conn = get_connection()
    try:
        sql = """
        SELECT a.date, a.time, s.student_id, s.name, s.department, s.year,
               s.section, a.status, a.confidence, a.marked_by
        FROM Attendance a JOIN Students s ON s.student_id = a.student_id
        WHERE a.date BETWEEN ? AND ?
        """
        params = [start.isoformat(), end.isoformat()]
        if search:
            like = f"%{search.strip()}%"
            sql += " AND (s.student_id LIKE ? OR s.name LIKE ?)"
            params.extend([like, like])
        if department:
            sql += " AND s.department = ?"
            params.append(department)
        sql += " ORDER BY a.date DESC, a.time DESC"
        return rows_to_dicts(conn.execute(sql, params).fetchall())
    finally:
        conn.close()


def get_recognition_summary():
    """Stats used by the Take Attendance live panel."""
    today = _today().isoformat()
    conn = get_connection()
    try:
        total = _total_students(conn)
        present = conn.execute(
            "SELECT COUNT(*) AS c FROM Attendance WHERE date = ?", (today,)
        ).fetchone()["c"]
        recent = rows_to_dicts(
            _attach_photo_url(
                conn.execute(
                    """SELECT a.*, s.name, s.department, s.photo_path
                       FROM Attendance a JOIN Students s ON s.student_id = a.student_id
                       WHERE a.date = ? ORDER BY a.time DESC LIMIT 20""",
                    (today,),
                ).fetchall()
            )
        )
        return {
            "date": today,
            "total_students": total,
            "present": present,
            "absent": max(total - present, 0),
            "percentage": _pct(present, total),
            "recent": rows_to_dicts(recent),
        }
    finally:
        conn.close()
