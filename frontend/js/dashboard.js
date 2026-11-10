/* ==========================================================================
   FaceTrack - dashboard.js
   Loads dashboard statistics and renders Chart.js visualisations.
   ========================================================================== */

(function () {
  "use strict";

  let weeklyChart = null;
  let monthlyChart = null;
  let summaryChart = null;

  function setStat(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  function presentation() {
    return {
      weekly: null,
      monthly: null,
      summary: null,
    };
  }

  const charts = presentation();

  function renderWeekly(data) {
    const canvas = document.getElementById("weeklyChart");
    if (!canvas || !window.Chart) return;
    if (charts.weekly) charts.weekly.destroy();

    const labels = data.map((row) => row.label);
    const present = data.map((row) => row.present);
    const absent = data.map((row) => row.absent);

    charts.weekly = new Chart(canvas.getContext("2d"), {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Present",
            data: present,
            backgroundColor: "#2563EB",
            hoverBackgroundColor: "#1D4ED8",
            borderRadius: 7,
            borderSkipped: false,
            maxBarThickness: 26,
            barPercentage: 0.68,
            categoryPercentage: 0.62,
          },
          {
            label: "Absent",
            data: absent,
            backgroundColor: "#E7EDF7",
            hoverBackgroundColor: "#CBD5E1",
            borderRadius: 7,
            borderSkipped: false,
            maxBarThickness: 26,
            barPercentage: 0.68,
            categoryPercentage: 0.62,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            position: "top",
            align: "end",
            labels: { boxWidth: 7, boxHeight: 7, usePointStyle: true, pointStyle: "circle", padding: 16 },
          },
          tooltip: {
            callbacks: {
              label(context) {
                return ` ${context.dataset.label}: ${context.parsed.y} students`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { font: { size: 10 }, color: "#94A3B8" },
          },
          y: {
            beginAtZero: true,
            grid: { color: "rgba(148, 163, 184, 0.12)", drawTicks: false },
            border: { display: false, dash: [4, 4] },
            ticks: { stepSize: 3, font: { size: 9.5 }, color: "#94A3B8", padding: 8 },
          },
        },
      },
    });
  }

  function renderMonthly(data) {
    const canvas = document.getElementById("monthlyChart");
    if (!canvas || !window.Chart) return;
    if (charts.monthly) charts.monthly.destroy();

    const context = canvas.getContext("2d");
    const gradient = context.createLinearGradient(0, 0, 0, 260);
    gradient.addColorStop(0, "rgba(37, 99, 235, 0.22)");
    gradient.addColorStop(1, "rgba(37, 99, 235, 0.01)");

    charts.monthly = new Chart(context, {
      type: "line",
      data: {
        labels: data.map((row) => row.month),
        datasets: [
          {
            label: "Attendance %",
            data: data.map((row) => row.percentage),
            borderColor: "#2563EB",
            backgroundColor: gradient,
            fill: true,
            tension: 0.4,
            borderWidth: 2.5,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHoverBackgroundColor: "#2563EB",
            pointHoverBorderColor: "#fff",
            pointHoverBorderWidth: 3,
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
              label(context) {
                return ` Attendance: ${context.parsed.y}%`;
              },
              afterLabel(context) {
                const row = data[context.dataIndex];
                return row ? `${row.present} check-ins · ${row.classes} class days` : "";
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { font: { size: 10 }, color: "#94A3B8" },
          },
          y: {
            min: 0,
            max: 100,
            grid: { color: "rgba(148, 163, 184, 0.12)", drawTicks: false },
            border: { display: false },
            ticks: {
              stepSize: 25,
              font: { size: 9.5 },
              color: "#94A3B8",
              padding: 8,
              callback: (value) => `${value}%`,
            },
          },
        },
      },
    });
  }

  function renderSummary(present, absent) {
    const canvas = document.getElementById("summaryChart");
    const stats = window.FT.state;
    if (!canvas || !window.Chart) return;
    if (charts.summary) charts.summary.destroy();

    if (!present && !absent) {
      charts.summary = new Chart(canvas.getContext("2d"), {
        type: "doughnut",
        data: { labels: ["No data"], datasets: [{ data: [1], backgroundColor: ["#E2E8F0"], borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: "76%", plugins: { legend: { display: false }, tooltip: { enabled: false } } },
      });
      return;
    }

    charts.summary = new Chart(canvas.getContext("2d"), {
      type: "doughnut",
      data: {
        labels: ["Present", "Absent"],
        datasets: [
          {
            data: [present, absent],
            backgroundColor: ["#16A34A", "#E7EDF7"],
            hoverBackgroundColor: ["#15803D", "#CBD5E1"],
            borderWidth: 0,
            spacing: 3,
            borderRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "76%",
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label(context) {
                const total = present + absent;
                const pct = total ? Math.round((context.parsed / total) * 100) : 0;
                return ` ${context.label}: ${context.parsed} (${pct}%)`;
              },
            },
          },
        },
      },
    });
    if (stats) stats.chartsReady = true;
  }

  function renderRecent(rows) {
    const body = document.getElementById("recentTableBody");
    if (!body) return;
    if (!rows || !rows.length) {
      body.innerHTML = `<tr><td colspan="6"><div class="empty-state" style="padding:28px 16px">
        <div class="empty-icon" style="width:52px;height:52px;font-size:20px"><i class="fa-solid fa-calendar-xmark"></i></div>
        <h4>No attendance recorded yet</h4>
        <p>Start a recognition session or add a manual record to see it here.</p>
        <a href="attendance.html" class="btn btn-sm btn-primary"><i class="fa-solid fa-camera"></i> Take attendance</a>
      </div></td></tr>`;
      return;
    }
    body.innerHTML = rows
      .map(
        (row) => `
        <tr>
          <td>
            <div class="student-cell">
              ${FT.avatarHtml(row, "", "avatar-sm")}
              <div>
                <span class="cell-strong">${FT.escapeHtml(row.name || "Unknown")}</span>
                <span class="cell-sub">${FT.escapeHtml(row.year || "")} ${row.section ? "· Section " + FT.escapeHtml(row.section) : ""}</span>
              </div>
            </div>
          </td>
          <td><span class="student-id-badge">${FT.escapeHtml(row.student_id)}</span></td>
          <td class="fs-12">${FT.escapeHtml(row.department || "—")}</td>
          <td><span class="punch-time"><i class="fa-regular fa-clock"></i>${FT.formatTime(row.time)}</span></td>
          <td><span class="badge-soft ${Number(row.confidence) >= 80 ? "badge-info" : "badge-neutral"}">${FT.confidenceLabel(row.confidence)}</span></td>
          <td>${FT.statusBadge(row.status || "Present")}</td>
        </tr>`
      )
      .join("");
  }

  function renderFailure(message) {
    const body = document.getElementById("recentTableBody");
    if (body) {
      body.innerHTML = `<tr><td colspan="6"><div class="empty-state" style="padding:28px 16px">
        <div class="empty-icon" style="width:52px;height:52px;font-size:20px;background:#FEF3C7;color:#D97706"><i class="fa-solid fa-triangle-exclamation"></i></div>
        <h4>Dashboard data could not be loaded</h4>
        <p>${FT.escapeHtml(message)}</p>
        <button class="btn btn-sm btn-primary" id="dashboardRetry" type="button"><i class="fa-solid fa-rotate"></i> Try again</button>
      </div></td></tr>`;
      document.getElementById("dashboardRetry")?.addEventListener("click", () => window.location.reload());
    }
  }

  async function loadDashboard() {
    const init = await FT.init({
      active: "dashboard",
      title: "Dashboard",
      subtitle: "Overview of your attendance workspace",
    });
    if (!init) return;
    const admin = init.admin;
    const firstName = (admin.name || "Admin").split(" ").slice(-1)[0] || "Admin";
    const greetingElement = document.getElementById("greeting");
    const firstNameElement = document.getElementById("adminFirstName");
    if (greetingElement) greetingElement.textContent = FT.greeting();
    if (firstNameElement) firstNameElement.textContent = firstName;
    const heroDate = document.getElementById("heroDate");
    if (heroDate) heroDate.textContent = FT.formatDate(new Date(), { long: true });

    try {
      const payload = await FT.data.getDashboard();
      const stats = payload.stats || payload;
      const weekly = payload.weekly || stats.weekly || [];
      const monthly = payload.monthly || stats.monthly || [];
      const recent = payload.recent || stats.recent || [];

      const total = Number(stats.total_students || 0);
      const present = Number(stats.present_today || 0);
      const absent = Number(stats.absent_today || 0);
      const pct = Number(stats.attendance_percentage || 0);

      setStat("statTotalStudents", FT.formatNumber(total));
      setStat("statFaceRegistered", FT.formatNumber(stats.face_registered || 0));
      setStat("statPresentToday", FT.formatNumber(present));
      setStat("statAbsentToday", FT.formatNumber(absent));
      setStat("statAttendancePct", `${pct.toFixed(1)}%`);
      setStat("heroPresent", FT.formatNumber(present));
      setStat("heroTotal", FT.formatNumber(total));
      setStat("legendPresent", FT.formatNumber(present));
      setStat("legendAbsent", FT.formatNumber(absent));
      setStat("donutPct", `${Math.round(pct)}%`);
      setStat("legendPresentPct", `${Math.round(pct)}%`);
      setStat("legendAbsentPct", `${total ? Math.round((absent / total) * 100) : 0}%`);
      setStat("statUpdated", new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }));

      const presentProgress = document.getElementById("presentProgress");
      const absentProgress = document.getElementById("absentProgress");
      if (presentProgress) presentProgress.style.width = `${Math.min(pct, 100)}%`;
      if (absentProgress) absentProgress.style.width = `${total ? Math.min((absent / total) * 100, 100) : 0}%`;

      const delta = pct - Number(stats.yesterday_percentage || 0);
      const pctTrend = document.getElementById("pctTrend");
      if (pctTrend) {
        const up = delta >= 0;
        pctTrend.className = `stat-trend ${up ? "up" : "down"}`;
        pctTrend.innerHTML = `<i class="fa-solid fa-arrow-${up ? "up" : "down"}"></i> ${Math.abs(delta).toFixed(1)}% vs yesterday`;
      }
      const presentTrend = document.getElementById("presentTrend");
      if (presentTrend) presentTrend.innerHTML = `<i class="fa-solid fa-arrow-up"></i> ${pct.toFixed(1)}% rate`;
      const studentsTrend = document.getElementById("studentsTrend");
      if (studentsTrend) studentsTrend.innerHTML = `<i class="fa-solid fa-graduation-cap"></i> ${FT.formatNumber(stats.face_registered || 0)} verified`;

      const absentTrend = document.getElementById("absentTrend");
      if (absentTrend) {
        const absentPct = total ? Math.round((absent / total) * 100) : 0;
        const absentYesterdayPct = total ? Math.round(((total - Number(stats.present_yesterday || 0)) / total) * 100) : 0;
        const absentDelta = absentPct - absentYesterdayPct;
        const absentUp = absentDelta >= 0;
        absentTrend.className = `stat-trend ${absentUp ? "up" : "down"}`;
        absentTrend.innerHTML = `<i class="fa-solid fa-arrow-${absentUp ? "up" : "down"}"></i> ${Math.abs(absentDelta).toFixed(1)}% vs yesterday`;
      }

      renderWeekly(weekly);
      renderMonthly(monthly);
      renderSummary(present, absent);
      renderRecent(recent);
    } catch (error) {
      renderFailure(error.message);
      FT.toast("error", "Dashboard unavailable", error.message);
    }
  }

  document.addEventListener("DOMContentLoaded", loadDashboard);
})();
