/* ==========================================================================
   FaceTrack - app.js
   Shared front-end core: configuration access, API client, authentication,
   demo-mode data store, layout rendering, notifications, toasts, exports.
   ========================================================================== */

(function () {
  "use strict";

  const CFG = Object.assign(
    {
      API_BASE_URL: "http://127.0.0.1:5000/api",
      APP_NAME: "FaceTrack",
      APP_VERSION: "1.0.0",
      HEALTH_TIMEOUT: 3200,
      REQUEST_TIMEOUT: 12000,
      SCAN_INTERVAL_MS: 2600,
      MAX_FACE_SAMPLES: 5,
      MATCH_THRESHOLD: 72,
      DEMO_STORAGE_KEY: "facetrack_demo_v3",
      SESSION_KEY: "facetrack_session_v3",
      PREFS_KEY: "facetrack_prefs_v1",
    },
    window.FACETRACK_CONFIG || {}
  );

  const API_BASE = String(CFG.API_BASE_URL || "").replace(/\/+$/, "");
  const API_ORIGIN = API_BASE.replace(/\/api$/i, "");

  const state = {
    session: null,
    backendOnline: false,
    health: null,
    demoMode: false,
    checking: true,
    cameraStream: null,
    students: [],
    notifications: [],
  };

  const PAGE_FILES = [
    "index.html",
    "students.html",
    "face-registration.html",
    "attendance.html",
    "records.html",
    "reports.html",
    "settings.html",
  ];

  // ------------------------------------------------------------------------
  // Tiny helpers
  // ------------------------------------------------------------------------
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function debounce(fn, wait = 250) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function isoDate(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function parseISO(value) {
    if (!value) return null;
    const [year, month, day] = String(value).split("-").map(Number);
    return new Date(year, (month || 1) - 1, day || 1);
  }

  function addDays(date, days) {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + days);
    return copy;
  }

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function formatDate(value, options = {}) {
    const date = value instanceof Date ? value : parseISO(value);
    if (!date || Number.isNaN(date.getTime())) return "—";
    if (options.long) {
      return `${DAYS[date.getDay()]}, ${pad(date.getDate())} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
    }
    if (options.short) return `${pad(date.getDate())} ${MONTHS[date.getMonth()]}`;
    if (options.weekday) return `${DAYS[date.getDay()].slice(0, 3)} ${pad(date.getDate())}`;
    return `${pad(date.getDate())} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  }

  function formatTime(value) {
    if (!value) return "—";
    const parts = String(value).split(":");
    if (parts.length < 2) return value;
    let hour = parseInt(parts[0], 10);
    const minute = parts[1];
    const suffix = hour >= 12 ? "PM" : "AM";
    hour = hour % 12 || 12;
    return `${pad(hour)}:${minute} ${suffix}`;
  }

  function nowTime(seconds = true) {
    const now = new Date();
    return `${pad(now.getHours())}:${pad(now.getMinutes())}${seconds ? `:${pad(now.getSeconds())}` : ""}`;
  }

  function timeAgo(value) {
    if (!value) return "";
    const then = new Date(String(value).replace(" ", "T"));
    if (Number.isNaN(then.getTime())) return "";
    const diff = Math.max(0, Date.now() - then.getTime());
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function greeting() {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    if (hour < 21) return "Good evening";
    return "Working late";
  }

  function initials(name) {
    return String(name || "?")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("");
  }

  function avatarColor(seed) {
    let sum = 0;
    for (const char of String(seed || "x")) sum += char.charCodeAt(0);
    const classes = ["", "c2", "c3", "c4", "c5", "c6", "c7"];
    return classes[sum % classes.length];
  }

  function formatNumber(value, digits = 0) {
    return Number(value || 0).toLocaleString("en-IN", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  }

  function todayISO() {
    return isoDate(new Date());
  }

  function daysAgoISO(days) {
    return isoDate(addDays(new Date(), -days));
  }

  function queryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function photoUrlFor(student) {
    if (!student) return null;
    if (student.photo) return student.photo;
    if (student.photo_url) return API_ORIGIN + student.photo_url;
    if (!state.demoMode && state.backendOnline && student.photo_path && student.student_id) {
      return API_ORIGIN + `/api/students/${student.student_id}/photo`;
    }
    return null;
  }

  function avatarHtml(student, extraClass = "", sizeClass = "") {
    const name = student && (student.name || student.student_name) ? student.name || student.student_name : "?";
    const photo = photoUrlFor(student);
    const classes = ["avatar", sizeClass, extraClass, avatarColor(student.student_id || name)]
      .filter(Boolean)
      .join(" ");
    const img = photo
      ? `<img src="${escapeHtml(photo)}" alt="${escapeHtml(name)}" loading="lazy" onerror="this.style.display='none'">`
      : "";
    return `<span class="${classes}" aria-hidden="true"><span class="avatar-initials">${escapeHtml(initials(name))}</span>${img}</span>`;
  }

  function statusBadge(status) {
    const present = String(status).toLowerCase() === "present";
    return `<span class="badge-soft ${present ? "badge-success" : "badge-danger"}"><i class="fa-solid ${present ? "fa-circle-check" : "fa-circle-xmark"}"></i>${present ? "Present" : "Absent"}</span>`;
  }

  function confidenceLabel(value) {
    const score = Number(value);
    if (!Number.isFinite(score)) return "—";
    return `${score.toFixed(1)}%`;
  }

  // ------------------------------------------------------------------------
  // Session
  // ------------------------------------------------------------------------
  function safeParse(value, fallback = null) {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return fallback;
    }
  }

  function getSession() {
    if (state.session) return state.session;
    const session = safeParse(localStorage.getItem(CFG.SESSION_KEY)) || safeParse(sessionStorage.getItem(CFG.SESSION_KEY));
    state.session = session;
    return session;
  }

  function saveSession(session, remember) {
    state.session = session;
    clearStoredSession();
    const storage = remember ? localStorage : sessionStorage;
    storage.setItem(CFG.SESSION_KEY, JSON.stringify(session));
  }

  function clearStoredSession() {
    localStorage.removeItem(CFG.SESSION_KEY);
    sessionStorage.removeItem(CFG.SESSION_KEY);
    state.session = null;
  }

  function updateSessionAdmin(admin) {
    const session = getSession();
    if (!session) return;
    session.admin = Object.assign({}, session.admin, admin);
    state.session = session;
    const storage = localStorage.getItem(CFG.SESSION_KEY) ? localStorage : sessionStorage;
    storage.setItem(CFG.SESSION_KEY, JSON.stringify(session));
  }

  function getAdmin() {
    const session = getSession();
    if (session && session.admin) return session.admin;
    if (state.demoMode) return demo.data.admin;
    return { name: "Administrator", email: "admin@facetrack.com", role: "Administrator" };
  }

  function isDemo() {
    return state.demoMode;
  }

  function redirectToLogin(reason) {
    const next = encodeURIComponent(window.location.pathname.split("/").pop() + window.location.search);
    window.location.replace(`login.html?${reason ? `reason=${reason}&` : ""}next=${next}`);
  }

  function requireAuth() {
    const session = getSession();
    if (!session) {
      redirectToLogin("auth");
      return null;
    }
    if (session.expires_at && Date.now() > session.expires_at) {
      clearStoredSession();
      redirectToLogin("expired");
      return null;
    }
    return session;
  }

  // ------------------------------------------------------------------------
  // API client
  // ------------------------------------------------------------------------
  class FTError extends Error {
    constructor(message, status = 0, code = null, payload = null) {
      super(message);
      this.name = "FTError";
      this.status = status;
      this.code = code;
      this.payload = payload;
    }
  }

  async function rawFetch(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeout || CFG.REQUEST_TIMEOUT);
    try {
      return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
    } finally {
      clearTimeout(timer);
    }
  }

  async function api(path, options = {}) {
    const session = getSession();
    const headers = Object.assign({ Accept: "application/json" }, options.headers || {});
    let body = options.body;
    if (body && !(body instanceof FormData) && typeof body !== "string") {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(body);
    }
    if (options.auth !== false && session && session.token) {
      headers.Authorization = `Bearer ${session.token}`;
    }

    let response;
    try {
      response = await rawFetch(API_BASE + (path.startsWith("/") ? path : `/${path}`), {
        method: options.method || "GET",
        headers,
        body,
        timeout: options.timeout,
        cache: "no-store",
      });
    } catch (error) {
      throw new FTError(
        error.name === "AbortError"
          ? "The backend took too long to respond. Check that Flask is running."
          : "Cannot reach the Flask backend. Start it with: python app.py",
        0,
        "NETWORK_ERROR"
      );
    }

    let payload = null;
    const contentType = response.headers.get("Content-Type") || "";
    if (contentType.includes("application/json")) {
      payload = await response.json().catch(() => null);
    }

    if (!response.ok) {
      if (response.status === 401 && options.auth !== false) {
        clearStoredSession();
        redirectToLogin("expired");
      }
      throw new FTError(
        (payload && payload.error) || `Request failed (HTTP ${response.status}).`,
        response.status,
        payload && payload.code,
        payload
      );
    }
    return payload || { success: true };
  }

  async function checkBackend() {
    state.checking = true;
    try {
      const response = await rawFetch(`${API_BASE}/health`, {
        timeout: CFG.HEALTH_TIMEOUT,
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const data = await response.json().catch(() => null);
      state.backendOnline = Boolean(response.ok && data && data.status);
      state.health = data;
    } catch (_error) {
      state.backendOnline = false;
      state.health = null;
    }
    state.checking = false;
    return state.backendOnline;
  }

  // ------------------------------------------------------------------------
  // Realistic demo-mode store (localStorage only)
  // ------------------------------------------------------------------------
  const DEMO_STUDENTS = [
    ["CSE2023001", "Aarav Sharma", "Computer Science", "III Year", "A", "aarav.sharma@facetrack.edu", "9876543210"],
    ["CSE2023002", "Diya Patel", "Computer Science", "III Year", "A", "diya.patel@facetrack.edu", "9876543211"],
    ["CSE2023003", "Rohan Verma", "Computer Science", "III Year", "B", "rohan.verma@facetrack.edu", "9876543212"],
    ["IT2023004", "Ananya Iyer", "Information Technology", "III Year", "A", "ananya.iyer@facetrack.edu", "9876543213"],
    ["IT2023005", "Kabir Singh", "Information Technology", "III Year", "A", "kabir.singh@facetrack.edu", "9876543214"],
    ["ECE2023006", "Meera Nair", "Electronics & Comm.", "II Year", "A", "meera.nair@facetrack.edu", "9876543215"],
    ["ECE2023007", "Arjun Reddy", "Electronics & Comm.", "II Year", "B", "arjun.reddy@facetrack.edu", "9876543216"],
    ["ME2023008", "Ishita Gupta", "Mechanical Engg.", "II Year", "A", "ishita.gupta@facetrack.edu", "9876543217"],
    ["ME2023009", "Vivaan Joshi", "Mechanical Engg.", "II Year", "B", "vivaan.joshi@facetrack.edu", "9876543218"],
    ["EEE2023010", "Sara Khan", "Electrical & Electronics", "III Year", "A", "sara.khan@facetrack.edu", "9876543219"],
    ["CSE2023011", "Aditya Rao", "Computer Science", "IV Year", "A", "aditya.rao@facetrack.edu", "9876543220"],
    ["IT2023012", "Nisha Kulkarni", "Information Technology", "IV Year", "B", "nisha.kulkarni@facetrack.edu", "9876543221"],
    ["ECE2023013", "Dev Malhotra", "Electronics & Comm.", "III Year", "A", "dev.malhotra@facetrack.edu", "9876543222"],
    ["AIML2023014", "Riya Chatterjee", "AI & Machine Learning", "II Year", "A", "riya.chatterjee@facetrack.edu", "9876543223"],
    ["AIML2023015", "Karthik Menon", "AI & Machine Learning", "III Year", "B", "karthik.menon@facetrack.edu", "9876543224"],
  ];

  function mulberry32(seed) {
    let value = seed >>> 0;
    return function random() {
      value += 0x6d2b79f5;
      let t = value;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const demo = {
    data: null,

    load() {
      const stored = safeParse(localStorage.getItem(CFG.DEMO_STORAGE_KEY));
      if (stored && stored.version === 3 && Array.isArray(stored.students) && Array.isArray(stored.attendance)) {
        this.data = stored;
      } else {
        this.data = this.seed();
        this.save();
      }
      this.ensureToday();
      return this.data;
    },

    save() {
      if (!this.data) return;
      try {
        localStorage.setItem(CFG.DEMO_STORAGE_KEY, JSON.stringify(this.data));
      } catch (error) {
        console.warn("Demo data could not be saved in localStorage.", error);
      }
    },

    reset() {
      this.data = this.seed();
      this.save();
      return this.data;
    },

    seed() {
      const rng = mulberry32(20261109);
      const students = DEMO_STUDENTS.map((row, index) => ({
        id: index + 1,
        student_id: row[0],
        name: row[1],
        department: row[2],
        year: row[3],
        section: row[4],
        email: row[5],
        phone: row[6],
        photo: null,
        face_registered: index < 10,
        face_samples: index < 10 ? 5 : 0,
        created_at: new Date().toISOString(),
      }));

      const reliability = {};
      students.forEach((student) => {
        reliability[student.student_id] = 0.8 + rng() * 0.17;
      });

      const attendance = [];
      let attendanceId = 1;
      const today = new Date();
      for (let daysBack = 74; daysBack >= 0; daysBack -= 1) {
        const day = addDays(today, -daysBack);
        if (day.getDay() === 0) continue; // Sunday holiday
        students.forEach((student) => {
          const chance = reliability[student.student_id] - (day.getDay() === 1 ? 0.04 : 0);
          if (rng() < chance) {
            const hour = 8 + (rng() > 0.85 ? 1 : 0);
            const minute = hour === 9 ? Math.floor(rng() * 34) : 48 + Math.floor(rng() * 12);
            attendance.push({
              id: attendanceId++,
              student_id: student.student_id,
              date: isoDate(day),
              time: `${pad(hour)}:${pad(minute)}:${pad(Math.floor(rng() * 60))}`,
              status: "Present",
              confidence: Math.round((82 + rng() * 16) * 10) / 10,
              marked_by: "Face Recognition",
            });
          }
        });
      }

      // Make sure the current-day dashboard looks alive.
      const todayString = isoDate(today);
      const presentToday = new Set(
        attendance.filter((row) => row.date === todayString).map((row) => row.student_id)
      );
      const missing = students.filter((student) => !presentToday.has(student.student_id));
      missing.slice(0, Math.max(0, 11 - presentToday.size)).forEach((student) => {
        attendance.push({
          id: attendanceId++,
          student_id: student.student_id,
          date: todayString,
          time: `09:${pad(Math.floor(rng() * 30))}:${pad(Math.floor(rng() * 60))}`,
          status: "Present",
          confidence: Math.round((84 + rng() * 14) * 10) / 10,
          marked_by: "Face Recognition",
        });
      });

      return {
        version: 3,
        createdAt: new Date().toISOString(),
        admin: {
          name: "Dr. Rakesh Menon",
          email: "admin@facetrack.com",
          role: "Administrator",
          password: "Admin@123",
          created_at: new Date().toISOString(),
        },
        students,
        attendance,
        nextAttendanceId: attendanceId,
        nextStudentId: students.length + 1,
      };
    },

    ensureToday() {
      const today = todayISO();
      const hasToday = this.data.attendance.some((row) => row.date === today);
      if (hasToday) return;
      const rng = mulberry32(Date.now() % 100000);
      const present = this.data.students.filter(() => rng() < 0.74).slice(0, 11);
      present.forEach((student) => {
        this.data.attendance.push({
          id: this.data.nextAttendanceId++,
          student_id: student.student_id,
          date: today,
          time: `09:${pad(Math.floor(rng() * 32))}:${pad(Math.floor(rng() * 60))}`,
          status: "Present",
          confidence: Math.round((83 + rng() * 14) * 10) / 10,
          marked_by: "Face Recognition",
        });
      });
      this.save();
    },

    listStudents(filters = {}) {
      const search = (filters.search || "").toLowerCase().trim();
      const department = filters.department || "";
      const year = filters.year || "";
      return this.data.students
        .filter((student) => {
          if (department && student.department !== department) return false;
          if (year && student.year !== year) return false;
          if (search) {
            const haystack = `${student.name} ${student.student_id} ${student.email} ${student.phone}`.toLowerCase();
            if (!haystack.includes(search)) return false;
          }
          return true;
        })
        .slice()
        .sort((a, b) => a.id - b.id);
    },

    getStudent(studentId) {
      return this.data.students.find((student) => student.student_id === studentId) || null;
    },

    addStudent(payload) {
      if (this.getStudent(payload.student_id)) {
        throw new FTError("A student with this ID already exists.", 409, "DUPLICATE_STUDENT_ID");
      }
      const student = {
        id: this.data.nextStudentId++,
        student_id: payload.student_id,
        name: payload.name,
        department: payload.department,
        year: payload.year,
        section: payload.section || "A",
        email: payload.email || "",
        phone: payload.phone || "",
        photo: payload.photo || null,
        face_registered: false,
        face_samples: 0,
        created_at: new Date().toISOString(),
      };
      this.data.students.push(student);
      this.save();
      return student;
    },

    updateStudent(studentId, payload) {
      const student = this.getStudent(studentId);
      if (!student) throw new FTError("Student not found.", 404, "NOT_FOUND");
      Object.assign(student, {
        name: payload.name,
        department: payload.department,
        year: payload.year,
        section: payload.section || student.section,
        email: payload.email || "",
        phone: payload.phone || "",
      });
      if (payload.photo) student.photo = payload.photo;
      this.save();
      return student;
    },

    deleteStudent(studentId) {
      this.data.students = this.data.students.filter((student) => student.student_id !== studentId);
      this.data.attendance = this.data.attendance.filter((row) => row.student_id !== studentId);
      this.save();
    },

    todayRecords() {
      return this.data.attendance.filter((row) => row.date === todayISO());
    },

    markAttendance(studentId, confidence, markedBy = "Admin (Manual)") {
      const student = this.getStudent(studentId);
      if (!student) return { success: false, error: "Student not found." };
      const existing = this.data.attendance.find(
        (row) => row.student_id === studentId && row.date === todayISO()
      );
      if (existing) {
        return {
          success: true,
          already_marked: true,
          message: `Attendance already recorded today for ${student.name}`,
          attendance: Object.assign({}, existing, { name: student.name, department: student.department }),
        };
      }
      const row = {
        id: this.data.nextAttendanceId++,
        student_id: studentId,
        date: todayISO(),
        time: nowTime(),
        status: "Present",
        confidence: confidence == null ? null : Math.round(confidence * 10) / 10,
        marked_by: markedBy,
      };
      this.data.attendance.push(row);
      this.save();
      return {
        success: true,
        already_marked: false,
        message: `Attendance marked for ${student.name}`,
        attendance: Object.assign({}, row, { name: student.name, department: student.department }),
      };
    },

    simulateScan() {
      if (!this.data.students.length) return { success: false, error: "No demo students available." };
      const present = new Set(this.todayRecords().map((row) => row.student_id));
      const candidates = this.data.students.filter(
        (student) => student.face_registered && !present.has(student.student_id)
      );
      if (!candidates.length) {
        return { success: false, code: "ALL_PRESENT", error: "Every demo student with a registered face is already present today." };
      }
      const student = candidates[Math.floor(Math.random() * candidates.length)];
      const confidence = Math.round((88 + Math.random() * 9) * 10) / 10;
      const result = this.markAttendance(student.student_id, confidence, "Demo Simulation");
      return Object.assign(result, {
        simulated: true,
        student_id: student.student_id,
        name: student.name,
        department: student.department,
        confidence,
      });
    },

    classesInRange(from, to) {
      const dates = new Set(
        this.data.attendance
          .filter((row) => (!from || row.date >= from) && (!to || row.date <= to))
          .map((row) => row.date)
      );
      return dates.size;
    },

    daily(date, filters = {}) {
      const day = date || todayISO();
      const rows = this.data.students.map((student) => {
        const record = this.data.attendance.find(
          (row) => row.student_id === student.student_id && row.date === day
        );
        return {
          student_id: student.student_id,
          name: student.name,
          department: student.department,
          year: student.year,
          section: student.section,
          email: student.email,
          phone: student.phone,
          photo: student.photo,
          face_registered: student.face_registered,
          status: record ? "Present" : "Absent",
          time: record ? record.time : null,
          confidence: record ? record.confidence : null,
          marked_by: record ? record.marked_by : null,
          date: day,
        };
      });
      let filtered = rows;
      if (filters.search) {
        const needle = filters.search.toLowerCase();
        filtered = filtered.filter((row) =>
          `${row.name} ${row.student_id}`.toLowerCase().includes(needle)
        );
      }
      if (filters.department) filtered = filtered.filter((row) => row.department === filters.department);
      if (filters.status) filtered = filtered.filter((row) => row.status === filters.status);
      const present = filtered.filter((row) => row.status === "Present").length;
      return {
        date: day,
        summary: {
          total: filtered.length,
          present,
          absent: filtered.length - present,
          percentage: filtered.length ? Math.round((present / filtered.length) * 1000) / 10 : 0,
        },
        records: filtered,
      };
    },

    weekly(days = 7) {
      const total = this.data.students.length;
      const result = [];
      let cursor = new Date();
      while (result.length < days) {
        if (cursor.getDay() !== 0) {
          const date = isoDate(cursor);
          const present = this.data.attendance.filter((row) => row.date === date).length;
          result.push({
            date,
            label: `${DAYS[cursor.getDay()].slice(0, 3)} ${pad(cursor.getDate())}`,
            present,
            absent: Math.max(total - present, 0),
            percentage: total ? Math.round((present / total) * 1000) / 10 : 0,
            is_today: date === todayISO(),
          });
        }
        cursor = addDays(cursor, -1);
      }
      return result.reverse();
    },

    monthly(months = 6) {
      const total = this.data.students.length;
      const today = new Date();
      const result = [];
      for (let offset = months - 1; offset >= 0; offset -= 1) {
        const first = new Date(today.getFullYear(), today.getMonth() - offset, 1);
        const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
        const end = last > today ? today : last;
        const from = isoDate(first);
        const to = isoDate(end);
        const rows = this.data.attendance.filter((row) => row.date >= from && row.date <= to);
        const classes = new Set(rows.map((row) => row.date)).size;
        const percentage = classes && total ? Math.round((rows.length / (classes * total)) * 1000) / 10 : 0;
        result.push({
          month: MONTHS[first.getMonth()],
          label: `${MONTHS[first.getMonth()]} ${first.getFullYear()}`,
          present: rows.length,
          percentage,
          classes,
        });
      }
      return result;
    },

    recent(limit = 8) {
      return this.data.attendance
        .slice()
        .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
        .slice(0, limit)
        .map((row) => {
          const student = this.getStudent(row.student_id) || {};
          return Object.assign({}, row, {
            name: student.name || "Unknown",
            department: student.department || "—",
            year: student.year || "",
            section: student.section || "",
            photo: student.photo || null,
          });
        });
    },

    departments() {
      const map = new Map();
      this.data.students.forEach((student) => {
        if (!map.has(student.department)) map.set(student.department, []);
        map.get(student.department).push(student);
      });
      return Array.from(map.entries()).map(([department, students]) => {
        const classes = this.classesInRange(daysAgoISO(60), todayISO());
        const present = this.data.attendance.filter(
          (row) => row.date >= daysAgoISO(60) && students.some((s) => s.student_id === row.student_id)
        ).length;
        return {
          department,
          students: students.length,
          present,
          percentage: classes && students.length ? Math.round((present / (classes * students.length)) * 1000) / 10 : 0,
        };
      });
    },

    studentSummaries(from, to) {
      const classes = this.classesInRange(from, to);
      return this.data.students.map((student) => {
        const present = this.data.attendance.filter(
          (row) =>
            row.student_id === student.student_id &&
            (!from || row.date >= from) &&
            (!to || row.date <= to)
        ).length;
        return {
          student_id: student.student_id,
          name: student.name,
          department: student.department,
          year: student.year,
          section: student.section,
          face_registered: student.face_registered,
          present,
          classes_held: classes,
          absences: Math.max(classes - present, 0),
          percentage: classes ? Math.round((present / classes) * 1000) / 10 : 0,
        };
      });
    },

    dashboard() {
      const total = this.data.students.length;
      const presentToday = this.todayRecords().length;
      const yesterday = isoDate(addDays(new Date(), -1));
      const yesterdayPresent = this.data.attendance.filter((row) => row.date === yesterday).length;
      const faceRegistered = this.data.students.filter((student) => student.face_registered).length;
      return {
        total_students: total,
        present_today: presentToday,
        absent_today: Math.max(total - presentToday, 0),
        attendance_percentage: total ? Math.round((presentToday / total) * 1000) / 10 : 0,
        yesterday_percentage: total ? Math.round((yesterdayPresent / total) * 1000) / 10 : 0,
        face_registered: faceRegistered,
        total_attendance_records: this.data.attendance.length,
        date: todayISO(),
      };
    },

    reportOverview(from, to) {
      const start = from || daysAgoISO(29);
      const end = to || todayISO();
      const total = this.data.students.length;
      const classes = this.classesInRange(start, end);
      const present = this.data.attendance.filter((row) => row.date >= start && row.date <= end).length;
      const possible = classes * total;
      const students = this.studentSummaries(start, end);
      const best = students.slice().sort((a, b) => b.percentage - a.percentage)[0] || null;

      // Weekly buckets (last 8 weeks)
      const weekly = [];
      const now = new Date();
      const currentMonday = addDays(now, -((now.getDay() + 6) % 7));
      for (let offset = 7; offset >= 0; offset -= 1) {
        const weekStart = addDays(currentMonday, -offset * 7);
        const weekEnd = addDays(weekStart, 6);
        const fromWeek = isoDate(weekStart);
        const toWeek = isoDate(weekEnd > now ? now : weekEnd);
        const rows = this.data.attendance.filter((row) => row.date >= fromWeek && row.date <= toWeek);
        const weekClasses = new Set(rows.map((row) => row.date)).size;
        weekly.push({
          week: Math.ceil(((weekStart - new Date(weekStart.getFullYear(), 0, 1)) / 86400000 + 1) / 7),
          label: `W${Math.ceil(((weekStart - new Date(weekStart.getFullYear(), 0, 1)) / 86400000 + 1) / 7)}`,
          range: `${formatDate(weekStart, { short: true })} - ${formatDate(toWeek, { short: true })}`,
          present: rows.length,
          percentage: weekClasses && total ? Math.round((rows.length / (weekClasses * total)) * 1000) / 10 : 0,
        });
      }

      return {
        from: start,
        to: end,
        summary: {
          total_students: total,
          classes_held: classes,
          present,
          absent: Math.max(possible - present, 0),
          percentage: possible ? Math.round((present / possible) * 1000) / 10 : 0,
          best_student: best,
        },
        daily: this.weekly(7),
        weekly,
        monthly: this.monthly(6),
        departments: this.departments(),
        students,
      };
    },

    exportRows(from, to, search = "", department = "") {
      const needle = String(search || "").trim().toLowerCase();
      return this.data.attendance
        .filter((row) => {
          if (from && row.date < from) return false;
          if (to && row.date > to) return false;
          if (department) {
            const student = this.getStudent(row.student_id);
            if (!student || student.department !== department) return false;
          }
          if (needle) {
            const student = this.getStudent(row.student_id) || {};
            const haystack = `${row.student_id} ${student.name || ""}`.toLowerCase();
            if (!haystack.includes(needle)) return false;
          }
          return true;
        })
        .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
        .map((row) => {
          const student = this.getStudent(row.student_id) || {};
          return {
            date: row.date,
            time: row.time,
            student_id: row.student_id,
            name: student.name || "",
            department: student.department || "",
            year: student.year || "",
            section: student.section || "",
            status: row.status,
            confidence: row.confidence,
            marked_by: row.marked_by,
          };
        });
    },
  };

  // ------------------------------------------------------------------------
  // Unified data access (live API or demo)
  // ------------------------------------------------------------------------
  const data = {
    async getStudents(filters = {}) {
      if (state.demoMode) {
        const students = demo.listStudents(filters);
        return { students, count: students.length, departments: Array.from(new Set(demo.data.students.map((s) => s.department))) };
      }
      const params = new URLSearchParams();
      if (filters.search) params.set("search", filters.search);
      if (filters.department) params.set("department", filters.department);
      if (filters.year) params.set("year", filters.year);
      return api(`/students?${params.toString()}`);
    },

    async getStudent(studentId) {
      if (state.demoMode) {
        const student = demo.getStudent(studentId);
        if (!student) throw new FTError("Student not found.", 404, "NOT_FOUND");
        const summary = demo.studentSummaries(daysAgoISO(30), todayISO()).find(
          (row) => row.student_id === studentId
        );
        return {
          student: Object.assign({}, student, {
            attendance_summary: summary
              ? {
                  classes_held: summary.classes_held,
                  present: summary.present,
                  absent: summary.absences,
                  percentage: summary.percentage,
                }
              : null,
          }),
        };
      }
      return api(`/students/${encodeURIComponent(studentId)}`);
    },

    async createStudent(payload) {
      if (state.demoMode) return { message: "Student added successfully (demo).", student: demo.addStudent(payload) };
      return api("/students", { method: "POST", body: payload });
    },

    async updateStudent(studentId, payload) {
      if (state.demoMode) {
        return { message: "Student updated successfully (demo).", student: demo.updateStudent(studentId, payload) };
      }
      return api(`/students/${encodeURIComponent(studentId)}`, { method: "PUT", body: payload });
    },

    async deleteStudent(studentId) {
      if (state.demoMode) {
        demo.deleteStudent(studentId);
        return { message: "Student deleted (demo)." };
      }
      return api(`/students/${encodeURIComponent(studentId)}`, { method: "DELETE" });
    },

    async uploadStudentPhoto(studentId, file) {
      if (state.demoMode) return { photo: null };
      const form = new FormData();
      form.append("photo", file);
      return api(`/students/${encodeURIComponent(studentId)}/photo`, { method: "POST", body: form });
    },

    async getDashboard() {
      if (state.demoMode) {
        const stats = demo.dashboard();
        return {
          stats,
          recent: demo.recent(8),
          weekly: demo.weekly(7),
          monthly: demo.monthly(6),
          departments: demo.departments(),
        };
      }
      return api("/dashboard/stats");
    },

    async getDaily(params = {}) {
      if (state.demoMode) return demo.daily(params.date, params);
      const query = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value) query.set(key, value);
      });
      return api(`/attendance/daily?${query.toString()}`);
    },

    async markAttendance(studentId) {
      if (state.demoMode) return demo.markAttendance(studentId, null, "Admin (Manual)");
      return api("/attendance/mark", { method: "POST", body: { student_id: studentId } });
    },

    async getStudentHistory(studentId, from, to) {
      if (state.demoMode) {
        const summaries = demo.studentSummaries(from, to);
        const summary = summaries.find((row) => row.student_id === studentId);
        if (!summary) throw new FTError("Student not found.", 404, "NOT_FOUND");
        const rows = demo.exportRows(from, to, studentId);
        return {
          student: demo.getStudent(studentId),
          from,
          to,
          classes_held: summary.classes_held,
          present: summary.present,
          absent: summary.absences,
          percentage: summary.percentage,
          records: rows,
        };
      }
      const query = new URLSearchParams();
      if (from) query.set("from", from);
      if (to) query.set("to", to);
      return api(`/attendance/student/${encodeURIComponent(studentId)}?${query.toString()}`);
    },

    async getStudentSummaries(from, to) {
      if (state.demoMode) {
        return { from: from || daysAgoISO(29), to: to || todayISO(), students: demo.studentSummaries(from, to) };
      }
      const query = new URLSearchParams();
      if (from) query.set("from", from);
      if (to) query.set("to", to);
      return api(`/reports/students?${query.toString()}`);
    },

    async getReportOverview(from, to) {
      if (state.demoMode) return demo.reportOverview(from, to);
      const query = new URLSearchParams();
      if (from) query.set("from", from);
      if (to) query.set("to", to);
      return api(`/reports/overview?${query.toString()}`);
    },

    async getRecognitionSummary() {
      if (state.demoMode) {
        const stats = demo.dashboard();
        return {
          summary: {
            date: todayISO(),
            total_students: stats.total_students,
            present: stats.present_today,
            absent: stats.absent_today,
            percentage: stats.attendance_percentage,
            recent: demo.recent(20),
          },
        };
      }
      return api("/attendance/summary");
    },

    async getFaceStatus(studentId) {
      if (state.demoMode) {
        const student = demo.getStudent(studentId);
        return {
          student_id: studentId,
          count: student ? student.face_samples : 0,
          samples: [],
          face_registered: student ? student.face_registered : false,
          engine: { engine_ready: false, lbph_available: false, model_trained: false },
        };
      }
      return api(`/faces/status/${encodeURIComponent(studentId)}`);
    },

    async getFaceModel() {
      if (state.demoMode) {
        return {
          capabilities: { engine_ready: false, lbph_available: false, model_trained: false, opencv_installed: false },
          model: null,
          recommended_samples: 5,
          session: { active: false },
        };
      }
      return api("/faces/model");
    },

    async registerFace(studentId, image, train = true) {
      if (state.demoMode) {
        throw new FTError(
          "Face registration is disabled in Demo Mode. Start the Flask backend with opencv-contrib-python to capture real samples.",
          503,
          "DEMO_MODE"
        );
      }
      return api("/faces/register", { method: "POST", body: { student_id: studentId, image, train } });
    },

    async validateFace(image) {
      if (state.demoMode) {
        throw new FTError(
          "Face validation is disabled in Demo Mode. It requires OpenCV on the Flask backend.",
          503,
          "DEMO_MODE"
        );
      }
      return api("/faces/validate", { method: "POST", body: { image } });
    },

    async trainModel() {
      if (state.demoMode) {
        throw new FTError("Model training is disabled in Demo Mode.", 503, "DEMO_MODE");
      }
      return api("/faces/train", { method: "POST" });
    },

    async startRecognition() {
      if (state.demoMode) {
        throw new FTError("Live face recognition needs the Flask + OpenCV backend.", 503, "DEMO_MODE");
      }
      return api("/recognition/start", { method: "POST" });
    },

    async stopRecognition() {
      if (state.demoMode) return { success: true, session: { active: false } };
      return api("/recognition/stop", { method: "POST" });
    },

    async recognizeFrame(image) {
      if (state.demoMode) {
        throw new FTError("Face recognition is disabled in Demo Mode.", 503, "DEMO_MODE");
      }
      return api("/recognition/recognize", { method: "POST", body: { image } });
    },

    async getRecognitionStatus() {
      if (state.demoMode) return { simulation: true };
      return api("/recognition/status");
    },

    async getSystemInfo() {
      if (state.demoMode) {
        return {
          app: "FaceTrack",
          tagline: "Smart Face Recognition Attendance System",
          version: CFG.APP_VERSION,
          python: "— (demo mode)",
          database: "Browser localStorage (demo)",
          database_path: "localStorage → " + CFG.DEMO_STORAGE_KEY,
          face_engine: { engine_ready: false, lbph_available: false, model_trained: false },
          model: null,
          threshold: CFG.MATCH_THRESHOLD,
          counts: {
            students: demo.data.students.length,
            attendance: demo.data.attendance.length,
            face_samples: demo.data.students.reduce((sum, s) => sum + (s.face_samples || 0), 0),
            admins: 1,
          },
          demo: true,
        };
      }
      return api("/settings/system");
    },

    async updateProfile(name, email) {
      if (state.demoMode) {
        if (demo.data.admin.email !== email) {
          const duplicate = demo.data.admin.email === email;
          if (duplicate) throw new FTError("Email unchanged.", 200);
        }
        demo.data.admin.name = name;
        demo.data.admin.email = email;
        demo.save();
        updateSessionAdmin({ name, email });
        return { message: "Profile updated (demo).", admin: demo.data.admin };
      }
      return api("/admin/profile", { method: "PUT", body: { name, email } });
    },

    async changePassword(currentPassword, newPassword) {
      if (state.demoMode) {
        if (currentPassword !== demo.data.admin.password) {
          throw new FTError("Current password is incorrect.", 400, "WRONG_PASSWORD");
        }
        if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
          throw new FTError("Use at least 8 characters with a letter and a number.", 400, "WEAK_PASSWORD");
        }
        demo.data.admin.password = newPassword;
        demo.save();
        return { message: "Password changed (demo mode)." };
      }
      return api("/admin/change-password", {
        method: "POST",
        body: { current_password: currentPassword, new_password: newPassword },
      });
    },
  };

  // ------------------------------------------------------------------------
  // Layout
  // ------------------------------------------------------------------------
  const NAV_ITEMS = [
    { section: "Main Menu" },
    { key: "dashboard", label: "Dashboard", icon: "fa-chart-pie", href: "index.html" },
    { key: "students", label: "Students", icon: "fa-user-graduate", href: "students.html" },
    { key: "registration", label: "Face Registration", icon: "fa-user-shield", href: "face-registration.html" },
    { key: "attendance", label: "Take Attendance", icon: "fa-camera-retro", href: "attendance.html", badge: "Live" },
    { key: "records", label: "Attendance Records", icon: "fa-clipboard-check", href: "records.html" },
    { key: "reports", label: "Reports & Analytics", icon: "fa-chart-line", href: "reports.html" },
    { section: "System" },
    { key: "settings", label: "Settings", icon: "fa-gear", href: "settings.html" },
  ];

  function renderShell(active, title, subtitle) {
    const admin = getAdmin();
    const sidebar = $("#sidebar");
    if (!sidebar) return;
    const navHtml = NAV_ITEMS.map((item) => {
      if (item.section) return `<p class="nav-label">${item.section}</p>`;
      const isActive = item.key === active;
      return `
        <a href="${item.href}" class="nav-item ${isActive ? "active" : ""}" ${isActive ? 'aria-current="page"' : ""}>
          <span class="nav-icon"><i class="fa-solid ${item.icon}"></i></span>
          <span>${item.label}</span>
          ${item.badge ? `<span class="nav-badge">${item.badge}</span>` : ""}
        </a>`;
    }).join("");

    sidebar.innerHTML = `
      <div class="sidebar-brand">
        <a href="index.html" class="brand-link" aria-label="FaceTrack home">
          <img src="assets/images/logo.svg" alt="FaceTrack logo" class="brand-logo" width="42" height="42">
          <span class="brand-text">
            <span class="brand-name">Face<span>Track</span></span>
            <span class="brand-tagline">Smart Attendance</span>
          </span>
        </a>
        <button class="sidebar-close" id="sidebarClose" type="button" aria-label="Close menu">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <div class="sidebar-scroll">
        <nav class="sidebar-nav" aria-label="Primary navigation">${navHtml}</nav>
      </div>
      <div class="sidebar-footer">
        <div class="sidebar-status" id="sidebarStatus">
          <span class="status-dot ${state.backendOnline ? "" : "pending"}"></span>
          <strong>${state.backendOnline ? (state.demoMode ? "Demo data" : "Live API") : "Demo mode"}</strong>
          <span>${state.backendOnline ? (state.demoMode ? "sample only" : "connected") : "offline"}</span>
        </div>
        <div class="sidebar-admin">
          ${avatarHtml({ name: admin.name, student_id: admin.email, photo: admin.photo }, "", "avatar-sm")}
          <div class="admin-meta">
            <span class="admin-name">${escapeHtml(admin.name || "Administrator")}</span>
            <span class="admin-role">${escapeHtml(admin.role || "Administrator")}</span>
          </div>
          <a href="settings.html" class="admin-gear" aria-label="Admin settings"><i class="fa-solid fa-gear"></i></a>
        </div>
        <a href="#" class="logout-link" id="sidebarLogout"><i class="fa-solid fa-arrow-right-from-bracket"></i> Sign out</a>
      </div>`;

    const topbar = $("#topbar");
    if (topbar) {
      topbar.classList.add("topbar");
      topbar.innerHTML = `
        <button class="topbar-toggle" id="sidebarToggle" type="button" aria-label="Open menu">
          <i class="fa-solid fa-bars"></i>
        </button>
        <div class="topbar-title">
          <h1>${escapeHtml(title || "Dashboard")}</h1>
          <p>${escapeHtml(subtitle || "Smart Face Recognition Attendance System")}</p>
        </div>
        <div class="topbar-search">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input type="search" id="globalSearch" placeholder="Search students or IDs…" autocomplete="off" aria-label="Search students">
        </div>
        <div class="topbar-actions">
          <span class="demo-mode-pill"><i class="fa-solid fa-flask"></i> Demo mode</span>
          <div class="date-chip d-none d-md-flex">
            <i class="fa-regular fa-calendar"></i>
            <span>${formatDate(new Date(), { weekday: true })} ${new Date().getFullYear()}</span>
          </div>
          <div class="dropdown">
            <button class="icon-btn" type="button" data-bs-toggle="dropdown" data-bs-auto-close="outside" aria-expanded="false" aria-label="Notifications">
              <i class="fa-regular fa-bell"></i>
              <span class="notification-dot" id="notificationDot"></span>
            </button>
            <div class="dropdown-menu dropdown-menu-end notification-menu">
              <div class="notification-head">
                <strong>Notifications</strong>
                <span id="notificationCount">Today</span>
              </div>
              <div class="notification-list" id="notificationList">
                <div class="notification-empty"><i class="fa-regular fa-bell-slash"></i>Loading…</div>
              </div>
            </div>
          </div>
          <div class="dropdown">
            <button class="profile-btn" type="button" data-bs-toggle="dropdown" aria-expanded="false">
              ${avatarHtml({ name: admin.name, student_id: admin.email, photo: admin.photo }, "", "avatar-sm")}
              <span class="profile-meta">
                <span class="profile-name">${escapeHtml(admin.name || "Administrator")}</span>
                <span class="profile-role">${escapeHtml(admin.role || "Administrator")}</span>
              </span>
              <i class="fa-solid fa-chevron-down"></i>
            </button>
            <div class="dropdown-menu dropdown-menu-end">
              <a class="dropdown-item" href="settings.html"><i class="fa-solid fa-user-gear"></i> Admin profile</a>
              <a class="dropdown-item" href="settings.html#camera"><i class="fa-solid fa-video"></i> Camera settings</a>
              <a class="dropdown-item" href="reports.html"><i class="fa-solid fa-chart-line"></i> Reports</a>
              <div class="dropdown-divider"></div>
              <button class="dropdown-item text-danger" type="button" id="topbarLogout">
                <i class="fa-solid fa-arrow-right-from-bracket"></i> Sign out
              </button>
            </div>
          </div>
        </div>`;
    }

    const overlay = document.createElement("div");
    overlay.className = "sidebar-overlay";
    overlay.id = "sidebarOverlay";
    document.body.appendChild(overlay);

    wireShell();
    updateBackendIndicators();
  }

  function wireShell() {
    const sidebar = $("#sidebar");
    const overlay = $("#sidebarOverlay");
    const close = () => {
      sidebar.classList.remove("open");
      overlay.classList.remove("show");
      document.body.style.overflow = "";
    };
    const open = () => {
      sidebar.classList.add("open");
      overlay.classList.add("show");
      document.body.style.overflow = "hidden";
    };

    $("#sidebarToggle")?.addEventListener("click", open);
    $("#sidebarClose")?.addEventListener("click", close);
    overlay?.addEventListener("click", close);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
    });
    window.addEventListener("resize", () => {
      if (window.innerWidth > 991) close();
    });

    $("#sidebarLogout")?.addEventListener("click", (event) => {
      event.preventDefault();
      logout();
    });
    $("#topbarLogout")?.addEventListener("click", () => logout());

    const search = $("#globalSearch");
    search?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        const query = search.value.trim();
        window.location.href = `students.html${query ? `?q=${encodeURIComponent(query)}` : ""}`;
      }
    });
  }

  function updateBackendIndicators() {
    document.body.classList.toggle("demo-mode", state.demoMode);
    const status = $("#sidebarStatus");
    if (!status) return;
    let dot = "";
    let label = "";
    let sub = "";
    if (!state.backendOnline) {
      dot = "pending";
      label = "Demo mode";
      sub = "offline";
    } else if (state.demoMode) {
      dot = "pending";
      label = "Demo data";
      sub = "sample only";
    } else {
      dot = "";
      label = "Live API";
      sub = "connected";
    }
    status.innerHTML = `<span class="status-dot ${dot}"></span><strong>${label}</strong><span>${sub}</span>`;
  }

  function renderBackendBanner() {
    const content = $(".page-content");
    if (!content) return;
    const existing = $("#backendBanner");
    if (existing) existing.remove();
    if (state.backendOnline && !state.demoMode) return;

    const banner = document.createElement("div");
    banner.id = "backendBanner";
    banner.className = "backend-banner";
    if (state.backendOnline && state.demoMode) {
      banner.innerHTML = `
        <div class="banner-icon"><i class="fa-solid fa-flask"></i></div>
        <div class="banner-body">
          <strong>Demo Mode is active — sample data only</strong>
          <p>You are exploring FaceTrack with realistic sample students. Nothing is saved to the Flask server and <b>no real attendance is being recorded</b>. Face recognition requires the backend.</p>
        </div>
        <div class="banner-actions">
          <a href="login.html?switch=live" class="btn btn-sm btn-light-soft">Use live backend</a>
          <button class="banner-close" type="button" aria-label="Dismiss"><i class="fa-solid fa-xmark"></i></button>
        </div>`;
    } else {
      banner.innerHTML = `
        <div class="banner-icon"><i class="fa-solid fa-plug-circle-exclamation"></i></div>
        <div class="banner-body">
          <strong>Backend unavailable — Demo Mode with sample data</strong>
          <p>The Flask API at <code>${escapeHtml(API_BASE)}</code> could not be reached. Dashboard numbers come from sample data and <b>no real attendance is being recorded</b>. Start <code>python app.py</code> to use live features.</p>
        </div>
        <div class="banner-actions">
          <button class="btn btn-sm btn-light-soft" type="button" id="retryBackend"><i class="fa-solid fa-rotate"></i> Retry</button>
          <button class="banner-close" type="button" aria-label="Dismiss"><i class="fa-solid fa-xmark"></i></button>
        </div>`;
    }

    content.insertBefore(banner, content.firstChild);
    banner.querySelector(".banner-close")?.addEventListener("click", () => banner.remove());
    $("#retryBackend")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      setButtonLoading(button, true, "Checking");
      const online = await checkBackend();
      setButtonLoading(button, false);
      if (online) {
        toast("success", "Backend connected", "Reloading live data…");
        setTimeout(() => window.location.reload(), 700);
      } else {
        toast("error", "Still offline", "Make sure Flask is running on port 5000 and CORS is enabled.");
        updateBackendIndicators();
      }
    });
  }

  async function loadNotifications() {
    const list = $("#notificationList");
    if (!list) return;
    try {
      let recent = [];
      if (state.demoMode) {
        recent = demo.recent(4);
      } else {
        const response = await api("/attendance/summary");
        recent = (response.summary && response.summary.recent) || [];
      }
      if (!recent.length) {
        list.innerHTML = `<div class="notification-empty"><i class="fa-regular fa-bell-slash"></i>No attendance activity yet today.</div>`;
        return;
      }
      list.innerHTML = recent
        .slice(0, 4)
        .map(
          (row) => `
          <div class="notification-item">
            <span class="notification-icon green"><i class="fa-solid fa-user-check"></i></span>
            <div class="n-body">
              <div class="n-title">${escapeHtml(row.name)} marked present</div>
              <div class="n-time">${escapeHtml(row.student_id)} · ${formatTime(row.time)}</div>
            </div>
          </div>`
        )
        .join("");
      const dot = $("#notificationDot");
      if (dot) dot.style.display = "block";
    } catch (_error) {
      list.innerHTML = `<div class="notification-empty"><i class="fa-regular fa-bell-slash"></i>Notifications unavailable.</div>`;
    }
  }

  // ------------------------------------------------------------------------
  // Toasts, confirm, loading helpers
  // ------------------------------------------------------------------------
  function toast(type, title, message, timeout = 4500) {
    let stack = $(".toast-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.className = "toast-stack";
      document.body.appendChild(stack);
    }
    const icons = {
      success: "fa-check",
      error: "fa-xmark",
      warning: "fa-exclamation",
      info: "fa-circle-info",
    };
    const element = document.createElement("div");
    element.className = `ft-toast ${type}`;
    element.setAttribute("role", "status");
    element.innerHTML = `
      <span class="toast-icon"><i class="fa-solid ${icons[type] || icons.info}"></i></span>
      <div class="toast-body"><strong>${escapeHtml(title)}</strong>${message ? `<p>${escapeHtml(message)}</p>` : ""}</div>
      <button class="toast-close" type="button" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>`;
    stack.appendChild(element);
    const close = () => {
      if (!element.isConnected) return;
      element.classList.add("leaving");
      setTimeout(() => element.remove(), 260);
    };
    element.querySelector(".toast-close").addEventListener("click", close);
    setTimeout(close, timeout);
    while (stack.children.length > 4) stack.firstElementChild.remove();
    return element;
  }

  function confirmDialog(options = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "confirm-overlay";
      overlay.innerHTML = `
        <div class="confirm-box" role="dialog" aria-modal="true" aria-labelledby="confirmTitle">
          <div class="confirm-icon ${options.danger ? "danger" : options.icon === "primary" ? "primary" : ""}">
            <i class="fa-solid ${options.icon || (options.danger ? "fa-trash-can" : "fa-question")}"></i>
          </div>
          <h3 id="confirmTitle">${escapeHtml(options.title || "Are you sure?")}</h3>
          <p>${options.message || ""}</p>
          <div class="confirm-actions">
            <button class="btn btn-outline-soft" type="button" data-action="cancel">${escapeHtml(options.cancelText || "Cancel")}</button>
            <button class="btn ${options.danger ? "btn-primary" : "btn-primary"}" type="button" data-action="confirm">${escapeHtml(options.confirmText || "Confirm")}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const close = (result) => {
        overlay.remove();
        document.removeEventListener("keydown", onKey);
        resolve(result);
      };
      const onKey = (event) => {
        if (event.key === "Escape") close(false);
        if (event.key === "Enter") close(true);
      };
      overlay.querySelector('[data-action="cancel"]').addEventListener("click", () => close(false));
      overlay.querySelector('[data-action="confirm"]').addEventListener("click", () => close(true));
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) close(false);
      });
      document.addEventListener("keydown", onKey);
      overlay.querySelector('[data-action="confirm"]').focus();
    });
  }

  function setButtonLoading(button, loading, label) {
    if (!button) return;
    if (loading) {
      if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
      button.disabled = true;
      button.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> ${escapeHtml(label || "Please wait…")}`;
    } else {
      button.disabled = false;
      if (button.dataset.originalHtml) {
        button.innerHTML = button.dataset.originalHtml;
        delete button.dataset.originalHtml;
      }
    }
  }

  function openModal(element) {
    if (!element) return;
    if (window.bootstrap && bootstrap.Modal) {
      bootstrap.Modal.getOrCreateInstance(element).show();
    } else {
      element.classList.add("show");
      element.style.display = "block";
    }
  }

  function closeModal(element) {
    if (!element) return;
    if (window.bootstrap && bootstrap.Modal) {
      const instance = bootstrap.Modal.getInstance(element);
      if (instance) instance.hide();
    } else {
      element.classList.remove("show");
      element.style.display = "none";
    }
  }

  function logout(silent = false) {
    confirmDialog({
      title: "Sign out of FaceTrack?",
      message: "You will need your admin credentials to access live attendance data again.",
      confirmText: "Sign out",
      icon: "fa-arrow-right-from-bracket",
      danger: false,
    }).then(async (confirmed) => {
      if (!confirmed) return;
      const session = getSession();
      if (session && session.mode === "live" && state.backendOnline) {
        try {
          await api("/auth/logout", { method: "POST" });
        } catch (_error) {
          /* token may already be expired */
        }
      }
      clearStoredSession();
      window.location.href = "login.html";
    });
  }

  // ------------------------------------------------------------------------
  // Login page
  // ------------------------------------------------------------------------
  async function initLogin() {
    state.demoMode = false;
    const status = $("#loginBackendStatus");
    const updateStatus = () => {
      if (!status) return;
      status.innerHTML = state.backendOnline
        ? `<span class="status-dot"></span> Flask backend detected · <strong>${escapeHtml(API_BASE)}</strong>`
        : `<span class="status-dot pending"></span> Backend offline · Demo Mode available`;
    };

    checkBackend().then(updateStatus);
    updateStatus();

    const form = $("#loginForm");
    const emailInput = $("#email");
    const passwordInput = $("#password");
    const remember = $("#remember");
    const errorBox = $("#loginError");
    const loginBtn = $("#loginBtn");
    const useDemoBtn = $("#useDemoBtn");

    // Show/hide password
    $("#togglePassword")?.addEventListener("click", () => {
      const visible = passwordInput.type === "text";
      passwordInput.type = visible ? "password" : "text";
      $("#togglePassword").innerHTML = visible
        ? '<i class="fa-regular fa-eye"></i>'
        : '<i class="fa-regular fa-eye-slash"></i>';
    });

    // Prefill after "forgot password" explanation? No, keep form clean.

    const showError = (message) => {
      if (!errorBox) return;
      errorBox.textContent = message;
      errorBox.classList.remove("d-none");
    };
    const clearError = () => errorBox?.classList.add("d-none");

    function validate() {
      const email = emailInput.value.trim();
      const password = passwordInput.value;
      let valid = true;
      [emailInput, passwordInput].forEach((input) => input.classList.remove("is-invalid"));
      if (!/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(email)) {
        emailInput.classList.add("is-invalid");
        showError("Enter a valid email address.");
        valid = false;
      }
      if (password.length < 6) {
        passwordInput.classList.add("is-invalid");
        showError("Password must be at least 6 characters.");
        valid = false;
      }
      return valid;
    }

    [emailInput, passwordInput].forEach((input) => {
      input?.addEventListener("input", () => {
        input.classList.remove("is-invalid");
        clearError();
      });
    });

    function finishLogin(session, rememberMe) {
      let expires = session.expires_at;
      if (!expires && session.expires_in) {
        // Use the backend's token lifetime instead of a hard-coded 30 days.
        expires = Date.now() + Number(session.expires_in) * 1000;
      } else if (!expires && rememberMe) {
        expires = Date.now() + 1000 * 60 * 60 * 24 * 30;
      } else if (!expires) {
        expires = 0;
      }
      const stored = Object.assign({}, session, { expires_at: expires });
      saveSession(stored, rememberMe);
      const next = queryParam("next");
      const safeNext = next && PAGE_FILES.includes(next.split("?")[0]) ? next : "index.html";
      window.location.href = safeNext;
    }

    async function doLogin(mode) {
      clearError();
      const email = emailInput.value.trim();
      const password = passwordInput.value;
      if (mode === "live") {
        if (!validate()) return;
        if (!state.backendOnline) {
          showError("Backend offline. Start Flask first, or choose Demo Mode below.");
          toast("warning", "Backend offline", "Run: python app.py inside the backend folder.");
          return;
        }
        setButtonLoading(loginBtn, true, "Signing in…");
        try {
          const response = await api("/auth/login", {
            method: "POST",
            body: { email, password },
            auth: false,
            timeout: 9000,
          });
          toast("success", "Welcome back", `Signed in as ${response.admin.name}`);
          finishLogin(
            {
              token: response.token,
              mode: "live",
              admin: response.admin,
              logged_in_at: new Date().toISOString(),
            },
            remember.checked
          );
        } catch (error) {
          showError(error.message);
          toast("error", "Login failed", error.message);
          setButtonLoading(loginBtn, false);
        }
      } else {
        // Demo mode uses fixed sample credentials and never contacts the API.
        const demoData = demo.load();
        if (email !== demoData.admin.email || password !== demoData.admin.password) {
          showError("Demo credentials: admin@facetrack.com / Admin@123");
          toast("error", "Invalid demo credentials", "Use the sample credentials shown on this page.");
          return;
        }
        toast("success", "Demo Mode", "Exploring sample data. No real attendance is recorded.");
        finishLogin(
          {
            token: "demo-token",
            mode: "demo",
            admin: {
              id: 1,
              name: demoData.admin.name,
              email: demoData.admin.email,
              role: demoData.admin.role,
            },
            logged_in_at: new Date().toISOString(),
          },
          remember.checked
        );
      }
    }

    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      doLogin("live");
    });

    useDemoBtn?.addEventListener("click", () => {
      emailInput.value = "admin@facetrack.com";
      passwordInput.value = "Admin@123";
      doLogin("demo");
    });

    $("#fillDemoCredentials")?.addEventListener("click", () => {
      emailInput.value = "admin@facetrack.com";
      passwordInput.value = "Admin@123";
      clearError();
      emailInput.focus();
    });

    const reason = queryParam("reason");
    if (reason === "expired") {
      showError("Your session expired. Please sign in again.");
    } else if (reason === "auth") {
      showError("Please sign in to open the FaceTrack dashboard.");
    }
    if (queryParam("switch") === "live") {
      showError("Sign in with your administrator account to use the live backend.");
    }
  }

  // ------------------------------------------------------------------------
  // Init for authenticated pages
  // ------------------------------------------------------------------------
  async function init(options = {}) {
    const session = requireAuth();
    if (!session) return null;

    state.session = session;
    await checkBackend();
    // Live sessions must never silently fall back to sample data when the
    // backend is offline. Demo Mode is only the explicit login choice.
    state.demoMode = session.mode === "demo";
    if (state.demoMode) demo.load();

    document.body.dataset.mode = state.demoMode ? "demo" : "live";
    document.body.dataset.mirror = getPrefs().mirrorPreview === false ? "off" : "on";
    renderShell(options.active, options.title, options.subtitle);
    renderBackendBanner();
    updateBackendIndicators();
    loadNotifications();
    if (window.Chart) {
      Chart.defaults.font.family = "'Poppins', 'Inter', sans-serif";
      Chart.defaults.font.size = 10.5;
      Chart.defaults.color = "#64748b";
      Chart.defaults.borderColor = "rgba(148, 163, 184, 0.14)";
      Chart.defaults.plugins.legend.labels.usePointStyle = true;
      Chart.defaults.plugins.legend.labels.boxWidth = 7;
      Chart.defaults.plugins.legend.labels.padding = 14;
      Chart.defaults.plugins.tooltip.backgroundColor = "#14213d";
      Chart.defaults.plugins.tooltip.titleFont = { family: "'Poppins', sans-serif", size: 11, weight: "600" };
      Chart.defaults.plugins.tooltip.bodyFont = { family: "'Poppins', sans-serif", size: 10.5 };
      Chart.defaults.plugins.tooltip.padding = 10;
      Chart.defaults.plugins.tooltip.cornerRadius = 8;
      Chart.defaults.plugins.tooltip.displayColors = true;
      Chart.defaults.plugins.tooltip.boxPadding = 3;
    }
    return { session, demoMode: state.demoMode, backendOnline: state.backendOnline, admin: getAdmin() };
  }

  // ------------------------------------------------------------------------
  // Exports
  // ------------------------------------------------------------------------
  function csvEscape(value) {
    const text = value == null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function mapExportRows(rows) {
    return rows.map((row) => ({
      Date: row.date,
      "Punch In": row.time,
      "Student ID": row.student_id,
      "Student Name": row.name,
      Department: row.department,
      Year: row.year,
      Section: row.section,
      Status: row.status,
      "Match Score (%)": row.confidence == null ? "" : Number(row.confidence).toFixed(1),
      "Marked By": row.marked_by,
    }));
  }

  async function exportAttendance(options = {}) {
    const format = options.format === "csv" ? "csv" : "excel";
    const from = options.from || "";
    const to = options.to || "";
    const search = options.search || options.student_id || options.studentId || "";
    const department = options.department || "";
    const suffix = [from, to].filter(Boolean).join("_") || todayISO();

    if (state.demoMode) {
      const rows = demo.exportRows(from, to, search, department);
      if (!rows.length) {
        toast("warning", "Nothing to export", "No attendance records match the selected filters.");
        return false;
      }
      const mapped = mapExportRows(rows);
      if (format === "excel" && window.XLSX) {
        const workbook = XLSX.utils.book_new();
        const sheet = XLSX.utils.json_to_sheet(mapped);
        sheet["!cols"] = [
          { wch: 12 }, { wch: 11 }, { wch: 16 }, { wch: 24 }, { wch: 24 },
          { wch: 10 }, { wch: 8 }, { wch: 11 }, { wch: 15 }, { wch: 20 },
        ];
        XLSX.utils.book_append_sheet(workbook, sheet, "Attendance");
        const summaryRows = [
          ["FaceTrack — Attendance Export"],
          ["Mode", "DEMO — sample data only. Not real attendance."],
          ["Generated", new Date().toLocaleString()],
          ["Period", `${from || "All"} to ${to || "All"}`],
          ["Records", rows.length],
        ];
        const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
        summarySheet["!cols"] = [{ wch: 20 }, { wch: 60 }];
        XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
        XLSX.writeFile(workbook, `FaceTrack_Demo_Attendance_${suffix}.xlsx`);
        toast("success", "Demo Excel exported", "Sample data only — no real attendance was exported.");
        return true;
      }
      const headers = Object.keys(mapped[0]);
      const csv = [headers.join(",")]
        .concat(mapped.map((row) => headers.map((key) => csvEscape(row[key])).join(",")))
        .join("\r\n");
      downloadBlob(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }), `FaceTrack_Demo_Attendance_${suffix}.csv`);
      toast("success", "Demo CSV exported", "Sample data only — no real attendance was exported.");
      return true;
    }

    const query = new URLSearchParams({ format: format === "csv" ? "csv" : "excel" });
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    if (search) query.set("search", search);
    if (department) query.set("department", department);
    try {
      const session = getSession();
      const response = await rawFetch(`${API_BASE}/attendance/export?${query.toString()}`, {
        headers: { Authorization: `Bearer ${session.token}` },
        timeout: 20000,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new FTError((payload && payload.error) || "Export failed.", response.status);
      }
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="?([^";]+)"?/i);
      const filename = match ? match[1] : `FaceTrack_Attendance_${suffix}.${format === "csv" ? "csv" : "xlsx"}`;
      downloadBlob(blob, filename);
      toast("success", "Export ready", `${format === "csv" ? "CSV" : "Excel"} report downloaded.`);
      return true;
    } catch (error) {
      toast("error", "Export failed", error.message);
      return false;
    }
  }

  // ------------------------------------------------------------------------
  // Camera helpers shared by registration + attendance pages
  // ------------------------------------------------------------------------
  async function startCamera(videoElement, preferredDeviceId) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new FTError("This browser does not support webcam access. Use Chrome or Edge on localhost/HTTPS.", 0, "NO_MEDIA");
    }
    stopCamera();
    const constraints = {
      audio: false,
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "user",
      },
    };
    if (preferredDeviceId) constraints.video.deviceId = { exact: preferredDeviceId };
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      const messages = {
        NotAllowedError: "Camera permission was denied. Allow camera access in the browser and try again.",
        NotFoundError: "No webcam was found on this device.",
        NotReadableError: "The camera is busy in another app. Close it and try again.",
      };
      throw new FTError(messages[error.name] || `Could not start the camera: ${error.message}`, 0, error.name);
    }
    state.cameraStream = stream;
    if (videoElement) {
      videoElement.srcObject = stream;
      try {
        await videoElement.play();
      } catch (_error) {
        /* autoplay is muted, so this is normally fine */
      }
    }
    return stream;
  }

  function stopCamera() {
    if (state.cameraStream) {
      state.cameraStream.getTracks().forEach((track) => track.stop());
      state.cameraStream = null;
    }
    $$("video").forEach((video) => {
      if (video.srcObject) video.srcObject = null;
    });
  }

  function captureFrame(videoElement, quality = 0.86, maxWidth = 960) {
    if (!videoElement || !videoElement.videoWidth) return null;
    const width = Math.min(videoElement.videoWidth, maxWidth);
    const height = Math.round((videoElement.videoHeight / videoElement.videoWidth) * width);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (getPrefs().mirrorPreview !== false) {
      context.translate(width, 0);
      context.scale(-1, 1); // The CSS preview is mirrored; flip it back for the server.
    }
    context.drawImage(videoElement, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", quality);
  }

  async function listCameras() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((device) => device.kind === "videoinput");
    } catch (_error) {
      return [];
    }
  }

  // ------------------------------------------------------------------------
  // Preferences
  // ------------------------------------------------------------------------
  function getPrefs() {
    return Object.assign(
      {
        scanInterval: CFG.SCAN_INTERVAL_MS,
        autoMark: true,
        cameraDevice: "",
        mirrorPreview: true,
      },
      safeParse(localStorage.getItem(CFG.PREFS_KEY), {})
    );
  }

  function savePrefs(prefs) {
    localStorage.setItem(CFG.PREFS_KEY, JSON.stringify(Object.assign(getPrefs(), prefs)));
  }

  // ------------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------------
  const FT = {
    config: CFG,
    apiBase: API_BASE,
    apiOrigin: API_ORIGIN,
    state,
    demo,
    data,
    init,
    initLogin,
    api,
    rawFetch,
    checkBackend,
    getSession,
    saveSession,
    clearSession: clearStoredSession,
    getAdmin,
    updateSessionAdmin,
    isDemo,
    toast,
    confirm: confirmDialog,
    modal: openModal,
    closeModal,
    logout,
    setButtonLoading,
    exportAttendance,
    downloadBlob,
    startCamera,
    stopCamera,
    captureFrame,
    listCameras,
    getPrefs,
    savePrefs,
    avatarHtml,
    photoUrlFor,
    statusBadge,
    formatDate,
    formatTime,
    formatNumber,
    nowTime,
    todayISO,
    daysAgoISO,
    isoDate,
    parseISO,
    addDays,
    queryParam,
    escapeHtml,
    debounce,
    greeting,
    initials,
    avatarColor,
    confidenceLabel,
    updateBackendBanner: renderBackendBanner,
    refreshBackendIndicators: updateBackendIndicators,
    FTError,
  };

  window.FT = FT;

  // Auto-init login page when DOM is ready.
  document.addEventListener("DOMContentLoaded", () => {
    if (document.body && document.body.dataset.page === "login") {
      if (getSession() && queryParam("switch") !== "live") {
        window.location.replace("index.html");
        return;
      }
      initLogin();
    }
  });
})();
