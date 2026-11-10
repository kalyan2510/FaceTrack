/* ==========================================================================
   FaceTrack - settings.js
   Admin profile, password, camera preferences, runtime diagnostics and reset.
   Every control performs a real action; Demo Mode is clearly labelled.
   ========================================================================== */

(function () {
  "use strict";

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

  let system = null;
  let systemBusy = false;
  let cameras = [];

  const el = {};

  function cache() {
    el.demoNote = document.getElementById("settingsDemoNote");
    el.profileAvatar = document.getElementById("profileAvatar");
    el.profileName = document.getElementById("profileName");
    el.profileEmail = document.getElementById("profileEmail");
    el.profileRole = document.getElementById("profileRole");
    el.profileForm = document.getElementById("profileForm");
    el.profileNameInput = document.getElementById("profileNameInput");
    el.profileEmailInput = document.getElementById("profileEmailInput");
    el.saveProfileBtn = document.getElementById("saveProfileBtn");
    el.profileResult = document.getElementById("profileResult");
    el.passwordForm = document.getElementById("passwordForm");
    el.currentPassword = document.getElementById("currentPassword");
    el.newPassword = document.getElementById("newPassword");
    el.confirmPassword = document.getElementById("confirmPassword");
    el.changePasswordBtn = document.getElementById("changePasswordBtn");
    el.passwordResult = document.getElementById("passwordResult");
    el.cameraDeviceSelect = document.getElementById("cameraDeviceSelect");
    el.refreshCamerasBtn = document.getElementById("refreshCamerasBtn");
    el.scanIntervalRange = document.getElementById("scanIntervalRange");
    el.scanIntervalValue = document.getElementById("scanIntervalValue");
    el.mirrorPreviewToggle = document.getElementById("mirrorPreviewToggle");
    el.savePrefsBtn = document.getElementById("savePrefsBtn");
    el.prefsResult = document.getElementById("prefsResult");
    el.refreshSystemBtn = document.getElementById("refreshSystemBtn");
    el.testConnectionBtn = document.getElementById("testConnectionBtn");
    el.systemUpdated = document.getElementById("systemUpdated");
    el.systemStatusList = document.getElementById("systemStatusList");
    el.sysApiUrl = document.getElementById("sysApiUrl");
    el.sysDatabase = document.getElementById("sysDatabase");
    el.sysEngine = document.getElementById("sysEngine");
    el.sysModel = document.getElementById("sysModel");
    el.sysThreshold = document.getElementById("sysThreshold");
    el.sysCounts = document.getElementById("sysCounts");
    el.sysSamples = document.getElementById("sysSamples");
    el.connectionResult = document.getElementById("connectionResult");
    el.dataMode = document.getElementById("dataMode");
    el.dataStorageKey = document.getElementById("dataStorageKey");
    el.dataAdmin = document.getElementById("dataAdmin");
    el.resetDemoBtn = document.getElementById("resetDemoBtn");
    el.settingsLogoutBtn = document.getElementById("settingsLogoutBtn");
    el.aboutVersion = document.getElementById("aboutVersion");
  }

  // ------------------------------------------------------------------
  // Shared feedback
  // ------------------------------------------------------------------
  function showBox(target, tone, icon, html) {
    if (!target) return;
    target.className = `face-status-box ${tone} mt-3`;
    target.innerHTML = `<i class="fa-solid ${icon}"></i><div>${html}</div>`;
  }

  function clearInvalid(form) {
    form.querySelectorAll(".is-invalid").forEach((input) => input.classList.remove("is-invalid"));
  }

  function markInvalid(input) {
    input.classList.add("is-invalid");
    input.focus();
  }

  // ------------------------------------------------------------------
  // Profile
  // ------------------------------------------------------------------
  function renderAdmin(admin) {
    const person = admin || FT.getAdmin();
    if (el.profileAvatar) el.profileAvatar.innerHTML = FT.avatarHtml(person, "", "avatar-lg");
    if (el.profileName) el.profileName.textContent = person.name || "Administrator";
    if (el.profileEmail) el.profileEmail.textContent = person.email || "admin@facetrack.com";
    if (el.profileRole) el.profileRole.innerHTML = `<i class="fa-solid fa-shield-halved"></i> ${FT.escapeHtml(person.role || "Administrator")}`;
    if (el.dataAdmin) el.dataAdmin.textContent = `${person.name || "Administrator"} · ${person.email || ""}`;
    if (el.profileNameInput) el.profileNameInput.value = person.name || "";
    if (el.profileEmailInput) el.profileEmailInput.value = person.email || "";
  }

  async function saveProfile(event) {
    event.preventDefault();
    clearInvalid(el.profileForm);
    const name = el.profileNameInput.value.trim();
    const email = el.profileEmailInput.value.trim().toLowerCase();
    let valid = true;
    if (name.length < 2) {
      markInvalid(el.profileNameInput);
      valid = false;
    }
    if (!EMAIL_RE.test(email)) {
      if (valid) markInvalid(el.profileEmailInput);
      valid = false;
    }
    if (!valid) {
      showBox(el.profileResult, "warn", "fa-triangle-exclamation", "Check the highlighted fields and try again.");
      return;
    }

    FT.setButtonLoading(el.saveProfileBtn, true, "Saving…");
    try {
      const response = await FT.data.updateProfile(name, email);
      const admin = (response && response.admin) || Object.assign({}, FT.getAdmin(), { name, email });
      FT.updateSessionAdmin(admin);
      renderAdmin(admin);
      showBox(el.profileResult, "good", "fa-circle-check", `<strong>Profile saved.</strong> ${FT.escapeHtml(response && response.message ? response.message : "Your details were updated.")}`);
      FT.toast("success", "Profile updated", "The new admin details are now stored in your session.");
      setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      showBox(el.profileResult, "warn", "fa-circle-xmark", `<strong>Profile was not saved.</strong> ${FT.escapeHtml(error.message)}`);
      FT.toast("error", "Could not update profile", error.message);
    } finally {
      FT.setButtonLoading(el.saveProfileBtn, false);
    }
  }

  // ------------------------------------------------------------------
  // Password
  // ------------------------------------------------------------------
  async function changePassword(event) {
    event.preventDefault();
    clearInvalid(el.passwordForm);
    const current = el.currentPassword.value;
    const next = el.newPassword.value;
    const confirm = el.confirmPassword.value;

    if (!current) {
      markInvalid(el.currentPassword);
      showBox(el.passwordResult, "warn", "fa-triangle-exclamation", "Enter your current password.");
      return;
    }
    if (next.length < 8 || !/[A-Za-z]/.test(next) || !/\d/.test(next)) {
      markInvalid(el.newPassword);
      showBox(el.passwordResult, "warn", "fa-triangle-exclamation", "The new password must be at least 8 characters and include a letter and a number.");
      return;
    }
    if (next === current) {
      markInvalid(el.newPassword);
      showBox(el.passwordResult, "warn", "fa-triangle-exclamation", "Choose a password different from your current one.");
      return;
    }
    if (next !== confirm) {
      markInvalid(el.confirmPassword);
      showBox(el.passwordResult, "warn", "fa-triangle-exclamation", "The confirmation does not match the new password.");
      return;
    }

    FT.setButtonLoading(el.changePasswordBtn, true, "Updating…");
    try {
      const response = await FT.data.changePassword(current, next);
      el.passwordForm.reset();
      showBox(el.passwordResult, "good", "fa-circle-check", `<strong>Password changed.</strong> ${FT.escapeHtml(response && response.message ? response.message : "Use the new password next time you sign in.")}`);
      FT.toast("success", "Password updated", "Your administrator password was changed.");
      // Bearer tokens are invalidated server-side on password change, so end
      // this session and send the admin back to the login page.
      FT.clearSession ? FT.clearSession() : null;
      setTimeout(() => { window.location.replace("login.html?reason=password_changed"); }, 700);
    } catch (error) {
      showBox(el.passwordResult, "warn", "fa-circle-xmark", `<strong>Password was not changed.</strong> ${FT.escapeHtml(error.message)}`);
      FT.toast("error", "Could not change password", error.message);
    } finally {
      FT.setButtonLoading(el.changePasswordBtn, false);
    }
  }

  // ------------------------------------------------------------------
  // Camera preferences
  // ------------------------------------------------------------------
  function intervalLabel(value) {
    return `${(Number(value) / 1000).toFixed(1)}s`;
  }

  function loadPreferences() {
    const prefs = FT.getPrefs();
    const stored = Number(prefs.scanInterval) || 2600;
    const interval = Math.min(8000, Math.max(1500, stored));
    if (el.scanIntervalRange) el.scanIntervalRange.value = String(interval);
    if (el.scanIntervalValue) el.scanIntervalValue.textContent = intervalLabel(interval);
    if (el.mirrorPreviewToggle) el.mirrorPreviewToggle.checked = prefs.mirrorPreview !== false;
    populateCameras(prefs.cameraDevice || "");
  }

  function populateCameras(selected) {
    if (!el.cameraDeviceSelect) return;
    const options = ['<option value="">Default camera</option>'].concat(
      cameras.map((camera, index) => {
        const label = camera.label || `Camera ${index + 1}`;
        return `<option value="${FT.escapeHtml(camera.deviceId)}">${FT.escapeHtml(label)}</option>`;
      })
    );
    el.cameraDeviceSelect.innerHTML = options.join("");
    if (selected && cameras.some((camera) => camera.deviceId === selected)) {
      el.cameraDeviceSelect.value = selected;
    } else {
      el.cameraDeviceSelect.value = "";
    }
  }

  async function refreshCameras(showToast = false) {
    if (el.refreshCamerasBtn) FT.setButtonLoading(el.refreshCamerasBtn, true);
    try {
      cameras = await FT.listCameras();
      populateCameras(FT.getPrefs().cameraDevice || "");
      if (showToast) {
        FT.toast(
          cameras.length ? "success" : "info",
          cameras.length ? "Cameras found" : "No cameras detected",
          cameras.length
            ? `${cameras.length} video input${cameras.length === 1 ? "" : "s"} available.`
            : "Connect a webcam and allow camera permission, then refresh."
        );
      }
    } catch (error) {
      if (showToast) FT.toast("error", "Camera list unavailable", error.message);
    } finally {
      if (el.refreshCamerasBtn) FT.setButtonLoading(el.refreshCamerasBtn, false);
    }
  }

  function savePreferences() {
    const scanInterval = Math.min(8000, Math.max(1500, Number(el.scanIntervalRange.value) || 2600));
    const cameraDevice = el.cameraDeviceSelect.value || "";
    const mirrorPreview = Boolean(el.mirrorPreviewToggle.checked);
    FT.savePrefs({ scanInterval, cameraDevice, mirrorPreview });
    document.body.dataset.mirror = mirrorPreview ? "on" : "off";
    if (el.scanIntervalValue) el.scanIntervalValue.textContent = intervalLabel(scanInterval);
    showBox(
      el.prefsResult,
      "good",
      "fa-circle-check",
      `<strong>Preferences saved.</strong> Scan interval ${intervalLabel(scanInterval)} · ${cameraDevice ? "selected camera" : "default camera"} · preview ${mirrorPreview ? "mirrored" : "unmirrored"}.`
    );
    FT.toast("success", "Preferences saved", "Camera settings apply the next time you open a camera.");
  }

  // ------------------------------------------------------------------
  // System information
  // ------------------------------------------------------------------
  function statusItem(icon, label, value, tone) {
    return `<div class="system-status-item">
      <i class="fa-solid ${icon}"></i>
      <span>${FT.escapeHtml(label)}</span>
      <span class="ssi-value ${tone || ""}">${FT.escapeHtml(value)}</span>
    </div>`;
  }

  function renderSystem() {
    if (!system) return;
    const engine = system.face_engine || {};
    const model = system.model || {};
    const counts = system.counts || {};

    if (el.sysApiUrl) el.sysApiUrl.textContent = FT.apiBase;
    if (el.sysDatabase) el.sysDatabase.textContent = `${system.database || "SQLite"}${system.database_path ? ` · ${system.database_path}` : ""}`;
    if (el.sysEngine) {
      el.sysEngine.innerHTML = engine.engine_ready
        ? '<span class="text-green fw-600">OpenCV ready</span>'
        : '<span class="text-red fw-600">Unavailable</span>';
    }
    if (el.sysModel) {
      el.sysModel.textContent = model.trained_at
        ? `${model.students || 0} students · ${model.samples || 0} samples`
        : "Not trained yet";
    }
    if (el.sysThreshold) el.sysThreshold.textContent = system.threshold != null ? `${system.threshold}` : "—";
    if (el.sysCounts) el.sysCounts.textContent = `${FT.formatNumber(counts.students || 0)} / ${FT.formatNumber(counts.attendance || 0)}`;
    if (el.sysSamples) el.sysSamples.textContent = FT.formatNumber(counts.face_samples || 0);

    if (el.systemUpdated) {
      el.systemUpdated.textContent = `${FT.isDemo() ? "Demo snapshot" : "Live runtime"} · ${new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
    }
    if (el.aboutVersion) el.aboutVersion.textContent = `${system.app || "FaceTrack"} v${system.version || FT.config.APP_VERSION}`;

    if (el.systemStatusList) {
      el.systemStatusList.innerHTML = [
        statusItem(
          "fa-plug",
          "Flask API",
          FT.isDemo() ? (stateOnline() ? "Reachable · unused" : "Not connected") : stateOnline() ? "Online" : "Offline",
          FT.isDemo() ? "warn" : stateOnline() ? "" : "bad"
        ),
        statusItem("fa-database", "SQLite database", system.database || (FT.isDemo() ? "localStorage demo" : "SQLite"), FT.isDemo() ? "warn" : ""),
        statusItem("fa-eye", "OpenCV face engine", engine.engine_ready ? "Ready" : "Unavailable", engine.engine_ready ? "" : "bad"),
        statusItem("fa-microchip", "LBPH model", model.trained_at ? "Trained" : "Not trained", model.trained_at ? "" : "warn"),
        statusItem("fa-user-shield", "Recognition session", (system.session && system.session.active) ? "Active" : "Inactive", (system.session && system.session.active) ? "" : "warn"),
      ].join("");
    }

    if (el.dataMode) {
      el.dataMode.innerHTML = FT.isDemo()
        ? '<span class="badge-soft badge-warning"><i class="fa-solid fa-flask"></i> Demo Mode</span>'
        : '<span class="badge-soft badge-success"><i class="fa-solid fa-database"></i> Live API</span>';
    }
    if (el.dataStorageKey) el.dataStorageKey.textContent = FT.isDemo() ? FT.config.DEMO_STORAGE_KEY : "Server SQLite";
    if (el.resetDemoBtn) {
      el.resetDemoBtn.disabled = !FT.isDemo();
      el.resetDemoBtn.title = FT.isDemo() ? "Restore sample students and attendance" : "Only available in Demo Mode";
    }
  }

  function stateOnline() {
    return Boolean(FT.state && FT.state.backendOnline);
  }

  function renderSystemFailure(error) {
    if (el.systemStatusList) {
      el.systemStatusList.innerHTML = statusItem("fa-triangle-exclamation", "System information", "Unavailable", "bad");
    }
    if (el.connectionResult) {
      el.connectionResult.className = "face-status-box warn mt-3";
      el.connectionResult.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i><div><strong>Diagnostics unavailable.</strong> ${FT.escapeHtml(error.message)}</div>`;
    }
  }

  async function loadSystem(showToast = false) {
    if (systemBusy) return;
    systemBusy = true;
    if (showToast) FT.setButtonLoading(el.refreshSystemBtn, true, "Checking…");
    try {
      system = await FT.data.getSystemInfo();
      renderSystem();
      if (showToast) FT.toast("success", "Status refreshed", "Runtime information is up to date.");
    } catch (error) {
      renderSystemFailure(error);
      if (showToast) FT.toast("error", "Status unavailable", error.message);
    } finally {
      systemBusy = false;
      if (showToast) FT.setButtonLoading(el.refreshSystemBtn, false);
    }
  }

  async function testConnection() {
    if (!el.testConnectionBtn) return;
    FT.setButtonLoading(el.testConnectionBtn, true, "Testing…");
    try {
      const online = await FT.checkBackend();
      if (!online) {
        throw new FT.FTError(
          `No response from ${FT.apiBase}. Start the Flask backend with "python app.py" inside the backend folder.`,
          0,
          "OFFLINE"
        );
      }
      if (FT.isDemo()) {
        const message = "The Flask API is reachable, but this browser session is using Demo Mode. Sign out and sign in with the live admin credentials to inspect OpenCV engine diagnostics.";
        if (el.connectionResult) {
          el.connectionResult.className = "face-status-box good mt-3";
          el.connectionResult.innerHTML = `<i class="fa-solid fa-circle-check"></i><div><strong>Backend reachable.</strong> ${FT.escapeHtml(message)}<br><span class="fs-12 text-muted-ft">${FT.escapeHtml(FT.apiBase)} · ${new Date().toLocaleTimeString("en-IN")}</span></div>`;
        }
        FT.toast("success", "Backend reachable", message);
        return;
      }
      const info = await FT.data.getSystemInfo();
      system = info;
      renderSystem();
      const engine = info.face_engine || {};
      const tone = engine.engine_ready ? "good" : "warn";
      const icon = engine.engine_ready ? "fa-circle-check" : "fa-triangle-exclamation";
      const engineText = engine.engine_ready
        ? "OpenCV face engine is ready."
        : "The API is reachable, but the OpenCV face engine is unavailable. Install opencv-contrib-python and restart Flask.";
      if (el.connectionResult) {
        el.connectionResult.className = `face-status-box ${tone} mt-3`;
        el.connectionResult.innerHTML = `<i class="fa-solid ${icon}"></i><div><strong>Backend reachable.</strong> ${FT.escapeHtml(engineText)}<br><span class="fs-12 text-muted-ft">${FT.escapeHtml(FT.apiBase)} · ${new Date().toLocaleTimeString("en-IN")}</span></div>`;
      }
      FT.toast(engine.engine_ready ? "success" : "warning", "Connection tested", engineText);
    } catch (error) {
      if (el.connectionResult) {
        el.connectionResult.className = "face-status-box warn mt-3";
        el.connectionResult.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i><div><strong>Connection failed.</strong> ${FT.escapeHtml(error.message)}<br><span class="fs-12 text-muted-ft">Demo Mode stays available when the backend is offline.</span></div>`;
      }
      FT.toast("error", "Backend unreachable", error.message);
    } finally {
      FT.setButtonLoading(el.testConnectionBtn, false);
    }
  }

  // ------------------------------------------------------------------
  // Reset + logout
  // ------------------------------------------------------------------
  async function resetDemo() {
    if (!FT.isDemo()) {
      FT.toast("info", "Demo reset only", "Live SQLite data cannot be reset from the browser. Use the backend tools instead.");
      return;
    }
    const confirmed = await FT.confirm({
      title: "Reset demo data?",
      message: "All sample students, demo attendance and simulated check-ins stored in this browser will be replaced with the original demo dataset. This does not affect any live backend data.",
      confirmText: "Reset demo data",
      danger: true,
      icon: "fa-rotate-left",
    });
    if (!confirmed) return;
    FT.setButtonLoading(el.resetDemoBtn, true, "Resetting…");
    try {
      FT.demo.reset();
      FT.toast("success", "Demo data reset", "Reloading the original sample dataset…");
      setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      FT.toast("error", "Reset failed", error.message);
      FT.setButtonLoading(el.resetDemoBtn, false);
    }
  }

  // ------------------------------------------------------------------
  // Wiring
  // ------------------------------------------------------------------
  function wire() {
    el.profileForm?.addEventListener("submit", saveProfile);
    el.passwordForm?.addEventListener("submit", changePassword);
    el.refreshCamerasBtn?.addEventListener("click", () => refreshCameras(true));
    el.scanIntervalRange?.addEventListener("input", () => {
      if (el.scanIntervalValue) el.scanIntervalValue.textContent = intervalLabel(el.scanIntervalRange.value);
    });
    el.savePrefsBtn?.addEventListener("click", savePreferences);
    el.refreshSystemBtn?.addEventListener("click", () => loadSystem(true));
    el.testConnectionBtn?.addEventListener("click", testConnection);
    el.resetDemoBtn?.addEventListener("click", resetDemo);
    el.settingsLogoutBtn?.addEventListener("click", () => FT.logout());
  }

  async function boot() {
    cache();
    const init = await FT.init({
      active: "settings",
      title: "Settings",
      subtitle: "Profile, security, camera preferences and system status",
    });
    if (!init) return;

    if (FT.isDemo() && el.demoNote) el.demoNote.style.display = "flex";
    renderAdmin(init.admin || FT.getAdmin());
    loadPreferences();
    if (el.aboutVersion) el.aboutVersion.textContent = `FaceTrack v${FT.config.APP_VERSION}`;
    wire();
    await Promise.allSettled([loadSystem(false), refreshCameras(false)]);
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
