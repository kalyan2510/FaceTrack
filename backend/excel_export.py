"""
FaceTrack - Excel & CSV export
==============================
Builds downloadable attendance reports in memory.

* Excel (.xlsx) is written directly with OpenPyXL.
* CSV is written with Python's built-in ``csv`` module (UTF-8 with BOM).
* No Pandas dependency, no temporary files, no third-party uploads.

This module deliberately avoids pandas so it works on locked-down Windows
machines where Application Control blocks pandas' compiled DLLs.
"""

import csv
import math
from datetime import date, datetime
from io import BytesIO, StringIO

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

NAVY = "14213D"
BLUE = "2563EB"
GREEN = "16A34A"
RED = "DC2626"
WHITE = "FFFFFF"

# (database key, spreadsheet heading) — order matters for every export.
COLUMNS = (
    ("date", "Date"),
    ("time", "Punch In"),
    ("student_id", "Student ID"),
    ("name", "Student Name"),
    ("department", "Department"),
    ("year", "Year"),
    ("section", "Section"),
    ("status", "Status"),
    ("confidence", "Match Score (%)"),
    ("marked_by", "Marked By"),
)

HEADERS = [label for _, label in COLUMNS]
COLUMN_WIDTHS = (13, 12, 16, 24, 24, 11, 9, 12, 16, 20)


# ---------------------------------------------------------------------------
# Value normalisation
# ---------------------------------------------------------------------------
def _raw_value(row, key):
    """Read a key from a dict or sqlite3.Row without raising on gaps."""
    if row is None:
        return ""
    if isinstance(row, dict):
        return row.get(key, "")
    try:
        return row[key]
    except (KeyError, IndexError, TypeError):
        return ""


def _text(value):
    """Return clean text; turn SQL/NumPy missing-value markers into blanks."""
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, date):
        return value.isoformat()
    text = str(value)
    if text.strip().lower() in {"", "none", "nan", "nat", "null"}:
        return ""
    return text


def _score(value):
    """Format a match score as a number with one decimal, or blank."""
    if value is None:
        return ""
    if isinstance(value, str):
        value = value.strip()
        if value.lower() in {"", "none", "nan", "nat", "null"}:
            return ""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return ""
    if not math.isfinite(number):
        return ""
    return round(number, 1)


def _normalise_row(row):
    values = []
    for key, _label in COLUMNS:
        value = _raw_value(row, key)
        if key == "confidence":
            values.append(_score(value))
        else:
            values.append(_text(value))
    return values


def _normalise_rows(rows):
    return [_normalise_row(row) for row in (rows or [])]


# ---------------------------------------------------------------------------
# Shared workbook styling
# ---------------------------------------------------------------------------
def _style_title(sheet, last_column):
    sheet.merge_cells(start_row=1, start_column=1, end_row=1, end_column=last_column)
    title = sheet.cell(row=1, column=1, value="FaceTrack - Attendance Report")
    title.font = Font(name="Calibri", size=16, bold=True, color=WHITE)
    title.fill = PatternFill("solid", fgColor=NAVY)
    title.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    sheet.row_dimensions[1].height = 30


def _style_meta(sheet, row_number, last_column, value):
    sheet.merge_cells(
        start_row=row_number,
        start_column=1,
        end_row=row_number,
        end_column=last_column,
    )
    cell = sheet.cell(row=row_number, column=1, value=value)
    cell.font = Font(name="Calibri", size=10, color="475569")
    cell.alignment = Alignment(indent=1)


# ---------------------------------------------------------------------------
# Excel export
# ---------------------------------------------------------------------------
def export_attendance_excel(rows, from_date=None, to_date=None, summary=None):
    """Return an in-memory .xlsx workbook built with OpenPyXL only."""
    records = _normalise_rows(rows)
    summary = summary or {}
    column_count = len(COLUMNS)
    last_letter = get_column_letter(column_count)
    header_row = 5

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Attendance"

    # Title block
    _style_title(sheet, column_count)
    _style_meta(sheet, 2, column_count, f"Period: {from_date or 'All'} to {to_date or 'All'}")
    percentage = summary.get("percentage")
    percentage_text = f"{percentage}%" if percentage not in (None, "") else "—"
    generated = (
        f"Generated: {datetime.now().strftime('%d %b %Y, %I:%M %p')}  |  "
        f"Records: {len(records)}  |  Present: {summary.get('present', len(records))}  |  "
        f"Attendance: {percentage_text}"
    )
    _style_meta(sheet, 3, column_count, generated)

    # Header
    header_fill = PatternFill("solid", fgColor=BLUE)
    thin = Side(style="thin", color="E2E8F0")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    for index, label in enumerate(HEADERS, start=1):
        cell = sheet.cell(row=header_row, column=index, value=label)
        cell.font = Font(name="Calibri", bold=True, color=WHITE, size=10)
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = border
    sheet.row_dimensions[header_row].height = 22

    # Data rows
    for row_offset, values in enumerate(records, start=header_row + 1):
        for column_index, value in enumerate(values, start=1):
            cell = sheet.cell(row=row_offset, column=column_index, value=value)
            cell.border = border
            cell.font = Font(name="Calibri", size=10, color="1E293B")
            cell.alignment = Alignment(vertical="center")
            if column_index == 8 and value == "Present":
                cell.font = Font(name="Calibri", size=10, color=GREEN, bold=True)
            elif column_index == 8 and value == "Absent":
                cell.font = Font(name="Calibri", size=10, color=RED, bold=True)
            if column_index == 1:
                cell.alignment = Alignment(horizontal="center", vertical="center")
            elif column_index in (6, 7, 9):
                cell.alignment = Alignment(horizontal="center", vertical="center")

    for index, width in enumerate(COLUMN_WIDTHS, start=1):
        sheet.column_dimensions[get_column_letter(index)].width = width

    sheet.freeze_panes = "A6"
    sheet.auto_filter.ref = (
        f"A{header_row}:{last_letter}{max(sheet.max_row, header_row)}"
    )
    sheet.sheet_view.showGridLines = False
    sheet.page_setup.orientation = "landscape"
    sheet.print_title_rows = f"1:{header_row}"

    # Summary sheet
    summary_sheet = workbook.create_sheet("Summary")
    summary_sheet.column_dimensions["A"].width = 28
    summary_sheet.column_dimensions["B"].width = 30
    summary_sheet.merge_cells("A1:B1")
    heading = summary_sheet["A1"]
    heading.value = "FaceTrack - Summary"
    heading.font = Font(name="Calibri", size=15, bold=True, color=WHITE)
    heading.fill = PatternFill("solid", fgColor=NAVY)
    heading.alignment = Alignment(horizontal="center", vertical="center")
    summary_sheet.row_dimensions[1].height = 28

    summary_rows = [
        ("Report period", f"{from_date or 'All'} to {to_date or 'All'}"),
        ("Total students", summary.get("total_students", "—")),
        ("Present records", summary.get("present", len(records))),
        ("Absent records", summary.get("absent", "—")),
        ("Attendance percentage", percentage_text),
        ("Classes held", summary.get("classes_held", "—")),
        ("Generated at", datetime.now().strftime("%d %b %Y, %I:%M %p")),
        ("Generated by", "FaceTrack Attendance Management System"),
    ]
    summary_border = Border(bottom=Side(style="thin", color="E2E8F0"))
    for index, (label, value) in enumerate(summary_rows, start=3):
        label_cell = summary_sheet.cell(row=index, column=1, value=label)
        value_cell = summary_sheet.cell(row=index, column=2, value=value)
        label_cell.font = Font(bold=True, color=NAVY)
        value_cell.font = Font(color="1E293B")
        label_cell.border = summary_border
        value_cell.border = summary_border

    summary_sheet.merge_cells(start_row=12, start_column=1, end_row=12, end_column=2)
    note = summary_sheet.cell(
        row=12,
        column=1,
        value="Generated by FaceTrack. Demo-mode data is never exported from the backend.",
    )
    note.font = Font(size=9, italic=True, color="64748B")
    summary_sheet.sheet_view.showGridLines = False

    output = BytesIO()
    workbook.save(output)
    workbook.close()
    output.seek(0)
    return output


# ---------------------------------------------------------------------------
# CSV export
# ---------------------------------------------------------------------------
def export_attendance_csv(rows):
    """Return a UTF-8 (BOM) CSV buffer that opens cleanly in Excel."""
    records = _normalise_rows(rows)
    text = StringIO(newline="")
    writer = csv.writer(text, lineterminator="\r\n")
    writer.writerow(HEADERS)
    writer.writerows(records)

    output = BytesIO()
    output.write(b"\xef\xbb\xbf")  # BOM so Excel detects UTF-8 (Indian names)
    output.write(text.getvalue().encode("utf-8"))
    output.seek(0)
    return output


def filename_for(extension="xlsx", from_date=None, to_date=None):
    start = (from_date or "").replace("-", "")
    end = (to_date or "").replace("-", "")
    suffix = f"_{start}_{end}" if start or end else ""
    return f"FaceTrack_Attendance{suffix}.{extension}"
