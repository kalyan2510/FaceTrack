/* ==========================================================================
   FaceTrack - reports.js
   Analytics KPIs, daily/weekly/monthly/department charts and student table.
   All numbers come from the API (or clearly labelled demo data).
   ========================================================================== */

(function () {
  "use strict";

  const PALETTE = ["#2563EB", "#16A34A", "#7C3AED", "#F59E0B", "#0EA5E9", "#DC2626", "#0F766E", "#DB2777"];

  let from = FT.isoDate(FT.addDays(new Date(), -29));
  let to = FT.todayISO();
  let report = null;
  let charts = { daily: null, weekly: null, monthly: null, departments: null };
  let busy = false;

  const el = {};

  function cache() {
    el.from = document.getElementById("reportFrom");
    el.to = document.getElementById("reportTo");
    el.apply = document.getElementById("applyReportRange");
    el.presets = Array.from(document.querySelectorAll(".report-preset"));
    el.source = document.getElementById("reportSourceBadge");
    el.kpiAttendance = document.getElementById("kpiAttendance");
    el.kpiAttendanceNote = document.getElementById("kpiAttendanceNote");
    el.kpiPresent = document.getElementById("kpiPresent");
    el.kpiPresentNote = document.getElementById("kpiPresentNote");
    el.kpiAbsent = document.getElementById("kpiAbsent");
    el.kpiAbsentNote = document.getElementById("kpiAbsentNote");
    el.kpiBest = document.getElementById("kpiBest");
    el.kpiBestNote = document.getElementById("kpiBestNote");
    el.dailyChart = document.getElementById("reportDailyChart");
    el.weeklyChart = document.getElementById("reportWeeklyChart");
    el.monthlyChart = document.getElementById("reportMonthlyChart");
    el.departmentChart = document.getElementById("departmentChart");
    el.departmentLegend = document.getElementById("departmentLegend");
    el.studentSearch = document.getElementById("reportStudentSearch");
    el.studentBody = document.getElementById("reportStudentBody");
    el.studentFooter = document.getElementById("reportStudentFooter");
    el.studentSubtitle = document.getElementById("reportStudentSubtitle");
    el.exportCsv = document.getElementById("reportExportCsv");
    el.exportExcel = document.getElementById("reportExportExcel");
    el.print = document.getElementById("reportPrint");
    el.printMeta = document.getElementById("printHeaderMeta");
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  function setText(node, value) {
    if (node) node.textContent = value;
  }

  function markPreset(days) {
    el.presets.forEach((button) => button.classList.toggle("active", Number(button.dataset.days) === days));
  }

  function sourceBadge() {
    if (!el.source) return;
    el.source.innerHTML = FT.isDemo()
      ? '<i class="fa-solid fa-flask"></i> Demo · sample data'
      : '<i class="fa-solid fa-database"></i> Live SQLite';
  }

  function updatePrintMeta() {
    if (!el.printMeta) return;
    el.printMeta.textContent = `Analytics report · ${FT.formatDate(from)} – ${FT.formatDate(to)} · Generated ${new Date().toLocaleString("en-IN")}`;
  }

  function destroyChart(key) {
    if (charts[key]) {
      charts[key].destroy();
      charts[key] = null;
    }
  }

  function emptyChartMessage(canvas, message) {
    if (!canvas || !canvas.parentElement) return;
    const wrap = canvas.parentElement;
    if (wrap.querySelector(".chart-empty-note")) return;
    const note = document.createElement("div");
    note.className = "chart-empty-note";
    note.style.cssText =
      "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:18px;color:#94A3B8;font-size:11.5px;";
    note.innerHTML = `<div><i class="fa-solid fa-chart-simple" style="font-size:22px;display:block;margin-bottom:8px;color:#CBD5E1"></i>${FT.escapeHtml(message)}</div>`;
    wrap.appendChild(note);
  }

  function clearEmptyChartMessage(canvas) {
    if (!canvas || !canvas.parentElement) return;
    canvas.parentElement.querySelectorAll(".chart-empty-note").forEach((node) => node.remove());
  }

  function baseScales(percent) {
    return {
      x: {
        grid: { display: false },
        border: { display: false },
        ticks: { font: { size: 9.5 }, color: "#94A3B8", maxRotation: 0, autoSkipPadding: 8 },
      },
      y: {
        beginAtZero: true,
        ...(percent ? { min: 0, max: 100 } : {}),
        grid: { color: "rgba(148, 163, 184, 0.12)", drawTicks: false },
        border: { display: false },
        ticks: {
          font: { size: 9 },
          color: "#94A3B8",
          padding: 8,
          ...(percent ? { stepSize: 25, callback: (value) => `${value}%` } : { precision: 0 }),
        },
      },
    };
  }

  // ------------------------------------------------------------------
  // KPIs
  // ------------------------------------------------------------------
  function renderKpis() {
    const summary = (report && report.summary) || {};
    const best = summary.best_student || null;

    setText(el.kpiAttendance, `${Number(summary.percentage || 0).toFixed(1)}%`);
    setText(
      el.kpiAttendanceNote,
      `${summary.classes_held || 0} class day${summary.classes_held === 1 ? "" : "s"} · ${summary.present || 0} check-ins`
    );
    setText(el.kpiPresent, FT.formatNumber(summary.present || 0));
    setText(el.kpiPresentNote, `Across ${summary.total_students || 0} students`);
    setText(el.kpiAbsent, FT.formatNumber(summary.absent || 0));
    setText(el.kpiAbsentNote, "Derived from missing check-ins");

    if (best) {
      setText(el.kpiBest, best.name || best.student_id || "—");
      setText(el.kpiBestNote, `${best.student_id || ""} · ${Number(best.percentage || 0).toFixed(1)}%`);
      if (el.kpiBest) el.kpiBest.title = `${best.name || ""} (${best.student_id || ""}) — ${Number(best.percentage || 0).toFixed(1)}%`;
    } else {
      setText(el.kpiBest, "—");
      setText(el.kpiBestNote, "No attendance in range");
      if (el.kpiBest) el.kpiBest.title = "";
    }
  }

  // ------------------------------------------------------------------
  // Charts
  // ------------------------------------------------------------------
  function renderDailyChart() {
    const rows = (report && report.daily) || [];
    if (!el.dailyChart || !window.Chart) {
      emptyChartMessage(el.dailyChart, "Chart library could not be loaded. Check your internet connection.");
      return;
    }
    clearEmptyChartMessage(el.dailyChart);
    destroyChart("daily");
    if (!rows.length) return emptyChartMessage(el.dailyChart, "No daily data in this range.");

    charts.daily = new Chart(el.dailyChart.getContext("2d"), {
      type: "bar",
      data: {
        labels: rows.map((row) => row.label),
        datasets: [
          {
            label: "Present",
            data: rows.map((row) => Number(row.present || 0)),
            backgroundColor: "#2563EB",
            hoverBackgroundColor: "#1D4ED8",
            borderRadius: 6,
            borderSkipped: false,
            maxBarThickness: 24,
            barPercentage: 0.7,
            categoryPercentage: 0.62,
          },
          {
            label: "Absent",
            data: rows.map((row) => Number(row.absent || 0)),
            backgroundColor: "#E7EDF7",
            hoverBackgroundColor: "#CBD5E1",
            borderRadius: 6,
            borderSkipped: false,
            maxBarThickness: 24,
            barPercentage: 0.7,
            categoryPercentage: 0.62,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "top", align: "end", labels: { padding: 14 } },
          tooltip: {
            callbacks: {
              label: (context) => ` ${context.dataset.label}: ${context.parsed.y}`,
              afterBody(items) {
                const row = rows[items[0].dataIndex];
                return row ? `Attendance: ${row.percentage}%` : "";
              },
            },
          },
        },
        scales: baseScales(false),
      },
    });
  }

  function renderWeeklyChart() {
    const rows = (report && report.weekly) || [];
    if (!el.weeklyChart || !window.Chart) {
      emptyChartMessage(el.weeklyChart, "Chart library could not be loaded. Check your internet connection.");
      return;
    }
    clearEmptyChartMessage(el.weeklyChart);
    destroyChart("weekly");
    if (!rows.length) return emptyChartMessage(el.weeklyChart, "No weekly data in this range.");

    const context = el.weeklyChart.getContext("2d");
    const gradient = context.createLinearGradient(0, 0, 0, 260);
    gradient.addColorStop(0, "rgba(37, 99, 235, 0.20)");
    gradient.addColorStop(1, "rgba(37, 99, 235, 0.01)");

    charts.weekly = new Chart(context, {
      type: "line",
      data: {
        labels: rows.map((row) => row.label),
        datasets: [
          {
            label: "Attendance %",
            data: rows.map((row) => Number(row.percentage || 0)),
            borderColor: "#2563EB",
            backgroundColor: gradient,
            fill: true,
            tension: 0.38,
            borderWidth: 2.5,
            pointRadius: 2.5,
            pointHoverRadius: 5,
            pointBackgroundColor: "#fff",
            pointBorderColor: "#2563EB",
            pointBorderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => ` Attendance: ${context.parsed.y}%`,
              afterLabel(context) {
                const row = rows[context.dataIndex];
                return row ? `${row.range || ""} · ${row.present} check-ins` : "";
              },
            },
          },
        },
        scales: baseScales(true),
      },
    });
  }

  function renderMonthlyChart() {
    const rows = (report && report.monthly) || [];
    if (!el.monthlyChart || !window.Chart) {
      emptyChartMessage(el.monthlyChart, "Chart library could not be loaded. Check your internet connection.");
      return;
    }
    clearEmptyChartMessage(el.monthlyChart);
    destroyChart("monthly");
    if (!rows.length) return emptyChartMessage(el.monthlyChart, "No monthly data available yet.");

    const context = el.monthlyChart.getContext("2d");
    const gradient = context.createLinearGradient(0, 0, 0, 270);
    gradient.addColorStop(0, "rgba(22, 163, 74, 0.20)");
    gradient.addColorStop(1, "rgba(22, 163, 74, 0.01)");

    charts.monthly = new Chart(context, {
      type: "line",
      data: {
        labels: rows.map((row) => row.month || row.label),
        datasets: [
          {
            label: "Attendance %",
            data: rows.map((row) => Number(row.percentage || 0)),
            borderColor: "#16A34A",
            backgroundColor: gradient,
            fill: true,
            tension: 0.4,
            borderWidth: 2.5,
            pointRadius: 2.5,
            pointHoverRadius: 5,
            pointBackgroundColor: "#fff",
            pointBorderColor: "#16A34A",
            pointBorderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => ` Attendance: ${context.parsed.y}%`,
              afterLabel(context) {
                const row = rows[context.dataIndex];
                return row ? `${row.present} check-ins · ${row.classes} class days` : "";
              },
            },
          },
        },
        scales: baseScales(true),
      },
    });
  }

  function renderDepartmentChart() {
    const rows = (report && report.departments) || [];
    if (!el.departmentChart || !window.Chart) {
      emptyChartMessage(el.departmentChart, "Chart library could not be loaded.");
      return;
    }
    clearEmptyChartMessage(el.departmentChart);
    destroyChart("departments");

    if (el.departmentLegend) {
      el.departmentLegend.innerHTML = rows.length
        ? rows
            .map(
              (row, index) => `
              <div class="dept-row">
                <span class="dept-dot" style="background:${PALETTE[index % PALETTE.length]}"></span>
                <span class="dept-name" title="${FT.escapeHtml(row.department)}">${FT.escapeHtml(row.department)}</span>
                <span class="dept-value">${Number(row.students || 0)}</span>
                <span class="dept-count">${Number(row.percentage || 0).toFixed(1)}%</span>
              </div>`
            )
            .join("")
        : '<div class="dept-row"><span class="dept-name text-muted-ft">No department data.</span></div>';
    }

    if (!rows.length) {
      emptyChartMessage(el.departmentChart, "No department data.");
      return;
    }

    charts.departments = new Chart(el.departmentChart.getContext("2d"), {
      type: "doughnut",
      data: {
        labels: rows.map((row) => row.department),
        datasets: [
          {
            data: rows.map((row) => Number(row.students || 0)),
            backgroundColor: rows.map((_, index) => PALETTE[index % PALETTE.length]),
            borderWidth: 0,
            spacing: 3,
            borderRadius: 5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "70%",
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(context) {
                const row = rows[context.dataIndex] || {};
                return ` ${context.label}: ${context.parsed} students · ${Number(row.percentage || 0).toFixed(1)}% attendance`;
              },
            },
          },
        },
      },
    });
  }

  // ------------------------------------------------------------------
  // Student table
  // ------------------------------------------------------------------
  function renderStudents() {
    if (!el.studentBody) return;
    const needle = (el.studentSearch ? el.studentSearch.value : "").trim().toLowerCase();
    let rows = ((report && report.students) || []).slice();
    if (needle) {
      rows = rows.filter((row) => `${row.name || ""} ${row.student_id || ""}`.toLowerCase().includes(needle));
    }
    rows.sort((a, b) => Number(b.percentage || 0) - Number(a.percentage || 0));

    if (el.studentSubtitle) {
      el.studentSubtitle.textContent = `${FT.formatDate(from)} – ${FT.formatDate(to)} · ${FT.isDemo() ? "demo sample" : "live records"} · sorted by attendance`;
    }

    if (!rows.length) {
      el.studentBody.innerHTML = `<tr><td colspan="8"><div class="empty-state" style="padding:28px 16px">
        <div class="empty-icon" style="width:52px;height:52px;font-size:20px"><i class="fa-solid fa-user-graduate"></i></div>
        <h4>No student records</h4>
        <p>${needle ? "No student matches this search." : "No attendance data exists for this range."}</p>
      </div></td></tr>`;
      if (el.studentFooter) el.studentFooter.textContent = "No student rows to display.";
      return;
    }

    el.studentBody.innerHTML = rows
      .map((row) => {
        const pct = Number(row.percentage || 0);
        const barClass = pct < 60 ? "bad" : pct < 75 ? "warn" : "";
        const standing =
          pct >= 75
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
                  <span class="cell-strong">${FT.escapeHtml(row.name || "Unknown")}</span>
                  <span class="cell-sub">${FT.escapeHtml(row.year || "")}${row.section ? " · Section " + FT.escapeHtml(row.section) : ""}</span>
                </div>
              </div>
            </td>
            <td><span class="student-id-badge">${FT.escapeHtml(row.student_id || "—")}</span></td>
            <td class="fs-12">${FT.escapeHtml(row.department || "—")}</td>
            <td>${Number(row.classes_held || 0)}</td>
            <td class="text-green fw-600">${Number(row.present || 0)}</td>
            <td class="text-red fw-600">${Number(row.absences != null ? row.absences : row.absent || 0)}</td>
            <td>
              <div class="percent-cell">
                <div class="percent-bar"><span class="${barClass}" style="width:${Math.min(Math.max(pct, 0), 100)}%"></span></div>
                <b>${pct.toFixed(1)}%</b>
              </div>
            </td>
            <td>${standing}</td>
          </tr>`;
      })
      .join("");

    if (el.studentFooter) {
      const average = rows.reduce((sum, row) => sum + Number(row.percentage || 0), 0) / rows.length;
      el.studentFooter.innerHTML = `Showing <strong>${rows.length}</strong> student${rows.length === 1 ? "" : "s"} · average attendance <strong>${average.toFixed(1)}%</strong>`;
    }
  }

  // ------------------------------------------------------------------
  // Load
  // ------------------------------------------------------------------
  async function load() {
    if (busy) return;
    busy = true;
    sourceBadge();
    updatePrintMeta();
    fadeTable(true);
    try {
      report = await FT.data.getReportOverview(from, to);
      renderKpis();
      renderDailyChart();
      renderWeeklyChart();
      renderMonthlyChart();
      renderDepartmentChart();
      renderStudents();
      if (!FT.isDemo() && FT.state) FT.state.lastReportLoadedAt = new Date().toISOString();
    } catch (error) {
      report = null;
      renderKpis();
      renderStudents();
      if (!el.studentBody) return;
      el.studentBody.innerHTML = `<tr><td colspan="8"><div class="empty-state" style="padding:30px 16px">
        <div class="empty-icon" style="background:#FEF3C7;color:#D97706"><i class="fa-solid fa-triangle-exclamation"></i></div>
        <h4>Report could not be loaded</h4>
        <p>${FT.escapeHtml(error.message)}</p>
        <button class="btn btn-sm btn-primary" type="button" id="reportRetry"><i class="fa-solid fa-rotate-right"></i> Try again</button>
      </div></td></tr>`;
      document.getElementById("reportRetry")?.addEventListener("click", load);
      FT.toast("error", "Analytics unavailable", error.message);
    } finally {
      fadeTable(false);
      busy = false;
    }
  }

  function fadeTable(on) {
    if (!el.studentBody) return;
    el.studentBody.style.opacity = on ? "0.45" : "1";
  }

  function rangeValid() {
    const start = FT.parseISO(from);
    const end = FT.parseISO(to);
    if (!start || !end) {
      FT.toast("warning", "Invalid dates", "Choose a valid start and end date.");
      return false;
    }
    if (start > end) {
      FT.toast("warning", "Date order", "The start date must be before the end date.");
      return false;
    }
    if (end > FT.todayISO()) {
      to = FT.todayISO();
      if (el.to) el.to.value = to;
    }
    return true;
  }

  async function applyRange() {
    from = el.from.value || FT.isoDate(FT.addDays(new Date(), -29));
    to = el.to.value || FT.todayISO();
    if (!rangeValid()) return;
    el.from.value = from;
    el.to.value = to;
    const span = Math.round((FT.parseISO(to) - FT.parseISO(from)) / 86400000) + 1;
    markPreset([7, 30, 90].includes(span) ? span : -1);
    await load();
  }

  function applyPreset(days) {
    to = FT.todayISO();
    from = FT.isoDate(FT.addDays(new Date(), -(Number(days) - 1)));
    el.from.value = from;
    el.to.value = to;
    markPreset(Number(days));
    load();
  }

  async function doExport(format, button) {
    FT.setButtonLoading(button, true, "Exporting…");
    try {
      await FT.exportAttendance({ format, from, to });
    } finally {
      FT.setButtonLoading(button, false);
    }
  }

  function printReport() {
    updatePrintMeta();
    window.print();
  }

  function wire() {
    el.apply?.addEventListener("click", applyRange);
    el.presets.forEach((button) => button.addEventListener("click", () => applyPreset(button.dataset.days)));
    el.studentSearch?.addEventListener("input", FT.debounce(renderStudents, 220));
    el.exportExcel?.addEventListener("click", () => doExport("excel", el.exportExcel));
    el.exportCsv?.addEventListener("click", () => doExport("csv", el.exportCsv));
    el.print?.addEventListener("click", printReport);
  }

  async function boot() {
    cache();
    const init = await FT.init({
      active: "reports",
      title: "Reports & Analytics",
      subtitle: "Attendance insight and downloadable reports",
    });
    if (!init) return;

    const requestedFrom = FT.queryParam("from");
    const requestedTo = FT.queryParam("to");
    if (requestedFrom && FT.parseISO(requestedFrom)) from = requestedFrom;
    if (requestedTo && FT.parseISO(requestedTo) && requestedTo <= FT.todayISO()) to = requestedTo;
    if (FT.parseISO(from) > FT.parseISO(to)) {
      from = FT.isoDate(FT.addDays(FT.parseISO(to), -29));
    }

    el.from.value = from;
    el.to.value = to;
    el.from.max = FT.todayISO();
    el.to.max = FT.todayISO();
    markPreset(30);
    sourceBadge();
    updatePrintMeta();
    wire();
    await load();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
