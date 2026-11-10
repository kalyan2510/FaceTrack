/* ==========================================================================
   FaceTrack - students.js
   Student directory: search, filter, add, edit, view, delete.
   Works against the Flask API or the clearly labelled Demo Mode store.
   ========================================================================== */

(function () {
  "use strict";

  let allStudents = [];
  let filteredStudents = [];
  let filters = { search: "", department: "", year: "" };
  let currentViewStudent = null;
  let photoFile = null;
  let photoPreview = null;
  let saving = false;

  const els = {};

  function cacheElements() {
    els.tableBody = document.getElementById("studentsTableBody");
    els.count = document.getElementById("studentsCount");
    els.faceCount = document.getElementById("studentsFaceCount");
    els.footer = document.getElementById("studentsFooter");
    els.source = document.getElementById("studentsDataSource");
    els.search = document.getElementById("studentSearch");
    els.department = document.getElementById("departmentFilter");
    els.year = document.getElementById("yearFilter");
    els.clear = document.getElementById("clearStudentFilters");
    els.addBtn = document.getElementById("addStudentBtn");
    els.modal = document.getElementById("studentModal");
    els.form = document.getElementById("studentForm");
    els.formTitle = document.getElementById("studentModalTitle");
    els.formSubtitle = document.getElementById("studentModalSubtitle");
    els.formError = document.getElementById("studentFormError");
    els.originalId = document.getElementById("studentIdOriginal");
    els.studentId = document.getElementById("fieldStudentId");
    els.name = document.getElementById("fieldName");
    els.departmentField = document.getElementById("fieldDepartment");
    els.yearField = document.getElementById("fieldYear");
    els.section = document.getElementById("fieldSection");
    els.email = document.getElementById("fieldEmail");
    els.phone = document.getElementById("fieldPhone");
    els.photo = document.getElementById("studentPhoto");
    els.photoPreview = document.getElementById("studentPhotoPreview");
    els.saveBtn = document.getElementById("studentSaveBtn");
    els.viewModal = document.getElementById("viewStudentModal");
    els.studentDetails = document.getElementById("studentDetails");
    els.viewEditBtn = document.getElementById("viewEditBtn");
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  function setSourceLabel() {
    if (!els.source) return;
    els.source.textContent = FT.isDemo() ? "Demo mode · sample data" : "Live API · SQLite";
  }

  function departmentsOf(students) {
    return Array.from(new Set(students.map((student) => student.department).filter(Boolean))).sort();
  }

  function fillDepartmentOptions() {
    const current = els.department.value;
    const formCurrent = els.departmentField.value;
    const departments = departmentsOf(allStudents);
    if (formCurrent && !departments.includes(formCurrent)) departments.push(formCurrent);
    els.department.innerHTML =
      '<option value="">All Departments</option>' +
      departments.map((department) => `<option value="${FT.escapeHtml(department)}">${FT.escapeHtml(department)}</option>`).join("");
    els.department.value = current || "";
    const existing = currentViewStudent && currentViewStudent.department;
    if (existing && !departments.includes(existing)) departments.push(existing);
    if (els.departmentField.options.length <= 1) {
      els.departmentField.innerHTML =
        '<option value="">Select department</option>' +
        ["Computer Science", "Information Technology", "Electronics & Comm.", "Electrical & Electronics", "Mechanical Engg.", "AI & Machine Learning", "Civil Engineering"]
          .map((department) => `<option>${department}</option>`)
          .join("");
    }
    els.departmentField.value = formCurrent || "";
  }

  function applyFilters() {
    const search = filters.search.toLowerCase().trim();
    filteredStudents = allStudents.filter((student) => {
      if (filters.department && student.department !== filters.department) return false;
      if (filters.year && student.year !== filters.year) return false;
      if (search) {
        const haystack = `${student.name} ${student.student_id} ${student.email || ""} ${student.phone || ""}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
    renderStudents();
  }

  function renderStudents() {
    if (els.count) els.count.textContent = FT.formatNumber(filteredStudents.length);
    if (els.faceCount) {
      els.faceCount.textContent = FT.formatNumber(allStudents.filter((student) => student.face_registered).length);
    }
    if (els.footer) {
      els.footer.innerHTML = filteredStudents.length
        ? `Showing <strong>${filteredStudents.length}</strong> of <strong>${allStudents.length}</strong> students`
        : "No students match the current filters.";
    }
    if (!els.tableBody) return;

    if (!filteredStudents.length) {
      els.tableBody.innerHTML = `<tr><td colspan="7">
        <div class="empty-state">
          <div class="empty-icon"><i class="fa-solid fa-user-graduate"></i></div>
          <h4>${allStudents.length ? "No matching students" : "No students yet"}</h4>
          <p>${allStudents.length ? "Try a different name, ID or department filter." : "Add your first student to begin registering faces and taking attendance."}</p>
          <button class="btn btn-sm btn-primary" type="button" data-action="${allStudents.length ? "clear" : "add"}"><i class="fa-solid ${allStudents.length ? "fa-filter-circle-xmark" : "fa-user-plus"}"></i> ${allStudents.length ? "Clear filters" : "Add Student"}</button>
        </div>
      </td></tr>`;
      return;
    }

    els.tableBody.innerHTML = filteredStudents
      .map((student) => {
        const face = student.face_registered
          ? `<span class="face-status text-green"><i class="fa-solid fa-circle-check"></i> Registered</span>
             <span class="cell-sub">${student.face_samples || 0} sample${(student.face_samples || 0) === 1 ? "" : "s"}</span>`
          : `<span class="face-status text-muted-ft"><i class="fa-solid fa-circle-exclamation" style="color:#D97706"></i> Not registered</span>
             <span class="cell-sub">Face capture required</span>`;
        return `
          <tr>
            <td>
              <div class="student-cell">
                ${FT.avatarHtml(student, "", "avatar-sm")}
                <div>
                  <span class="cell-strong">${FT.escapeHtml(student.name)}</span>
                  <span class="cell-sub">${FT.escapeHtml(student.email || "No email on file")}</span>
                </div>
              </div>
            </td>
            <td><span class="student-id-badge">${FT.escapeHtml(student.student_id)}</span></td>
            <td class="fs-12">${FT.escapeHtml(student.department)}</td>
            <td><span class="cell-strong">${FT.escapeHtml(student.year)}</span><span class="cell-sub">Section ${FT.escapeHtml(student.section || "A")}</span></td>
            <td class="fs-12">${FT.escapeHtml(student.phone || "—")}</td>
            <td>${face}</td>
            <td class="cell-actions">
              <button class="btn-icon" type="button" data-action="view" data-id="${FT.escapeHtml(student.student_id)}" title="View ${FT.escapeHtml(student.name)}"><i class="fa-regular fa-eye"></i></button>
              <button class="btn-icon" type="button" data-action="edit" data-id="${FT.escapeHtml(student.student_id)}" title="Edit ${FT.escapeHtml(student.name)}"><i class="fa-solid fa-pen"></i></button>
              <button class="btn-icon danger" type="button" data-action="delete" data-id="${FT.escapeHtml(student.student_id)}" title="Delete ${FT.escapeHtml(student.name)}"><i class="fa-regular fa-trash-can"></i></button>
            </td>
          </tr>`;
      })
      .join("");

    if (els.source) {
      els.source.innerHTML = FT.isDemo()
        ? '<i class="fa-solid fa-flask"></i> Demo · sample data'
        : '<i class="fa-solid fa-database"></i> Live SQLite';
    }
  }

  function renderLoadError(message) {
    if (!els.tableBody) return;
    els.tableBody.innerHTML = `<tr><td colspan="7">
      <div class="empty-state">
        <div class="empty-icon" style="background:#FEF3C7;color:#D97706"><i class="fa-solid fa-triangle-exclamation"></i></div>
        <h4>Students could not be loaded</h4>
        <p>${FT.escapeHtml(message)}</p>
        <button class="btn btn-sm btn-primary" type="button" id="studentsRetry"><i class="fa-solid fa-rotate"></i> Try again</button>
      </div>
    </td></tr>`;
    document.getElementById("studentsRetry")?.addEventListener("click", loadStudents);
  }

  async function loadStudents() {
    if (els.tableBody) {
      els.tableBody.innerHTML = `<tr><td colspan="7"><div class="skeleton" style="height:20px;margin:8px 0"></div></td></tr>`;
    }
    try {
      const response = await FT.data.getStudents({});
      allStudents = response.students || [];
      fillDepartmentOptions();
      applyFilters();
      setSourceLabel();
    } catch (error) {
      renderLoadError(error.message);
      FT.toast("error", "Could not load students", error.message);
    }
  }

  // ------------------------------------------------------------------
  // Form helpers
  // ------------------------------------------------------------------
  function clearFormErrors() {
    els.formError?.classList.add("d-none");
    [els.studentId, els.name, els.departmentField, els.yearField, els.email, els.phone].forEach((input) => {
      input?.classList.remove("is-invalid");
    });
  }

  function markInvalid(input) {
    input?.classList.add("is-invalid");
  }

  function resetPhoto() {
    photoFile = null;
    photoPreview = null;
    if (els.photo) els.photo.value = "";
    if (els.photoPreview) els.photoPreview.innerHTML = '<i class="fa-solid fa-user"></i>';
  }

  function setPhotoPreview(source) {
    if (!els.photoPreview) return;
    els.photoPreview.innerHTML = source ? `<img src="${FT.escapeHtml(source)}" alt="Student photo preview">` : '<i class="fa-solid fa-user"></i>';
  }

  function openAddModal() {
    if (!els.form) return;
    els.form.reset();
    clearFormErrors();
    resetPhoto();
    els.originalId.value = "";
    els.studentId.disabled = false;
    els.formTitle.textContent = "Add Student";
    els.formSubtitle.textContent = "Create a student profile for attendance and face registration.";
    els.saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save Student';
    els.departmentField.value = "";
    els.yearField.value = "";
    els.section.value = "A";
    FT.modal(els.modal);
  }

  function openEditModal(student) {
    if (!student) return;
    clearFormErrors();
    resetPhoto();
    els.originalId.value = student.student_id;
    els.studentId.value = student.student_id;
    els.studentId.disabled = true;
    els.name.value = student.name || "";
    els.departmentField.value = student.department || "";
    if (!els.departmentField.value) {
      const option = document.createElement("option");
      option.value = student.department;
      option.textContent = student.department;
      els.departmentField.appendChild(option);
      els.departmentField.value = student.department;
    }
    els.yearField.value = student.year || "";
    els.section.value = student.section || "A";
    els.email.value = student.email || "";
    els.phone.value = student.phone || "";
    if (student.face_registered) {
      els.formSubtitle.textContent = `Editing ${student.name} · ${student.face_samples || 0} face sample(s) registered.`;
    } else {
      els.formSubtitle.textContent = `Editing ${student.name} · no face samples registered yet.`;
    }
    els.formTitle.textContent = "Edit Student";
    els.saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Update Student';
    const photo = FT.photoUrlFor(student);
    if (photo) setPhotoPreview(photo);
    FT.modal(els.modal);
  }

  function validateForm() {
    clearFormErrors();
    const isEditing = Boolean(els.originalId.value);
    let firstInvalid = null;
    let message = "";

    if (!isEditing) {
      const id = els.studentId.value.trim();
      if (!/^[A-Za-z0-9_-]{3,24}$/.test(id)) {
        markInvalid(els.studentId);
        firstInvalid = firstInvalid || els.studentId;
        message = message || "Student ID must be 3–24 letters, numbers, hyphen or underscore.";
      }
    }
    if (els.name.value.trim().length < 2) {
      markInvalid(els.name);
      firstInvalid = firstInvalid || els.name;
      message = message || "Enter the student's full name.";
    }
    if (!els.departmentField.value) {
      markInvalid(els.departmentField);
      firstInvalid = firstInvalid || els.departmentField;
      message = message || "Select a department.";
    }
    if (!els.yearField.value) {
      markInvalid(els.yearField);
      firstInvalid = firstInvalid || els.yearField;
      message = message || "Select the current year.";
    }
    const email = els.email.value.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(email)) {
      markInvalid(els.email);
      firstInvalid = firstInvalid || els.email;
      message = message || "Enter a valid email address or leave it blank.";
    }
    const phone = els.phone.value.replace(/[^\d]/g, "");
    if (phone && !/^[6-9]\d{9}$/.test(phone)) {
      markInvalid(els.phone);
      firstInvalid = firstInvalid || els.phone;
      message = message || "Enter a valid 10-digit Indian mobile number, or leave it blank.";
    }
    if (message) {
      showFormError(message);
      firstInvalid?.focus();
      return null;
    }
    return {
      student_id: isEditing ? els.originalId.value : els.studentId.value.trim().toUpperCase(),
      name: els.name.value.trim(),
      department: els.departmentField.value,
      year: els.yearField.value,
      section: els.section.value,
      email: email,
      phone: phone,
    };
  }

  function showFormError(message) {
    if (!els.formError) return;
    els.formError.textContent = message;
    els.formError.classList.remove("d-none");
  }

  async function saveStudent(event) {
    event.preventDefault();
    if (saving) return;
    const payload = validateForm();
    if (!payload) return;
    const isEditing = Boolean(els.originalId.value);
    saving = true;
    FT.setButtonLoading(els.saveBtn, true, isEditing ? "Updating…" : "Saving…");
    try {
      if (isEditing) {
        if (FT.isDemo() && photoPreview) payload.photo = photoPreview;
        await FT.data.updateStudent(payload.student_id, payload);
        if (!FT.isDemo() && photoFile) {
          try {
            await FT.data.uploadStudentPhoto(payload.student_id, photoFile);
          } catch (photoError) {
            FT.toast("warning", "Student updated, photo failed", photoError.message);
          }
        }
        FT.toast("success", "Student updated", `${payload.name}'s profile was saved.`);
      } else {
        if (FT.isDemo() && photoPreview) payload.photo = photoPreview;
        await FT.data.createStudent(payload);
        if (!FT.isDemo() && photoFile) {
          try {
            await FT.data.uploadStudentPhoto(payload.student_id, photoFile);
          } catch (photoError) {
            FT.toast("warning", "Student added, photo failed", photoError.message);
          }
        }
        FT.toast("success", "Student added", `${payload.name} is ready for face registration.`);
        if (photoPreview) {
          /* photo intentionally only kept in the preview */
        }
      }
      FT.closeModal(els.modal);
      await loadStudents();
    } catch (error) {
      showFormError(error.message);
      const fields = error.payload && error.payload.fields;
      if (fields) {
        const mapping = {
          student_id: els.studentId,
          name: els.name,
          department: els.departmentField,
          year: els.yearField,
          email: els.email,
          phone: els.phone,
        };
        Object.keys(fields).forEach((key) => markInvalid(mapping[key]));
      }
      FT.toast("error", "Could not save student", error.message);
    } finally {
      saving = false;
      FT.setButtonLoading(els.saveBtn, false);
    }
  }

  // ------------------------------------------------------------------
  // View / delete
  // ------------------------------------------------------------------
  async function viewStudent(studentId) {
    currentViewStudent = null;
    if (els.studentDetails) els.studentDetails.innerHTML = '<div class="skeleton" style="height:180px"></div>';
    FT.modal(els.viewModal);
    try {
      const response = await FT.data.getStudent(studentId);
      const student = response.student;
      currentViewStudent = student;
      const summary = student.attendance_summary;
      const face = student.face_registered
        ? `<span class="badge-soft badge-success"><i class="fa-solid fa-circle-check"></i> Face registered</span>`
        : `<span class="badge-soft badge-warning"><i class="fa-solid fa-triangle-exclamation"></i> Face not registered</span>`;
      const photo = FT.photoUrlFor(student);
      const avatar = photo
        ? `<span class="avatar avatar-xl"><span class="avatar-initials">${FT.escapeHtml(FT.initials(student.name))}</span><img src="${FT.escapeHtml(photo)}" alt="${FT.escapeHtml(student.name)}" onerror="this.style.display='none'"></span>`
        : `<span class="avatar avatar-xl ${FT.avatarColor(student.student_id)}"><span class="avatar-initials">${FT.escapeHtml(FT.initials(student.name))}</span></span>`;
      els.studentDetails.innerHTML = `
        <div class="profile-hero">
          ${avatar}
          <div class="flex-grow-1 min-w-0">
            <h3>${FT.escapeHtml(student.name)}</h3>
            <p><span class="student-id-badge">${FT.escapeHtml(student.student_id)}</span> · ${FT.escapeHtml(student.department)}</p>
            <div class="d-flex gap-2 flex-wrap mt-2">
              ${face}
              <span class="badge-soft badge-info">${FT.escapeHtml(student.year)} · Section ${FT.escapeHtml(student.section || "A")}</span>
            </div>
          </div>
        </div>
        <div class="row g-3">
          <div class="col-md-7">
            <div class="info-list">
              <div class="info-row"><span class="info-label">Email address</span><span class="info-value">${FT.escapeHtml(student.email || "—")}</span></div>
              <div class="info-row"><span class="info-label">Phone number</span><span class="info-value">${FT.escapeHtml(student.phone || "—")}</span></div>
              <div class="info-row"><span class="info-label">Department</span><span class="info-value">${FT.escapeHtml(student.department)}</span></div>
              <div class="info-row"><span class="info-label">Year / Section</span><span class="info-value">${FT.escapeHtml(student.year)} · ${FT.escapeHtml(student.section || "A")}</span></div>
              <div class="info-row"><span class="info-label">Face samples</span><span class="info-value">${student.face_samples || 0} captured</span></div>
            </div>
          </div>
          <div class="col-md-5">
            <div class="live-summary" style="grid-template-columns:1fr 1fr;margin-bottom:10px;">
              <div class="live-stat green">
                <div class="ls-value">${summary ? summary.present : "—"}</div>
                <div class="ls-label">Present · 30 days</div>
              </div>
              <div class="live-stat red">
                <div class="ls-value">${summary ? summary.absent : "—"}</div>
                <div class="ls-label">Absent · 30 days</div>
              </div>
            </div>
            <div class="face-status-box ${student.face_registered ? "good" : "warn"}">
              <i class="fa-solid ${student.face_registered ? "fa-shield-halved" : "fa-triangle-exclamation"}"></i>
              <div>
                ${
                  student.face_registered
                    ? `<strong>${summary ? summary.percentage : 0}%</strong> attendance in the last 30 days.<br>Biometric profile is ready for recognition.`
                    : `Register this student's face from the Face Registration page before taking attendance.`
                }
              </div>
            </div>
            <a href="attendance.html" class="btn btn-sm btn-soft w-100 mt-3"><i class="fa-solid fa-camera"></i> Open attendance</a>
          </div>
        </div>`;
    } catch (error) {
      els.studentDetails.innerHTML = `<div class="empty-state"><div class="empty-icon" style="background:#FEF3C7;color:#D97706"><i class="fa-solid fa-triangle-exclamation"></i></div><h4>Could not load profile</h4><p>${FT.escapeHtml(error.message)}</p></div>`;
    }
  }

  async function deleteStudent(studentId) {
    const student = allStudents.find((item) => item.student_id === studentId);
    if (!student) return;
    const confirmed = await FT.confirm({
      title: "Delete this student?",
      message: `<strong>${FT.escapeHtml(student.name)}</strong> (${FT.escapeHtml(student.student_id)}) will be removed along with their attendance history and face samples. This cannot be undone.`,
      confirmText: "Delete student",
      danger: true,
      icon: "fa-trash-can",
    });
    if (!confirmed) return;
    try {
      await FT.data.deleteStudent(studentId);
      FT.toast("success", "Student deleted", `${student.name} was removed.`);
      await loadStudents();
    } catch (error) {
      FT.toast("error", "Delete failed", error.message);
    }
  }

  // ------------------------------------------------------------------
  // Photo handling
  // ------------------------------------------------------------------
  function readImage(file, maxSize = 420, quality = 0.84) {
    return new Promise((resolve, reject) => {
      if (!file.type.startsWith("image/")) {
        reject(new Error("Choose a JPG, PNG or WebP image."));
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        reject(new Error("Photo must be smaller than 5 MB."));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const image = new Image();
        image.onload = () => {
          const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(image.width * scale);
          canvas.height = Math.round(image.height * scale);
          const context = canvas.getContext("2d");
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        image.onerror = () => reject(new Error("That image could not be read."));
        image.src = reader.result;
      };
      reader.onerror = () => reject(new Error("That image could not be read."));
      reader.readAsDataURL(file);
    });
  }

  async function handlePhotoChange() {
    const file = els.photo.files && els.photo.files[0];
    if (!file) return;
    try {
      photoPreview = await readImage(file);
      photoFile = file;
      setPhotoPreview(photoPreview);
    } catch (error) {
      els.photo.value = "";
      photoFile = null;
      FT.toast("error", "Photo not accepted", error.message);
    }
  }

  // ------------------------------------------------------------------
  // Events
  // ------------------------------------------------------------------
  function wireEvents() {
    els.search?.addEventListener(
      "input",
      FT.debounce(() => {
        filters.search = els.search.value;
        applyFilters();
      }, 200)
    );

    els.department?.addEventListener("change", () => {
      filters.department = els.department.value;
      applyFilters();
    });
    els.year?.addEventListener("change", () => {
      filters.year = els.year.value;
      applyFilters();
    });
    els.clear?.addEventListener("click", () => {
      filters = { search: "", department: "", year: "" };
      els.search.value = "";
      els.department.value = "";
      els.year.value = "";
      applyFilters();
    });

    els.addBtn?.addEventListener("click", openAddModal);
    els.form?.addEventListener("submit", saveStudent);
    els.photo?.addEventListener("change", handlePhotoChange);

    [els.studentId, els.name, els.email, els.phone, els.departmentField, els.yearField].forEach((input) => {
      input?.addEventListener("input", () => input.classList.remove("is-invalid"));
      input?.addEventListener("change", () => input.classList.remove("is-invalid"));
    });

    els.tableBody?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      const action = button.dataset.action;
      const studentId = button.dataset.id;
      if (action === "view") viewStudent(studentId);
      else if (action === "edit") {
        const student = allStudents.find((item) => item.student_id === studentId);
        openEditModal(student);
      } else if (action === "delete") deleteStudent(studentId);
      else if (action === "add") openAddModal();
      else if (action === "clear") els.clear?.click();
    });

    els.viewEditBtn?.addEventListener("click", () => {
      if (!currentViewStudent) return;
      FT.closeModal(els.viewModal);
      setTimeout(() => openEditModal(currentViewStudent), 200);
    });

    els.studentId?.addEventListener("blur", () => {
      if (!els.studentId.disabled) els.studentId.value = els.studentId.value.trim().toUpperCase();
    });
  }

  async function boot() {
    cacheElements();
    const init = await FT.init({
      active: "students",
      title: "Students",
      subtitle: "Student directory and face registration status",
    });
    if (!init) return;
    setSourceLabel();
    wireEvents();

    const query = FT.queryParam("q");
    if (query) {
      filters.search = query;
      if (els.search) els.search.value = query;
    }
    await loadStudents();

    if (window.location.hash === "#add") {
      setTimeout(openAddModal, 250);
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
