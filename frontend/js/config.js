/* ==========================================================================
   FaceTrack - API configuration
   --------------------------------------------------------------------------
   Change ONLY this file when you deploy the Flask backend to another host.

   Local Flask backend (default):
       http://127.0.0.1:5000/api

   Hosted backend example:
       https://your-facetrack-api.onrender.com/api

   GitHub Pages note
   -----------------
   GitHub Pages serves the frontend over HTTPS. A browser will block calls to
   a plain http:// backend from an HTTPS page (mixed content). For a hosted
   backend use HTTPS. For local development, run the frontend on
   http://127.0.0.1:5500 (VS Code Live Server) and the backend on
   http://127.0.0.1:5000.
   ========================================================================== */

window.FACETRACK_CONFIG = {
  APP_NAME: "FaceTrack",
  APP_VERSION: "1.0.0",

  // Flask API root. Keep the trailing /api.
  API_BASE_URL: "http://127.0.0.1:5000/api",

  // How long a health check may take before the frontend switches to Demo Mode.
  HEALTH_TIMEOUT: 3200,

  // HTTP request timeout (face recognition frames can take longer to upload).
  REQUEST_TIMEOUT: 12000,

  // Live recognition loop interval in milliseconds (attendance page).
  SCAN_INTERVAL_MS: 2600,

  // LBPH distance threshold. Lower = stricter. Must match the backend default
  // (backend/face_recognition.py MATCH_THRESHOLD) unless you set the env var.
  MATCH_THRESHOLD: 72,

  // Recommended captured face samples per student.
  MAX_FACE_SAMPLES: 5,

  // localStorage keys (safe to change, but changing resets demo data).
  DEMO_STORAGE_KEY: "facetrack_demo_v3",
  SESSION_KEY: "facetrack_session_v3",
  PREFS_KEY: "facetrack_prefs_v1",
};
