/* ==========================================================================
   FaceTrack - attendance.js
   Live browser camera -> Flask/OpenCV recognition -> duplicate-safe attendance.
   Demo Mode never pretends to recognise faces; it offers an explicitly
   labelled simulated scan using sample data only.
   ========================================================================== */

(function () {
  "use strict";

  let running = false;
  let scanning = false;
  let timer = null;
  let clockTimer = null;
  let feed = [];
  let summary = null;
  let lastNotice = { key: "", at: 0 };
  let startBusy = false;

  const el = {};

  function cache() {
    el.stage = document.getElementById("attendanceCameraStage");
    el.video = document.getElementById("attendanceVideo");
    el.startBtn = document.getElementById("startAttendanceBtn");
    el.stopBtn = document.getElementById("stopAttendanceBtn");
    el.scanBtn = document.getElementById("scanNowBtn");
    el.demoScanBtn = document.getElementById("demoScanBtn");
    el.demoNote = document.getElementById("attendanceDemoNote");
    el.demoScanNote = document.getElementById("demoScanNote");
    el.sessionBadge = document.getElementById("sessionBadge");
    el.camStatus = document.getElementById("attendanceCamStatus");
    el.camClock = document.getElementById("attendanceCamClock");
    el.camCaption = document.getElementById("attendanceCamCaption");
    el.result = document.getElementById("recognitionResult");
    el.liveDate = document.getElementById("liveDate");
    el.liveClock = document.getElementById("liveClock");
    el.livePresent = document.getElementById("livePresent");
    el.liveAbsent = document.getElementById("liveAbsent");
    el.livePercentage = document.getElementById("livePercentage");
    el.feed = document.getElementById("scanFeed");
    el.feedCount = document.getElementById("feedCount");
    el.source = document.getElementById("attendanceSource");
    el.intervalLabel = document.getElementById("scanIntervalLabel");
  }

  // ------------------------------------------------------------------
  // Clock / status
  // ------------------------------------------------------------------
  function updateClocks() {
    const now = new Date();
    if (el.liveClock) {
      el.liveClock.textContent = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    }
    if (el.liveDate) {
      el.liveDate.textContent = FT.formatDate(now, { long: true });
    }
    if (el.camClock) {
      el.camClock.textContent = now.toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    }
  }

  function setSessionBadge(text, tone) {
    if (!el.sessionBadge) return;
    const classes = {
      active: "badge-success",
      demo: "badge-warning",
      error: "badge-danger",
      idle: "badge-neutral",
      info: "badge-info",
    };
    const icons = {
      active: "fa-circle-check",
      demo: "fa-flask",
      error: "fa-triangle-exclamation",
      idle: "fa-circle",
      info: "fa-circle-info",
    };
    el.sessionBadge.className = `badge-soft ${classes[tone] || classes.idle}`;
    el.sessionBadge.innerHTML = `<i class="fa-solid ${icons[tone] || icons.idle}"></i> ${FT.escapeHtml(text)}`;
  }

  function setCameraStatus(text, tone) {
    if (!el.camStatus) return;
    const dot = tone === "on" ? "" : tone === "error" ? "offline" : "pending";
    el.camStatus.innerHTML = `<span class="status-dot ${dot}"></span> ${FT.escapeHtml(text)}`;
  }

  function refreshButtons() {
    if (el.startBtn) el.startBtn.disabled = running || startBusy;
    if (el.stopBtn) el.stopBtn.disabled = !running;
    if (el.scanBtn) el.scanBtn.disabled = !running || FT.isDemo() || scanning;
    if (el.demoScanBtn) el.demoScanBtn.disabled = scanning;
  }

  function setCameraCaption(text) {
    if (el.camCaption) el.camCaption.textContent = text;
  }

  // ------------------------------------------------------------------
  // Result card
  // ------------------------------------------------------------------
  function setResult(state, options = {}) {
    if (!el.result) return;
    const stateClass = state === "success" ? "success" : state === "unknown" ? "unknown" : "";
    const icons = {
      success: "fa-user-check",
      unknown: "fa-user-slash",
      error: "fa-triangle-exclamation",
      info: "fa-camera",
      idle: "fa-user-shield",
    };
    const label = options.label || "Recognition status";
    const name = options.name || "Waiting for camera";
    const sub = options.sub || "Start a session to begin automatic face recognition.";
    const score = options.score == null ? "—" : options.score;
    el.result.className = `recognition-result ${stateClass}`;
    el.result.innerHTML = `
      <div class="rr-icon"><i class="fa-solid ${icons[state] || icons.idle}"></i></div>
      <div>
        <div class="rr-label">${FT.escapeHtml(label)}</div>
        <div class="rr-name">${FT.escapeHtml(name)}</div>
        <div class="rr-sub">${FT.escapeHtml(sub)}</div>
      </div>
      <div class="rr-score"><b>${FT.escapeHtml(String(score))}</b><small>${state === "unknown" ? "closest" : "match"}</small></div>`;
  }

  // ------------------------------------------------------------------
  // Summary + feed
  // ------------------------------------------------------------------
  function applySummary(data) {
    if (!data) return;
    summary = data;
    if (el.livePresent) el.livePresent.textContent = FT.formatNumber(data.present || 0);
    if (el.liveAbsent) el.liveAbsent.textContent = FT.formatNumber(data.absent || 0);
    if (el.livePercentage) el.livePercentage.textContent = `${Number(data.percentage || 0).toFixed(1)}%`;
  }

  function flagFor(item) {
    if (item.simulated) return '<span class="scan-flag sim"><i class="fa-solid fa-flask"></i> Simulated</span>';
    if (item.already_marked) return '<span class="scan-flag dup">Already marked</span>';
    return '<span class="scan-flag">Present</span>';
  }

  function renderFeed() {
    if (!el.feed) return;
    if (!feed.length) {
      el.feed.innerHTML = `<div class="empty-state" style="padding:26px 10px;">
        <div class="empty-icon" style="width:52px;height:52px;font-size:20px;"><i class="fa-solid fa-user-clock"></i></div>
        <h4>No check-ins yet</h4>
        <p>Recognised students will appear here with their match score and punch-in time.</p>
      </div>`;
      if (el.feedCount) el.feedCount.textContent = "0";
      return;
    }
    if (el.feedCount) el.feedCount.textContent = String(feed.length);
    el.feed.innerHTML = feed
      .map(
        (item) => `
        <div class="scan-item" ${item.simulated ? 'title="Simulated demo check-in — not real face recognition"' : ""}>
          ${FT.avatarHtml(item, "", "avatar-sm")}
          <div class="scan-info">
            <div class="scan-name">${FT.escapeHtml(item.name || "Unknown")}</div>
            <div class="scan-meta">${FT.escapeHtml(item.student_id || "—")} · ${FT.formatTime(item.time)}${item.confidence != null ? ` · ${FT.confidenceLabel(item.confidence)} match` : ""}</div>
          </div>
          ${flagFor(item)}
        </div>`
      )
      .join("");
  }

  function addToFeed(record) {
    const existing = feed.find((item) => item.student_id === record.student_id);
    if (existing) {
      existing.already_marked = Boolean(record.already_marked);
      existing.time = record.time || existing.time;
      existing.confidence = record.confidence != null ? record.confidence : existing.confidence;
      renderFeed();
      return false;
    }
    feed.unshift(Object.assign({}, record));
    feed = feed.slice(0, 20);
    renderFeed();
    return true;
  }

  function notify(key, type, title, message, cooldown = 9000) {
    const now = Date.now();
    if (lastNotice.key === key && now - lastNotice.at < cooldown) return;
    lastNotice = { key, at: now };
    FT.toast(type, title, message);
  }

  async function refreshSummary() {
    try {
      const response = await FT.data.getRecognitionSummary();
      applySummary(response.summary || response);
      return response.summary || response;
    } catch (_error) {
      return null;
    }
  }

  async function loadInitialSummary() {
    try {
      const response = await FT.data.getRecognitionSummary();
      const data = response.summary || response;
      applySummary(data);
      if (Array.isArray(data.recent) && !feed.length) {
        feed = data.recent.slice(0, 20).map((row) => ({
          student_id: row.student_id,
          name: row.name,
          time: row.time,
          confidence: row.confidence,
          simulated: false,
          already_marked: false,
        }));
        renderFeed();
      }
    } catch (error) {
      FT.toast("error", "Attendance summary unavailable", error.message);
    }
  }

  // ------------------------------------------------------------------
  // Live recognition
  // ------------------------------------------------------------------
  function scanInterval() {
    const stored = Number(FT.getPrefs().scanInterval) || Number(FT.config.SCAN_INTERVAL_MS) || 2600;
    return Math.min(10000, Math.max(1500, stored));
  }

  function schedule() {
    clearInterval(timer);
    timer = setInterval(() => {
      if (!document.hidden) runScan();
    }, scanInterval());
  }

  async function runScan(manual = false) {
    if (!running || scanning || FT.isDemo()) return;
    if (!el.video || !el.video.videoWidth) {
      if (manual) FT.toast("warning", "Camera not ready", "Wait for the live preview to start.");
      return;
    }
    const frame = FT.captureFrame(el.video, 0.88, 960);
    if (!frame) return;

    scanning = true;
    refreshButtons();
    setCameraStatus("Scanning face…", "on");
    try {
      const response = await FT.data.recognizeFrame(frame);
      handleRecognition(response);
    } catch (error) {
      handleRecognitionError(error);
    } finally {
      scanning = false;
      if (running) {
        setCameraStatus("Scanning live", "on");
        refreshButtons();
      }
    }
  }

  function handleRecognition(response) {
    const faces = response.faces || [];
    if (response.summary) applySummary(response.summary);

    if (!response.face_detected) {
      setCameraStatus("No face in frame", "pending");
      setResult("idle", {
        label: "Scanning · no face",
        name: "No face detected",
        sub: "Make sure exactly one student is visible and well lit.",
        score: "—",
      });
      return;
    }

    const primary = response.primary || faces.find((item) => item.recognized) || faces[0];
    if (!primary) {
      setResult("unknown", { label: "Unknown", name: "No recognisable face", sub: "Attendance was not marked.", score: "—" });
      return;
    }

    if (primary.recognized) {
      const status = primary.already_marked ? "already marked" : "newly marked";
      setResult("success", {
        label: primary.already_marked ? "Recognised · duplicate prevented" : "Recognised · attendance marked",
        name: primary.name,
        sub: `${primary.student_id} · ${primary.department || ""} · ${FT.formatTime(primary.punch_time)}${primary.already_marked ? " · already present today" : ""}${faces.length > 1 ? ` · ${faces.length} faces in frame` : ""}`,
        score: FT.confidenceLabel(primary.confidence),
      });
      setCameraStatus(`Recognised · ${status}`, "on");

      const isNew = addToFeed({
        student_id: primary.student_id,
        name: primary.name,
        time: primary.punch_time || FT.nowTime(),
        confidence: primary.confidence,
        simulated: false,
        already_marked: primary.already_marked,
      });

      if (primary.already_marked) {
        notify(
          `duplicate-${primary.student_id}`,
          "info",
          "Already marked today",
          `${primary.name} was recognised, but today's attendance already exists. No duplicate was created.`
        );
      } else if (isNew) {
        notify(
          `marked-${primary.student_id}`,
          "success",
          "Attendance marked",
          `${primary.name} (${primary.student_id}) · ${FT.confidenceLabel(primary.confidence)} match.`
        );
      }
      if (response.summary) renderFeed();
    } else {
      setResult("unknown", {
        label: "Unknown face — not marked",
        name: "Recognition below threshold",
        sub: `OpenCV did not match this face confidently${faces.length > 1 ? ` (${faces.length} faces in frame)` : ""}. No attendance was recorded.`,
        score: primary.confidence != null ? FT.confidenceLabel(primary.confidence) : "—",
      });
      setCameraStatus("Unknown face", "pending");
      notify("unknown-face", "warning", "Unknown face", "No match above the confidence threshold. Attendance was not marked.");
    }
    setCameraCaption(faces.length > 1 ? `${faces.length} faces detected · process one student at a time` : "Face the camera · one face at a time");
  }

  function handleRecognitionError(error) {
    setResult("error", {
      label: "Recognition unavailable",
      name: "The scan could not be completed",
      sub: error.message,
      score: "—",
    });
    setCameraStatus("Recognition error", "error");
    FT.toast("error", "Recognition error", error.message);
    if (["MODEL_NOT_TRAINED", "SESSION_NOT_ACTIVE", "ENGINE_UNAVAILABLE", "UNAUTHORIZED"].includes(error.code)) {
      stopEverything(false);
      setSessionBadge("Session stopped", "error");
    }
  }

  async function startLiveAttendance() {
    if (startBusy || running) return;
    startBusy = true;
    refreshButtons();
    FT.setButtonLoading(el.startBtn, true, "Starting…");
    try {
      await FT.data.startRecognition();
      try {
        await FT.startCamera(el.video, FT.getPrefs().cameraDevice);
      } catch (cameraError) {
        await FT.data.stopRecognition().catch(() => {});
        throw cameraError;
      }
      running = true;
      el.stage.classList.add("is-active", "is-scanning");
      setSessionBadge("Session active · scanning", "active");
      setCameraStatus("Scanning live", "on");
      setResult("info", {
        label: "Session started",
        name: "Looking for registered faces",
        sub: "Recognition runs automatically. Only a recognised student is marked present.",
        score: "—",
      });
      FT.toast("success", "Recognition started", "Face frames are being sent to the Flask/OpenCV backend.");
      schedule();
      setTimeout(() => runScan(true), 1200);
    } catch (error) {
      running = false;
      el.stage.classList.remove("is-active", "is-scanning");
      setSessionBadge("Session inactive", "idle");
      setCameraStatus("Camera off", "idle");
      setResult("error", { label: "Could not start", name: "Attendance session not started", sub: error.message, score: "—" });
      FT.toast("error", "Could not start attendance", error.message);
    } finally {
      startBusy = false;
      FT.setButtonLoading(el.startBtn, false);
      refreshButtons();
    }
  }

  async function startDemoPreview() {
    if (running) return;
    startBusy = true;
    refreshButtons();
    FT.setButtonLoading(el.startBtn, true, "Opening camera…");
    try {
      await FT.startCamera(el.video, FT.getPrefs().cameraDevice);
      running = true;
      el.stage.classList.add("is-active");
      setSessionBadge("Demo preview (no recognition)", "demo");
      setCameraStatus("Preview only · demo", "pending");
      setResult("info", {
        label: "Demo Mode preview",
        name: "No recognition is running",
        sub: "Use the clearly labelled Simulated Scan button to preview how attendance appears. Nothing is sent to a server.",
        score: "—",
      });
      setCameraCaption("Demo preview · face recognition disabled");
      FT.toast("info", "Camera preview started", "Demo Mode does not perform face recognition.");
    } catch (error) {
      FT.toast("error", "Camera could not start", error.message);
    } finally {
      startBusy = false;
      FT.setButtonLoading(el.startBtn, false);
      refreshButtons();
    }
  }

  function stopEverything(callApi = true) {
    running = false;
    clearInterval(timer);
    timer = null;
    FT.stopCamera();
    el.stage.classList.remove("is-active", "is-scanning");
    setCameraStatus("Camera off", "idle");
    setCameraCaption("Face the camera · one face at a time");
    setSessionBadge(FT.isDemo() ? "Demo preview off" : "Session inactive", "idle");
    setResult("idle", {
      label: "Session stopped",
      name: "Recognition paused",
      sub: "Start the camera again to continue taking attendance.",
      score: "—",
    });
    refreshButtons();
    if (callApi && !FT.isDemo()) {
      FT.data.stopRecognition().catch(() => {});
    }
  }

  async function stopByButton() {
    if (!running) return;
    if (FT.isDemo()) {
      stopEverything(false);
      FT.toast("info", "Preview stopped", "Demo Mode did not record any attendance.");
      return;
    }
    FT.setButtonLoading(el.stopBtn, true, "Stopping…");
    const sessionSummary = summary;
    stopEverything(true);
    FT.setButtonLoading(el.stopBtn, false);
    refreshButtons();
    if (sessionSummary) {
      FT.toast("info", "Session stopped", `${sessionSummary.present || 0} present today · ${sessionSummary.absent || 0} absent.`);
    }
  }

  async function simulatedScan() {
    if (!FT.isDemo()) return;
    if (scanning) return;
    scanning = true;
    refreshButtons();
    try {
      const result = FT.demo.simulateScan();
      if (!result.success) {
        FT.toast("warning", "Simulation not possible", result.error);
        return;
      }
      addToFeed({
        student_id: result.student_id,
        name: result.name,
        time: result.attendance ? result.attendance.time : FT.nowTime(),
        confidence: result.confidence,
        simulated: true,
        already_marked: Boolean(result.already_marked),
      });
      await refreshSummary();
      setResult("success", {
        label: "SIMULATED check-in · demo only",
        name: result.name,
        sub: `${result.student_id} · ${FT.formatTime(result.attendance ? result.attendance.time : FT.nowTime())} · this is sample data, not real face recognition.`,
        score: FT.confidenceLabel(result.confidence),
      });
      FT.toast("warning", "Simulated attendance (demo)", `${result.name} was added to the local demo dataset only — no real attendance was recorded.`);
    } finally {
      scanning = false;
      refreshButtons();
    }
  }

  // ------------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------------
  function wire() {
    el.startBtn?.addEventListener("click", () => (FT.isDemo() ? startDemoPreview() : startLiveAttendance()));
    el.stopBtn?.addEventListener("click", stopByButton);
    el.scanBtn?.addEventListener("click", () => runScan(true));
    el.demoScanBtn?.addEventListener("click", simulatedScan);
    window.addEventListener("beforeunload", () => {
      clearInterval(timer);
      FT.stopCamera();
      if (running && !FT.isDemo()) FT.data.stopRecognition().catch(() => {});
    });
  }

  async function boot() {
    cache();
    const init = await FT.init({
      active: "attendance",
      title: "Take Attendance",
      subtitle: "Live face recognition and duplicate-safe check-ins",
    });
    if (!init) return;

    if (el.intervalLabel) el.intervalLabel.textContent = `${(scanInterval() / 1000).toFixed(1)}s`;
    updateClocks();
    clearInterval(clockTimer);
    clockTimer = setInterval(updateClocks, 1000);
    wire();

    if (FT.isDemo()) {
      if (el.demoNote) el.demoNote.style.display = "flex";
      if (el.demoScanNote) el.demoScanNote.style.display = "flex";
      if (el.demoScanBtn) el.demoScanBtn.style.display = "inline-flex";
      if (el.scanBtn) el.scanBtn.style.display = "none";
      if (el.source) el.source.textContent = "Demo data · sample";
      setSessionBadge("Demo preview off", "demo");
      setResult("idle", {
        label: "Demo Mode",
        name: "Real recognition is disabled",
        sub: "The Flask + OpenCV backend is not being used. You may start the camera preview or run an explicitly labelled simulated scan.",
        score: "—",
      });
      setCameraStatus("Preview only · demo", "pending");
    } else {
      if (el.source) el.source.textContent = "Live API · OpenCV";
      setSessionBadge("Session inactive", "idle");
      if (el.demoScanBtn) el.demoScanBtn.style.display = "none";
      if (el.demoNote) el.demoNote.style.display = "none";
    }
    refreshButtons();
    renderFeed();
    await loadInitialSummary();
    refreshButtons();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
