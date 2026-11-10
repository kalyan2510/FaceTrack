/* ==========================================================================
   FaceTrack - records.js
   Daily + student-wise attendance, filters, manual marking, exports, print.
   ========================================================================== */

(function () {
  "use strict";

  let mode = "daily";
  let selectedDate = FT.todayISO();
  let search = "";
  let department = "";
  let status = "";
  let dailyData = { records: [], summary: {} };
  let studentData = [];
  let allStudents = [];
  let processing = false;

  const el = {};

  function cache() {
    el.date = document.getElementById("recordsDate");
    el.prev = document.getElementById("prevDateBtn");
    el.next = document.getElementById("nextDateBtn");
    el.search = document.getElementById("recordsSearch");
    el.department = document.getElementById("recordsDepartment");
    el.status = document.getElementById("recordsStatus");
    el.clear = document.getElementById("clearRecordFilters");
    el.dailyTab = document.getElementById("dailyTab");
    el.studentTab = document.getElementById("studentTab");
    el.dailyView = document.getElementById("dailyView");
    el.studentView = document.getElementById("studentView");
    el.rangeCaption = document.getElementById("rangeCaption");
    el.sourceBadge = document.getElementById("recordsSourceBadge");
    el.dailyBody = document.getElementById("dailyTableBody");
    el.studentBody = document.getElementById("studentwiseBody");
    el.dailyCount = document.getElementById("dailyCountBadge");
    el.dailySubtitle = document.getElementById("dailySubtitle");
    el.dailyFooter = document.getElementById("dailyFooter");
    el.studentwiseFooter = document.getElementById("studentwiseFooter");
    el.studentRange = document.getElementById("studentRangeLabel");
    el.exportExcel = document.getElementById("exportExcelBtn");
    el.exportCsv = document.getElementById("exportCsvBtn");
    el.print = document.getElementById("printRecordsBtn");
    el.printMeta = document.getElementById("printHeaderMeta");
    el.recordTotal = document.getElementById("recordTotal");
    el.recordPresent = document.getElementById("recordPresent");
    el.recordAbsent = document.getElementById("recordAbsent");
    el.recordPct = document.getElementById("recordPercentage");
    el.recordTotalLabel = document.getElementById("recordTotalLabel");
    el.recordPresentLabel = document.getElementById("recordPresentLabel");
    el.recordAbsentLabel = document.getElementById("recordAbsentLabel");
  }

  function rangeStart() {
    return FT.isoDate(FT.addDays(FT.parseISO(selectedDate), -29));
  }

  function updateSource() {
    if (!el.sourceBadge) return;
    el.sourceBadge.innerHTML = FT.isDemo()
      ? '<i class="fa-solid fa-flask"></i> Demo · sample data'
      : '<i class="fa-solid fa-database"></i> Live SQLite';
  }

  function setStats(values) {
    if (el.recordTotal) el.recordTotal.textContent = FT.formatNumber(values.total);
    if (el.recordPresent) el.recordPresent.textContent = FT.formatNumber(values.present);
    if (el.recordAbsent) el.recordAbsent.textContent = FT.formatNumber(values.absent);
    if (el.recordPct) el.recordPct.textContent = `${Number(values.percentage || 0).toFixed(1)}%`;
    if (el.recordTotalLabel) el.recordTotalLabel.textContent = values.totalLabel || "Students";
    if (el.recordPresentLabel) el.recordPresentLabel.textContent = values.presentLabel || "Present";
    if (el.recordAbsentLabel) el.recordAbsentLabel.textContent = values.absentLabel || "Absent";
  }

  function updatePrintMeta() {
    if (!el.printMeta) return;
    const label = mode === "daily" ? "Daily attendance roster" : "Student-wise attendance summary";
    const range = mode === "daily" ? FT.formatDate(selectedDate, { long: true }) : `${FT.formatDate(rangeStart())} to ${FT.formatDate(selectedDate)}`;
    el.printMeta.textContent = `${label} · ${range} · Generated ${new Date().toLocaleString("en-IN")}`;
  }

  // ------------------------------------------------------------------
  // Daily view
  // ------------------------------------------------------------------
  function dailyEmpty(message) {
    return `<tr><td colspan="8">
      <div class="empty-state">
        <div class="empty-icon"><i class="fa-solid fa-calendar-xmark"></i></div>
        <h4>No matching attendance records</h4>
        <p>${FT.escapeHtml(message || "Try another date, student or department filter.")}</p>
        <button type="button" class="btn btn-sm btn-primary" id="emptyClearFilters"><i class="fa-solid fa-filter-circle-xmark"></i> Clear filters</button>
      </div>
    </td></tr>`;
  }

  function renderDaily() {
    const records = dailyData.records || [];
    const summary = dailyData.summary || {};
    const isToday = selectedDate === FT.todayISO();

    setStats({
      total: summary.total != null ? summary.total : records.length,
      present: summary.present != null ? summary.present : records.filter((row) => row.status === "Present").length,
      absent: summary.absent != null ? summary.absent : records.filter((row) => row.status === "Absent").length,
      percentage: summary.percentage || 0,
      totalLabel: "Students",
      presentLabel: "Present",
      absentLabel: "Absent",
    });
    if (el.dailyCount) el.dailyCount.textContent = `${records.length} record${records.length === 1 ? "" : "s"}`;
    if (el.dailySubtitle) el.dailySubtitle.textContent = `Roster for ${FT.formatDate(selectedDate, { long: true })} · ${FT.isDemo() ? "sample data" : "live records"}.`;
    if (el.dailyFooter) {
      el.dailyFooter.innerHTML = records.length
        ? `Showing <strong>${records.length}</strong> student${records.length === 1 ? "" : "s"} · ${FT.formatDate(selectedDate)}`
        : "No students match the current filters.";
    }

    if (!records.length) {
      el.dailyBody.innerHTML = dailyEmpty(dailyData.error || "Try another date, student or department filter.");
      document.getElementById("emptyClearFilters")?.addEventListener("click", clearFilters);
      return;
    }

    el.dailyBody.innerHTML = records
      .map((row) => {
        const present = row.status === "Present";
        const action = present
          ? `<a class="btn-icon success" href="students.html?q=${encodeURIComponent(row.student_id)}" title="View student profile"><i class="fa-regular fa-eye"></i></a>`
          : isToday
          ? `<button class="btn btn-sm btn-soft" type="button" data-mark="${FT.escapeHtml(row.student_id)}"><i class="fa-solid fa-check"></i> Mark</button>`
          : `<a class="btn-icon" href="students.html?q=${encodeURIComponent(row.student_id)}" title="View student profile"><i class="fa-regular fa-eye"></i></a>`;
        return `
          <tr>
            <td>
              <div class="student-cell">
                ${FT.avatarHtml(row, "", "avatar-sm")}
                <div>
                  <span class="cell-strong">${FT.escapeHtml(row.name)}</span>
                  <span class="cell-sub">${FT.escapeHtml(row.email || "")}</span>
                </div>
              </div>
            </td>
            <td><span class="student-id-badge">${FT.escapeHtml(row.student_id)}</span></td>
            <td class="fs-12">${FT.escapeHtml(row.department || "—")}</td>
            <td><span class="cell-strong">${FT.escapeHtml(row.year || "—")}</span><span class="cell-sub">Section ${FT.escapeHtml(row.section || "A")}</span></td>
            <td>${FT.statusBadge(row.status)}</td>
            <td>${present ? `<span class="punch-time"><i class="fa-regular fa-clock"></i>${FT.formatTime(row.time)}</span>` : '<span class="text-muted-ft">—</span>'}</td>
            <td>${present && row.confidence != null ? `<span class="badge-soft ${Number(row.confidence) >= 80 ? "badge-info" : "badge-neutral"}">${FT.confidenceLabel(row.confidence)}</span>` : '<span class="text-muted-ft">—</span>'}</td>
            <td class="cell-actions no-print">${action}</td>
          </tr>`;
      })
      .join("");
  }

  async function loadDaily() {
    if (el.dailyBody) {
      el.dailyBody.innerHTML = `<tr><td colspan="8"><div class="skeleton" style="height:20px;margin:8px 0"></div><div class="skeleton" style="height:20px;margin:8px 0"></div></td></tr>`;
    }
    try {
      dailyData = await FT.data.getDaily({
        date: selectedDate,
        search,
        department,
        status,
      });
      renderDaily();
      const range = `${FT.formatDate(selectedDate, { long: true })}`;
      if (el.rangeCaption) el.rangeCaption.innerHTML = `<i class="fa-regular fa-calendar me-1"></i> Daily roster · <strong>${FT.escapeHtml(range)}</strong>`;
      updatePrintMeta();
    } catch (error) {
      dailyData = { records: [], summary: {} };
      el.dailyBody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon" style="background:#FEF3C7;color:#D97706"><i class="fa-solid fa-triangle-exclamation"></i></div><h4>Records could not be loaded</h4><p>${FT.escapeHtml(error.message)}</p><button class="btn btn-sm btn-primary" type="button" id="recordsRetry">Try again</button></div></td></tr>`;
      document.getElementById("recordsRetry")?.addEventListener("click", loadDaily);
      FT.toast("error", "Attendance unavailable", error.message);
    }
  }

  // ------------------------------------------------------------------
  // Student-wise view
  // ------------------------------------------------------------------
  function renderStudentwise() {
    let rows = studentData.slice();
    if (search) {
      const needle = search.toLowerCase();
      rows = rows.filter((row) => `${row.name} ${row.student_id}`.toLowerCase().includes(needle));
    }
    if (department) rows = rows.filter((row) => row.department === department);

    const classes = rows.length ? rows[0].classes_held : 0;
    const totalPresent = rows.reduce((sum, row) => sum + Number(row.present || 0), 0);
    const totalAbsent = rows.reduce((sum, row) => sum + Number(row.absences || row.absent || 0), 0);
    const possible = classes * rows.length;
    const weighted = possible ? (totalPresent / possible) * 100 : 0;
    setStats({
      total: rows.length,
      present: totalPresent,
      absent: totalAbsent,
      percentage: weighted,
      totalLabel: "Students",
      presentLabel: "Present in range",
      absentLabel: "Absent in range",
    });

    if (el.studentRange) {
      el.studentRange.textContent = `${FT.formatDate(rangeStart())} – ${FT.formatDate(selectedDate)} · ${classes} class day${classes === 1 ? "" : "s"} · ${FT.isDemo() ? "demo data" : "live records"}`;
    }
    if (el.studentwiseFooter) {
      el.studentwiseFooter.innerHTML = rows.length
        ? `Showing <strong>${rows.length}</strong> students · weighted attendance <strong>${weighted.toFixed(1)}%</strong>`
        : "No students match the current filters.";
    }
    if (el.rangeCaption) {
      el.rangeCaption.innerHTML = `<i class="fa-regular fa-calendar-days me-1"></i> Student-wise range · <strong>${FT.formatDate(rangeStart())} – ${FT.formatDate(selectedDate)}</strong> (last 30 days)`;
    }
    updatePrintMeta();

    if (!rows.length) {
      el.studentBody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-icon"><i class="fa-solid fa-user-graduate"></i></div><h4>No student records</h4><p>No students match the selected filters.</p><button type="button" class="btn btn-sm btn-primary" id="emptyClearFiltersStudent"><i class="fa-solid fa-filter-circle-xmark"></i> Clear filters</button></div></td></tr>`;
      document.getElementById("emptyClearFiltersStudent")?.addEventListener("click", clearFilters);
      return;
    }

    el.studentBody.innerHTML = rows
      .map((row) => {
        const pct = Number(row.percentage || 0);
        const barClass = pct < 60 ? "bad" : pct < 75 ? "warn" : "";
        const standing = pct >= 75
          ? '<span class="badge-soft badge-success"><i class="fa-solid fa-circle-check"></i> Good</span>'
          : pct >= 60
          ? '<span class="badge-soft badge-warning"><i class="fa-solid fa-triangle-exclamation"></i> Watch</span>'
          : '<span class="badge-soft badge-danger"><i class="fa-solid fa-circle-xmark"></i> Critical</span>';
        return `
          <tr>
            <td>
              <div class="student-cell">
                ${FT.avatarHtml(row, "", "avatar-sm")}
                <div>
                  <span class="cell-strong">${FT.escapeHtml(row.name)}</span>
                  <span class="cell-sub">${FT.escapeHtml(row.year)} · Section ${FT.escapeHtml(row.section || "A")}</span>
                </div>
              </div>
            </td>
            <td><span class="student-id-badge">${FT.escapeHtml(row.student_id)}</span></td>
            <td class="fs-12">${FT.escapeHtml(row.department)}</td>
            <td>${row.classes_held}</td>
            <td class="text-green fw-600">${row.present}</td>
            <td class="text-red fw-600">${row.absences != null ? row.absences : row.absent}</td>
            <td>
              <div class="percent-cell">
                <div class="percent-bar"><span class="${barClass}" style="width:${Math.min(pct, 100)}%"></span></div>
                <b>${pct.toFixed(1)}%</b>
              </div>
            </td>
            <td>${standing}</td>
            <td class="cell-actions no-print"><a class="btn-icon success" href="students.html?q=${encodeURIComponent(row.student_id)}" title="View profile"><i class="fa-regular fa-eye"></i></a></td>
          </tr>`;
      })
      .join("");
  }

  async function loadStudentwise() {
    if (el.studentBody) {
      el.studentBody.innerHTML = `<tr><td colspan="9"><div class="skeleton" style="height:20px;margin:8px 0"></div><div class="skeleton" style="height:20px;margin:8px 0"></div></td></tr>`;
    }
    try {
      const response = await FT.data.getStudentSummaries(rangeStart(), selectedDate);
      studentData = response.students || [];
      renderStudentwise();
    } catch (error) {
      el.studentBody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-icon" style="background:#FEF3C7;color:#D97706"><i class="fa-solid fa-triangle-exclamation"></i></div><h4>Summary could not be loaded</h4><p>${FT.escapeHtml(error.message)}</p><button class="btn btn-sm btn-primary" type="button" id="studentRetry">Try again</button></div></td></tr>`;
      document.getElementById("studentRetry")?.addEventListener("click", loadStudentwise);
      FT.toast("error", "Student summary unavailable", error.message);
    }
  }

  // ------------------------------------------------------------------
  // Shared actions
  // ------------------------------------------------------------------
  async function load() {
    updateSource();
    if (mode === "daily") {
      el.dailyView.style.display = "";
      el.studentView.style.display = "none";
      el.status.style.display = "";
      await loadDaily();
    } else {
      el.dailyView.style.display = "none";
      el.studentView.style.display = "";
      el.status.style.display = "none";
      await loadStudentwise();
    }
    if (el.next) el.next.disabled = selectedDate >= FT.todayISO();
  }

  function setMode(nextMode) {
    if (mode === nextMode) return;
    mode = nextMode;
    el.dailyTab.classList.toggle("active", mode === "daily");
    el.studentTab.classList.toggle("active", mode === "student");
    el.dailyTab.setAttribute("aria-selected", String(mode === "daily"));
    el.studentTab.setAttribute("aria-selected", String(mode === "student"));
    load();
  }

  function clearFilters() {
    search = "";
    department = "";
    status = "";
    if (el.search) el.search.value = "";
    if (el.department) el.department.value = "";
    if (el.status) el.status.value = "";
    selectedDate = FT.todayISO();
    if (el.date) el.date.value = selectedDate;
    load();
  }

  async function markPresent(studentId, button) {
    if (processing) return;
    const row = (dailyData.records || []).find((item) => item.student_id === studentId);
    if (!row) return;
    const confirmed = await FT.confirm({
      title: "Mark attendance manually?",
      message: `<strong>${FT.escapeHtml(row.name)}</strong> will be marked <strong>Present</strong> for today. Duplicate records are automatically blocked.`,
      confirmText: "Mark present",
      icon: "fa-user-check",
    });
    if (!confirmed) return;
    processing = true;
    FT.setButtonLoading(button, true, "Marking…");
    try {
      const response = await FT.data.markAttendance(studentId);
      if (response.already_marked) {
        FT.toast("info", "Already marked", `${row.name} already has attendance for today.`);
      } else {
        FT.toast("success", "Attendance marked", `${row.name} was marked present manually.`);
      }
      await loadDaily();
    } catch (error) {
      FT.toast("error", "Could not mark attendance", error.message);
      FT.setButtonLoading(button, false);
    } finally {
      processing = false;
    }
  }

  async function exportRecords(format, button) {
    const isDaily = mode === "daily";
    FT.setButtonLoading(button, true, "Exporting…");
    try {
      await FT.exportAttendance({
        format,
        from: isDaily ? selectedDate : rangeStart(),
        to: selectedDate,
        search,
        department,
      });
    } finally {
      FT.setButtonLoading(button, false);
    }
  }

  function printRecords() {
    updatePrintMeta();
    window.print();
  }

  async function fillDepartments() {
    try {
      const response = await FT.data.getStudents({});
      allStudents = response.students || [];
      const departments = Array.from(new Set(allStudents.map((student) => student.department))).sort();
      el.department.innerHTML =
        '<option value="">All Departments</option>' +
        departments.map((name) => `<option value="${FT.escapeHtml(name)}">${FT.escapeHtml(name)}</option>`).join("");
      if (department) el.department.value = department;
    } catch (_error) {
      /* Filter still works without the department list */
    }
  }

  function wire() {
    el.dailyTab?.addEventListener("click", () => setMode("daily"));
    el.studentTab?.addEventListener("click", () => setMode("student"));

    el.date?.addEventListener("change", () => {
      selectedDate = el.date.value || FT.todayISO();
      if (selectedDate > FT.todayISO()) selectedDate = FT.todayISO();
      el.date.value = selectedDate;
      load();
    });
    el.prev?.addEventListener("click", () => {
      selectedDate = FT.isoDate(FT.addDays(FT.parseISO(selectedDate), -1));
      el.date.value = selectedDate;
      load();
    });
    el.next?.addEventListener("click", () => {
      const next = FT.isoDate(FT.addDays(FT.parseISO(selectedDate), 1));
      if (next > FT.todayISO()) return;
      selectedDate = next;
      el.date.value = selectedDate;
      load();
    });
    el.search?.addEventListener(
      "input",
      FT.debounce(() => {
        search = el.search.value.trim();
        if (mode === "daily") loadDaily();
        else renderStudentwise();
      }, 250)
    );
    el.department?.addEventListener("change", () => {
      department = el.department.value;
      if (mode === "daily") loadDaily();
      else renderStudentwise();
    });
    el.status?.addEventListener("change", () => {
      status = el.status.value;
      loadDaily();
    });
    el.clear?.addEventListener("click", clearFilters);
    el.exportExcel?.addEventListener("click", () => exportRecords("excel", el.exportExcel));
    el.exportCsv?.addEventListener("click", () => exportRecords("csv", el.exportCsv));
    el.print?.addEventListener("click", printRecords);

    el.dailyBody?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-mark]");
      if (button) markPresent(button.dataset.mark, button);
    });
  }

  async function boot() {
    cache();
    const init = await FT.init({
      active: "records",
      title: "Attendance Records",
      subtitle: "Daily and student-wise attendance history",
    });
    if (!init) return;

    const requested = FT.queryParam("date");
    if (requested && FT.parseISO(requested)) selectedDate = requested > FT.todayISO() ? FT.todayISO() : requested;
    el.date.value = selectedDate;
    el.date.max = FT.todayISO();
    if (el.next) el.next.disabled = selectedDate >= FT.todayISO();
    updateSource();
    updatePrintMeta();
    wire();
    await fillDepartments();
    await load();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
