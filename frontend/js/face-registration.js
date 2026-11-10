/* ==========================================================================
   FaceTrack - face-registration.js
   Webcam capture + OpenCV-validated face samples.
   No sample is saved unless the backend detects exactly one face.
   Demo Mode cannot validate or store biometric data.
   ========================================================================== */

(function () {
  "use strict";

  const MAX_SAMPLES = Number(FT.config.MAX_FACE_SAMPLES) || 5;
  let students = [];
  let selectedId = "";
  let samples = [];
  let engineReady = false;
  let engineInfo = null;
  let modelInfo = null;
  let cameraOn = false;
  let captureBusy = false;
  let registering = false;
  let clockTimer = null;

  const el = {};

  function cache() {
    el.select = document.getElementById("faceStudentSelect");
    el.studentCount = document.getElementById("studentCountBadge");
    el.selectedCard = document.getElementById("selectedStudentCard");
    el.modeNote = document.getElementById("registrationModeNote");
    el.engineBadge = document.getElementById("engineBadge");
    el.stage = document.getElementById("faceCameraStage");
    el.video = document.getElementById("faceVideo");
    el.camStatus = document.getElementById("faceCamStatus");
    el.camClock = document.getElementById("faceCamClock");
    el.startBtn = document.getElementById("startFaceCamera");
    el.stopBtn = document.getElementById("stopFaceCamera");
    el.captureBtn = document.getElementById("captureFaceBtn");
    el.samplesGrid = document.getElementById("faceSamplesGrid");
    el.capturedCount = document.getElementById("capturedCountBadge");
    el.progressBar = document.getElementById("sampleProgressBar");
    el.progressLabel = document.getElementById("sampleProgressLabel");
    el.registerBtn = document.getElementById("registerFaceBtn");
    el.clearBtn = document.getElementById("clearSamplesBtn");
    el.result = document.getElementById("registrationResult");
    el.modelStatus = document.getElementById("modelStatusText");
    el.privacy = document.getElementById("facePrivacyNote");
  }

  // ------------------------------------------------------------------
  // UI helpers
  // ------------------------------------------------------------------
  function setCameraStatus(text, tone) {
    if (!el.camStatus) return;
    const dotClass = tone === "on" ? "" : tone === "error" ? "offline" : "pending";
    el.camStatus.innerHTML = `<span class="status-dot ${dotClass}"></span> ${FT.escapeHtml(text)}`;
  }

  function setEngineBadge() {
    if (!el.engineBadge) return;
    if (FT.isDemo()) {
      el.engineBadge.className = "badge-soft badge-warning";
      el.engineBadge.innerHTML = '<i class="fa-solid fa-flask"></i> Demo mode';
      return;
    }
    if (engineReady) {
      el.engineBadge.className = "badge-soft badge-success";
      el.engineBadge.innerHTML = '<i class="fa-solid fa-circle-check"></i> Engine ready';
    } else {
      el.engineBadge.className = "badge-soft badge-danger";
      el.engineBadge.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Engine unavailable';
    }
  }

  function setModeNote() {
    if (!el.modeNote) return;
    if (FT.isDemo()) {
      el.modeNote.className = "face-status-box warn mt-3";
      el.modeNote.innerHTML = `<i class="fa-solid fa-flask"></i><div><strong>Demo Mode.</strong> You can preview the webcam, but capture and registration are disabled because they require OpenCV face validation on the Flask backend. No biometric data will be saved.</div>`;
      return;
    }
    if (!engineReady) {
      el.modeNote.className = "face-status-box warn mt-3";
      el.modeNote.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i><div><strong>OpenCV face engine unavailable.</strong> Install it with <code>pip install opencv-contrib-python</code> and restart <code>python app.py</code>.</div>`;
      return;
    }
    el.modeNote.className = "face-status-box good mt-3";
    el.modeNote.innerHTML = `<i class="fa-solid fa-shield-halved"></i><div><strong>Face engine ready.</strong> Every capture is checked by OpenCV and only a single, valid face is saved.</div>`;
  }

  function updateModelStatus() {
    if (!el.modelStatus) return;
    if (FT.isDemo()) {
      el.modelStatus.textContent = "Demo mode · model not connected";
      return;
    }
    if (!modelInfo) {
      el.modelStatus.textContent = "Model status unavailable";
      return;
    }
    if (modelInfo.trained_at) {
      el.modelStatus.innerHTML = `<i class="fa-solid fa-microchip me-1 text-primary-ft"></i>Model: ${modelInfo.students || 0} students · ${modelInfo.samples || 0} samples`;
    } else {
      el.modelStatus.textContent = "Model not trained yet";
    }
  }

  function refreshButtons() {
    if (!el.captureBtn) return;
    const canCapture = cameraOn && !FT.isDemo() && engineReady && samples.length < MAX_SAMPLES && !captureBusy && !registering;
    el.captureBtn.disabled = !canCapture;
    el.captureBtn.title = FT.isDemo()
      ? "Face validation requires the Flask backend"
      : !engineReady
      ? "OpenCV face engine unavailable"
      : samples.length >= MAX_SAMPLES
      ? "Maximum samples captured"
      : "Capture a validated face sample";
    if (el.startBtn) el.startBtn.disabled = cameraOn || registering;
    if (el.stopBtn) el.stopBtn.disabled = !cameraOn;
    if (el.registerBtn) el.registerBtn.disabled = !samples.length || registering || FT.isDemo();
    if (el.clearBtn) el.clearBtn.disabled = !samples.length || registering;
  }

  function showResult(type, title, message) {
    if (!el.result) return;
    const icon = type === "success" ? "fa-circle-check" : type === "error" ? "fa-circle-xmark" : "fa-circle-info";
    const boxClass = type === "success" ? "good" : type === "error" ? "warn" : "info";
    el.result.innerHTML = `<div class="face-status-box ${boxClass}"><i class="fa-solid ${icon}"></i><div><strong>${FT.escapeHtml(title)}</strong><br>${message}</div></div>`;
  }

  function renderSamples() {
    if (!el.samplesGrid) return;
    const thumbs = samples
      .map(
        (sample, index) => `
        <div class="sample-thumb">
          <img src="${sample.data}" alt="Validated face sample ${index + 1}">
          <span class="sample-index">#${index + 1}</span>
          <button class="sample-remove" type="button" data-remove="${index}" title="Remove sample" aria-label="Remove sample ${index + 1}"><i class="fa-solid fa-xmark"></i></button>
        </div>`
      )
      .join("");
    const placeholders = Array.from({ length: Math.max(0, MAX_SAMPLES - samples.length) })
      .map(() => `<div class="sample-placeholder"><i class="fa-regular fa-image"></i><span>Empty</span></div>`)
      .join("");
    el.samplesGrid.innerHTML = thumbs + placeholders;
    el.capturedCount.textContent = `${samples.length} / ${MAX_SAMPLES} captured`;
    const pct = Math.round((samples.length / MAX_SAMPLES) * 100);
    el.progressBar.style.width = `${pct}%`;
    el.progressBar.setAttribute("aria-valuenow", String(pct));
    el.progressLabel.textContent = `${pct}%`;
    refreshButtons();
  }

  function renderSelectedCard(status) {
    const student = students.find((item) => item.student_id === selectedId);
    if (!student) {
      el.selectedCard.innerHTML = `<div class="face-status-box info"><i class="fa-solid fa-circle-info"></i><div>Select a student to view their face registration status and begin capturing samples.</div></div>`;
      return;
    }
    const registered = status ? status.face_registered : student.face_registered;
    const sampleCount = status ? status.count : student.face_samples || 0;
    const badge = registered
      ? '<span class="badge-soft badge-success"><i class="fa-solid fa-circle-check"></i> Face registered</span>'
      : '<span class="badge-soft badge-warning"><i class="fa-solid fa-triangle-exclamation"></i> Not registered</span>';
    el.selectedCard.innerHTML = `
      <div class="d-flex align-items-center gap-3 mb-2">
        ${FT.avatarHtml(student, "", "avatar-lg")}
        <div class="min-w-0">
          <div class="cell-strong" style="font-size:14px;">${FT.escapeHtml(student.name)}</div>
          <div class="student-id-badge mt-1">${FT.escapeHtml(student.student_id)}</div>
        </div>
        <div class="ms-auto">${badge}</div>
      </div>
      <div class="detail-row"><span>Department</span><span>${FT.escapeHtml(student.department)}</span></div>
      <div class="detail-row"><span>Year / Section</span><span>${FT.escapeHtml(student.year)} · ${FT.escapeHtml(student.section || "A")}</span></div>
      <div class="detail-row"><span>Enrolled samples</span><span>${sampleCount} sample${sampleCount === 1 ? "" : "s"}</span></div>
      <div class="face-status-box ${registered ? "good" : "info"} mt-3">
        <i class="fa-solid ${registered ? "fa-shield-halved" : "fa-camera"}"></i>
        <div>${registered
          ? "A biometric profile exists. Capture more samples to improve recognition robustness."
          : "This student cannot be recognised until at least one valid face sample is registered."}</div>
      </div>`;
  }

  function clearSamples(resetResult = true) {
    samples = [];
    renderSamples();
    if (resetResult && el.result) el.result.innerHTML = "";
  }

  // ------------------------------------------------------------------
  // Students
  // ------------------------------------------------------------------
  async function loadStudents() {
    try {
      const response = await FT.data.getStudents({});
      students = response.students || [];
      if (el.studentCount) el.studentCount.textContent = `${students.length} students`;
      if (!students.length) {
        el.select.innerHTML = '<option value="">No students available</option>';
        el.selectedCard.innerHTML = `<div class="empty-state" style="padding:20px 10px"><div class="empty-icon" style="width:52px;height:52px;font-size:20px"><i class="fa-solid fa-user-plus"></i></div><h4>Add a student first</h4><p>Face registration needs a student profile.</p><a href="students.html#add" class="btn btn-sm btn-primary">Add Student</a></div>`;
        return;
      }
      el.select.innerHTML =
        '<option value="">Select a student…</option>' +
        students
          .map(
            (student) =>
              `<option value="${FT.escapeHtml(student.student_id)}">${FT.escapeHtml(student.name)} · ${FT.escapeHtml(student.student_id)}${student.face_registered ? " ✓" : ""}</option>`
          )
          .join("");

      const requested = FT.queryParam("student");
      const initial = students.find((student) => student.student_id === requested) || students[0];
      el.select.value = initial.student_id;
      await selectStudent(initial.student_id);
    } catch (error) {
      el.select.innerHTML = '<option value="">Could not load students</option>';
      FT.toast("error", "Students unavailable", error.message);
    }
  }

  async function selectStudent(studentId) {
    selectedId = studentId;
    clearSamples();
    if (!studentId) {
      renderSelectedCard(null);
      return;
    }
    renderSelectedCard(null);
    try {
      const status = await FT.data.getFaceStatus(studentId);
      renderSelectedCard(status);
    } catch (error) {
      FT.toast("warning", "Face status unavailable", error.message);
    }
  }

  // ------------------------------------------------------------------
  // Camera
  // ------------------------------------------------------------------
  async function startCamera() {
    try {
      await FT.startCamera(el.video, FT.getPrefs().cameraDevice);
      cameraOn = true;
      el.stage.classList.add("is-active", "is-scanning");
      setCameraStatus("Camera on · scanning", "on");
      updateClock();
      clearInterval(clockTimer);
      clockTimer = setInterval(updateClock, 1000);
      refreshButtons();
      if (FT.isDemo()) {
        showResult("info", "Demo preview active", "The camera preview is real, but face validation and registration are disabled in Demo Mode.");
      } else if (!engineReady) {
        showResult("error", "Engine unavailable", "The camera preview is running, but OpenCV recognition is unavailable. Install opencv-contrib-python and restart Flask.");
      } else {
        showResult("info", "Camera ready", "Position one face inside the guide, then capture 3–5 samples.");
      }
    } catch (error) {
      setCameraStatus("Camera error", "error");
      FT.toast("error", "Camera could not start", error.message);
    }
  }

  function stopCamera() {
    FT.stopCamera();
    cameraOn = false;
    el.stage.classList.remove("is-active", "is-scanning");
    setCameraStatus("Camera off", "off");
    clearInterval(clockTimer);
    if (el.camClock) el.camClock.textContent = "—";
    refreshButtons();
  }

  function updateClock() {
    if (el.camClock) {
      el.camClock.textContent = new Date().toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    }
  }

  async function captureSample() {
    if (FT.isDemo()) {
      FT.toast("warning", "Demo Mode", "Face validation requires the Flask + OpenCV backend. No sample was captured.");
      showResult("info", "Demo Mode — capture disabled", "Samples are only accepted when the backend detects exactly one valid face. Demo Mode cannot perform that validation, so nothing is saved.");
      return;
    }
    if (!engineReady) {
      FT.toast("error", "Face engine unavailable", "Install opencv-contrib-python and restart the backend.");
      return;
    }
    if (!selectedId) {
      FT.toast("warning", "Select a student", "Choose the student whose face you are registering first.");
      return;
    }
    if (!cameraOn) {
      FT.toast("warning", "Camera is off", "Start the camera before capturing a sample.");
      return;
    }
    if (samples.length >= MAX_SAMPLES) {
      FT.toast("info", "Sample limit reached", `You already captured ${MAX_SAMPLES} samples. Register or clear them.`);
      return;
    }

    const dataUrl = FT.captureFrame(el.video, 0.9, 900);
    if (!dataUrl) {
      FT.toast("error", "Frame not ready", "Wait a moment for the camera preview to start, then try again.");
      return;
    }

    captureBusy = true;
    FT.setButtonLoading(el.captureBtn, true, "Validating face…");
    refreshButtons();
    try {
      const validated = await FT.data.validateFace(dataUrl);
      samples.push({ data: dataUrl, face: validated.face });
      renderSamples();
      showResult("success", "Valid face detected", `Sample ${samples.length} of ${MAX_SAMPLES} accepted. ${samples.length >= 3 ? "You can register now or add more samples." : "Capture at least 3 samples for a better model."}`);
      FT.toast("success", "Sample captured", `OpenCV validated exactly one face (${samples.length}/${MAX_SAMPLES}).`);
    } catch (error) {
      const code = error.code;
      const message = code === "MULTIPLE_FACES"
        ? "Multiple faces were detected. Only the selected student should be in frame."
        : code === "NO_FACE"
        ? "No face was detected. Improve lighting and look directly at the camera."
        : error.message;
      showResult("error", "Sample rejected", FT.escapeHtml(message));
      FT.toast("error", "Face not accepted", message);
    } finally {
      captureBusy = false;
      FT.setButtonLoading(el.captureBtn, false);
      refreshButtons();
    }
  }

  // ------------------------------------------------------------------
  // Register samples
  // ------------------------------------------------------------------
  async function registerSamples() {
    if (FT.isDemo()) {
      showResult("info", "Registration unavailable in Demo Mode", "Start the Flask backend to save real, validated face samples. No claim of success is made here.");
      FT.toast("warning", "Demo Mode", "Face registration needs the Flask backend.");
      return;
    }
    if (!selectedId) {
      FT.toast("warning", "Select a student", "Choose a student before registering a face.");
      return;
    }
    if (!samples.length) {
      FT.toast("warning", "No samples", "Capture at least one validated face sample first.");
      return;
    }
    const student = students.find((item) => item.student_id === selectedId);
    registering = true;
    FT.setButtonLoading(el.registerBtn, true, "Registering…");
    refreshButtons();

    let accepted = 0;
    let trainingFailed = false;
    const failures = [];
    try {
      for (let index = 0; index < samples.length; index += 1) {
        if (el.result) {
          el.result.innerHTML = `<div class="face-status-box info"><i class="fa-solid fa-circle-notch fa-spin"></i><div><strong>Registering sample ${index + 1} of ${samples.length}…</strong><br>The backend is validating the face and updating the LBPH model.</div></div>`;
        }
        try {
          const response = await FT.data.registerFace(selectedId, samples[index].data, false);
          if (response && response.success) {
            accepted += 1;
            if (response.trained === false) trainingFailed = true;
          }
        } catch (error) {
          failures.push(error.message);
        }
      }

      if (accepted > 0) {
        let retrained = true;
        try {
          const trained = await FT.data.trainModel();
          retrained = Boolean(trained && trained.success);
        } catch (_error) {
          retrained = false;
        }
        trainingFailed = trainingFailed || !retrained;
        if (trainingFailed) {
          showResult(
            "error",
            "Samples saved, but model training failed",
            `<strong>${FT.escapeHtml(student ? student.name : selectedId)}</strong> has ${accepted} new validated sample${accepted === 1 ? "" : "s"} saved. The LBPH model could not be retrained, so recognition will not use ${FT.escapeHtml(student ? student.name : "this student")} yet. Check the backend console and press <strong>Register Face</strong> again after fixing the engine.`
          );
          FT.toast("warning", "Samples saved; model not trained", "Recognition will stay unavailable until the LBPH model trains successfully.");
        } else {
          showResult(
            "success",
            accepted === samples.length ? "Face registered successfully" : "Face registered with warnings",
            `<strong>${FT.escapeHtml(student ? student.name : selectedId)}</strong> now has ${accepted} new validated sample${accepted === 1 ? "" : "s"} saved. ${failures.length ? `${failures.length} sample(s) were rejected: ${FT.escapeHtml(failures[0])}` : "The recognition model was retrained."}`
          );
          FT.toast("success", "Face registered", `${accepted} sample${accepted === 1 ? "" : "s"} saved for ${student ? student.name : selectedId}.`);
        }
        samples = [];
        renderSamples();
        await loadStudents();
        el.select.value = selectedId;
        await selectStudent(selectedId);
        await refreshModel();
      } else {
        showResult(
          "error",
          "Face was not registered",
          `None of the samples were accepted by the backend. ${FT.escapeHtml(failures[0] || "Check that exactly one face is visible and try again.")}`
        );
        FT.toast("error", "Registration failed", "No sample was saved. Nothing was claimed as registered.");
      }
    } finally {
      registering = false;
      FT.setButtonLoading(el.registerBtn, false);
      refreshButtons();
    }
  }

  async function refreshModel() {
    if (FT.isDemo()) return;
    try {
      const response = await FT.data.getFaceModel();
      engineInfo = response.capabilities || null;
      modelInfo = response.model || null;
      engineReady = Boolean(engineInfo && engineInfo.engine_ready);
      lastEngineState();
      updateModelStatus();
    } catch (_error) {
      /* keep previous state */
    }
  }

  function lastEngineState() {
    setEngineBadge();
    setModeNote();
    refreshButtons();
  }

  // ------------------------------------------------------------------
  // Boot / events
  // ------------------------------------------------------------------
  function wire() {
    el.select?.addEventListener("change", () => selectStudent(el.select.value));
    el.startBtn?.addEventListener("click", startCamera);
    el.stopBtn?.addEventListener("click", stopCamera);
    el.captureBtn?.addEventListener("click", captureSample);
    el.registerBtn?.addEventListener("click", registerSamples);
    el.clearBtn?.addEventListener("click", () => {
      if (!samples.length) return;
      clearSamples();
      showResult("info", "Samples cleared", "No samples are selected for registration.");
      FT.toast("info", "Captured samples cleared", "The previous thumbnails were discarded locally and never saved.");
    });
    el.samplesGrid?.addEventListener("click", (event) => {
      const remove = event.target.closest("[data-remove]");
      if (!remove) return;
      const index = Number(remove.dataset.remove);
      samples.splice(index, 1);
      renderSamples();
      showResult("info", "Sample removed", "Removed from the local capture list. Only registered samples are stored on the backend.");
    });
    window.addEventListener("beforeunload", () => FT.stopCamera());
  }

  async function boot() {
    cache();
    const init = await FT.init({
      active: "registration",
      title: "Face Registration",
      subtitle: "Capture validated biometric samples",
    });
    if (!init) return;

    renderSamples();
    refreshButtons();
    wire();

    if (FT.isDemo()) {
      engineReady = false;
      setEngineBadge();
      setModeNote();
      updateModelStatus();
      if (el.privacy) el.privacy.innerHTML = '<i class="fa-solid fa-flask me-1" style="color:#D97706"></i> Demo Mode: camera preview only — no face samples can be saved.';
    } else {
      try {
        const response = await FT.data.getFaceModel();
        engineInfo = response.capabilities || null;
        modelInfo = response.model || null;
        engineReady = Boolean(engineInfo && engineInfo.engine_ready);
        setEngineBadge();
        setModeNote();
        updateModelStatus();
      } catch (error) {
        engineReady = false;
        setEngineBadge();
        setModeNote();
        FT.toast("warning", "Face engine status failed", error.message);
      }
    }

    await loadStudents();
    refreshButtons();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
