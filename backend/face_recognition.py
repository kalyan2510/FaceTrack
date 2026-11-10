"""
FaceTrack - Face registration & recognition engine
==================================================
Uses OpenCV only (no dlib, no cloud service):

* Haar Cascade  -> face detection
* LBPH recognizer -> face recognition (opencv-contrib-python required)

Captured samples are stored under ``backend/dataset/<student_id>/`` and the
trained model under ``backend/trainer/trainer.yml`` with a JSON label map.
Nothing is uploaded to a third-party server.

Honesty rules enforced here:
* A sample is only saved when exactly one face is detected.
* Recognition below the configured threshold is reported as UNKNOWN.
* Attendance is only written for a recognised student.
"""

import base64
import json
import os
import re
import threading
import uuid
from datetime import datetime

import numpy as np

try:
    import cv2
except Exception:  # pragma: no cover - handled gracefully at runtime
    cv2 = None

from database import (
    add_face_sample,
    all_face_samples,
    count_face_samples,
    get_student,
    list_face_samples,
    set_face_registered,
)
from attendance_manager import mark_attendance

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_DIR = os.path.join(BASE_DIR, "dataset")
TRAINER_DIR = os.path.join(BASE_DIR, "trainer")
MODEL_PATH = os.path.join(TRAINER_DIR, "trainer.yml")
LABELS_PATH = os.path.join(TRAINER_DIR, "labels.json")
PHOTO_DIR = os.path.join(DATASET_DIR, "photos")

FACE_SIZE = (200, 200)
# LBPH returns a *distance*: lower is better. 72 works well for webcams.
MATCH_THRESHOLD = float(os.environ.get("FACETRACK_MATCH_THRESHOLD", "72"))
MIN_FACE_SIZE = 80

os.makedirs(DATASET_DIR, exist_ok=True)
os.makedirs(TRAINER_DIR, exist_ok=True)
os.makedirs(PHOTO_DIR, exist_ok=True)


class FaceEngine:
    def __init__(self):
        self._lock = threading.Lock()
        self._recognizer = None
        self._labels = {}
        self._model_info = None
        self.session = {
            "active": False,
            "started_at": None,
            "stopped_at": None,
            "scans": 0,
            "recognized": 0,
            "unknown": 0,
        }
        self._cascade = None
        if self.opencv_available:
            cascade_path = os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_default.xml")
            if os.path.exists(cascade_path):
                self._cascade = cv2.CascadeClassifier(cascade_path)
        self._load_model()

    # ------------------------------------------------------------------
    # Capability checks
    # ------------------------------------------------------------------
    @property
    def opencv_available(self):
        return cv2 is not None

    @property
    def lbph_available(self):
        return cv2 is not None and hasattr(cv2, "face")

    @property
    def engine_ready(self):
        return self.opencv_available and self.lbph_available and self._cascade is not None

    def capabilities(self):
        return {
            "opencv_installed": self.opencv_available,
            "opencv_version": getattr(cv2, "__version__", None) if cv2 else None,
            "lbph_available": self.lbph_available,
            "cascade_loaded": self._cascade is not None,
            "engine_ready": self.engine_ready,
            "model_trained": self._recognizer is not None and bool(self._labels),
            "threshold": MATCH_THRESHOLD,
        }

    # ------------------------------------------------------------------
    # Image helpers
    # ------------------------------------------------------------------
    @staticmethod
    def decode_base64_image(data_url):
        if not data_url or not isinstance(data_url, str):
            return None
        try:
            payload = data_url.split(",", 1)[1] if "," in data_url else data_url
            raw = base64.b64decode(payload)
            if len(raw) < 100:
                return None
            arr = np.frombuffer(raw, dtype=np.uint8)
            return cv2.imdecode(arr, cv2.IMREAD_COLOR)
        except Exception:
            return None

    def detect_faces(self, image):
        if not self.engine_ready or image is None:
            return []
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        gray = cv2.equalizeHist(gray)
        faces = self._cascade.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=5,
            minSize=(MIN_FACE_SIZE, MIN_FACE_SIZE),
        )
        return [tuple(map(int, box)) for box in faces]

    @staticmethod
    def _crop_face(image, box, padding=0.18):
        x, y, w, h = box
        pad_x = int(w * padding)
        pad_y = int(h * padding)
        height, width = image.shape[:2]
        x1 = max(0, x - pad_x)
        y1 = max(0, y - pad_y)
        x2 = min(width, x + w + pad_x)
        y2 = min(height, y + h + pad_y)
        return image[y1:y2, x1:x2]

    # ------------------------------------------------------------------
    # Validation (no data is stored)
    # ------------------------------------------------------------------
    def validate_frame(self, image_data):
        """Detect faces in a frame without saving or training anything.

        Used by the registration page to ensure a sample is only captured
        when exactly one real face is visible.
        """
        if not self.engine_ready:
            return {"success": False, "error": "Face engine unavailable. Install opencv-contrib-python."}
        image = self.decode_base64_image(image_data)
        if image is None:
            return {"success": False, "error": "Could not read the camera frame."}
        faces = self.detect_faces(image)
        if not faces:
            return {
                "success": False,
                "code": "NO_FACE",
                "face_detected": False,
                "face_count": 0,
                "error": "No face detected. Face the camera in good lighting and try again.",
            }
        if len(faces) > 1:
            return {
                "success": False,
                "code": "MULTIPLE_FACES",
                "face_detected": True,
                "face_count": len(faces),
                "error": "Multiple faces detected. Only the selected student should be in frame.",
            }
        x, y, w, h = faces[0]
        return {
            "success": True,
            "face_detected": True,
            "face_count": 1,
            "face": {"x": x, "y": y, "width": w, "height": h},
            "message": "Valid face detected. You can capture this sample.",
        }

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------
    def register_face(self, student_id, image_data, train=True):
        if not self.engine_ready:
            return {
                "success": False,
                "error": (
                    "Face engine is unavailable. Install opencv-contrib-python "
                    "(pip install opencv-contrib-python) and restart the backend."
                ),
            }

        student = get_student(student_id)
        if not student:
            return {"success": False, "error": "Student not found"}

        image = self.decode_base64_image(image_data)
        if image is None:
            return {"success": False, "error": "Could not read the captured image. Try again."}

        faces = self.detect_faces(image)
        if len(faces) == 0:
            return {
                "success": False,
                "code": "NO_FACE",
                "error": "No face detected. Look at the camera in good lighting and try again.",
            }
        if len(faces) > 1:
            return {
                "success": False,
                "code": "MULTIPLE_FACES",
                "error": "Multiple faces detected. Make sure only the selected student is in frame.",
            }

        face = self._crop_face(image, faces[0])
        if face.size == 0:
            return {"success": False, "error": "Captured face was too small. Move closer to the camera."}
        face = cv2.resize(face, FACE_SIZE, interpolation=cv2.INTER_AREA)

        safe_id = re.sub(r"[^A-Za-z0-9_-]", "_", student_id)
        student_dir = os.path.join(DATASET_DIR, safe_id)
        os.makedirs(student_dir, exist_ok=True)
        filename = f"{datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}.jpg"
        full_path = os.path.join(student_dir, filename)
        cv2.imwrite(full_path, face)

        relative_path = os.path.relpath(full_path, BASE_DIR).replace("\\", "/")
        count = add_face_sample(student_id, relative_path)
        set_face_registered(student_id, True)

        # Callers that capture a batch pass train=False and train once at the
        # end. A single capture still trains immediately so it is usable.
        training = None
        if train:
            training = self.train_model()

        return {
            "success": True,
            "message": "Face sample captured and validated.",
            "student_id": student_id,
            "student_name": student["name"],
            "samples": count,
            "trained": bool(training and training.get("success")),
            "training": training,
        }

    def train_model(self):
        if not self.engine_ready:
            return {"success": False, "error": "Face engine unavailable (opencv-contrib-python missing)."}

        with self._lock:
            samples = all_face_samples()
            images = []
            labels = []
            student_ids = []
            label_map = {}
            next_label = 1

            for sample in samples:
                full_path = os.path.join(BASE_DIR, sample["sample_path"])
                if not os.path.exists(full_path):
                    continue
                image = cv2.imread(full_path, cv2.IMREAD_GRAYSCALE)
                if image is None:
                    continue
                image = cv2.resize(image, FACE_SIZE, interpolation=cv2.INTER_AREA)
                sid = sample["student_id"]
                if sid not in label_map:
                    label_map[sid] = next_label
                    student_ids.append(sid)
                    next_label += 1
                images.append(image)
                labels.append(label_map[sid])

            if not images:
                # Removing the last student must not leave a stale model that
                # could still recognise a deleted person.
                self._recognizer = None
                self._labels = {}
                self._model_info = None
                for path in (MODEL_PATH, LABELS_PATH):
                    try:
                        if os.path.exists(path):
                            os.remove(path)
                    except OSError:
                        pass
                return {
                    "success": False,
                    "error": "No valid face samples found. Register at least one face first.",
                }

            recognizer = cv2.face.LBPHFaceRecognizer_create()
            recognizer.train(images, np.array(labels))
            recognizer.write(MODEL_PATH)

            self._recognizer = recognizer
            self._labels = {str(value): key for key, value in label_map.items()}
            trained_at = datetime.now().isoformat(timespec="seconds")
            info = {
                "trained_at": trained_at,
                "samples": len(images),
                "students": len(student_ids),
                "labels": self._labels,
            }
            with open(LABELS_PATH, "w", encoding="utf-8") as handle:
                json.dump(info, handle, indent=2)

            # Keep student face flags in sync.
            registered = set(student_ids)
            for sample in samples:
                if sample["student_id"] in registered:
                    set_face_registered(sample["student_id"], True)

            self._model_info = {
                "trained_at": trained_at,
                "samples": len(images),
                "students": len(student_ids),
            }
            return {
                "success": True,
                "message": f"Model trained on {len(images)} samples from {len(student_ids)} students.",
                "samples": len(images),
                "students": len(student_ids),
                "trained_at": trained_at,
            }

    def _load_model(self):
        if not self.lbph_available:
            return
        try:
            if os.path.exists(MODEL_PATH) and os.path.exists(LABELS_PATH):
                recognizer = cv2.face.LBPHFaceRecognizer_create()
                recognizer.read(MODEL_PATH)
                with open(LABELS_PATH, "r", encoding="utf-8") as handle:
                    info = json.load(handle)
                self._recognizer = recognizer
                self._labels = info.get("labels", {})
                self._model_info = {
                    "trained_at": info.get("trained_at"),
                    "samples": info.get("samples"),
                    "students": info.get("students"),
                }
        except Exception as exc:  # corrupted model should not crash the API
            print(f"[FaceTrack] Could not load trained model: {exc}")
            self._recognizer = None
            self._labels = {}

    # ------------------------------------------------------------------
    # Session controls
    # ------------------------------------------------------------------
    def start_session(self):
        self.session.update(
            {
                "active": True,
                "started_at": datetime.now().isoformat(timespec="seconds"),
                "stopped_at": None,
                "scans": 0,
                "recognized": 0,
                "unknown": 0,
            }
        )
        return dict(self.session)

    def stop_session(self):
        self.session["active"] = False
        self.session["stopped_at"] = datetime.now().isoformat(timespec="seconds")
        return dict(self.session)

    def get_session(self):
        data = dict(self.session)
        data["model"] = self._model_info
        data["capabilities"] = self.capabilities()
        return data

    # ------------------------------------------------------------------
    # Recognition
    # ------------------------------------------------------------------
    def recognize(self, image_data):
        if not self.engine_ready:
            return {
                "success": False,
                "error": "Face engine unavailable. Install opencv-contrib-python.",
            }
        if self._recognizer is None or not self._labels:
            return {
                "success": False,
                "code": "MODEL_NOT_TRAINED",
                "error": "No trained face model yet. Register a student face first.",
            }

        image = self.decode_base64_image(image_data)
        if image is None:
            return {"success": False, "error": "Could not read frame."}

        faces = self.detect_faces(image)
        if not faces:
            return {
                "success": True,
                "face_detected": False,
                "recognized": False,
                "faces": [],
                "message": "No face detected in this frame.",
            }

        self.session["scans"] += 1
        results = []
        for box in faces:
            crop = self._crop_face(image, box)
            if crop.size == 0:
                continue
            gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
            gray = cv2.equalizeHist(gray)
            gray = cv2.resize(gray, FACE_SIZE, interpolation=cv2.INTER_AREA)

            try:
                label, distance = self._recognizer.predict(gray)
            except Exception:
                continue

            distance = round(float(distance), 2)
            score = round(max(0.0, min(100.0, 100.0 - distance)), 1)
            student_id = self._labels.get(str(label))
            student = get_student(student_id) if student_id else None
            x, y, w, h = box

            if student is None or distance >= MATCH_THRESHOLD:
                self.session["unknown"] += 1
                results.append(
                    {
                        "recognized": False,
                        "status": "Unknown",
                        "distance": distance,
                        "confidence": score,
                        "box": {"x": x, "y": y, "width": w, "height": h},
                        "message": "Unknown face - attendance not marked.",
                    }
                )
                continue

            self.session["recognized"] += 1
            marking = mark_attendance(
                student_id, confidence=score, marked_by="Face Recognition"
            )
            attendance = marking.get("attendance") or {}
            results.append(
                {
                    "recognized": True,
                    "status": "Present",
                    "student_id": student_id,
                    "name": student["name"],
                    "department": student["department"],
                    "year": student["year"],
                    "section": student["section"],
                    "confidence": score,
                    "distance": distance,
                    "already_marked": bool(marking.get("already_marked")),
                    "punch_time": attendance.get("time"),
                    "box": {"x": x, "y": y, "width": w, "height": h},
                    "message": marking.get("message"),
                }
            )

        primary = next((item for item in results if item["recognized"]), results[0] if results else None)
        return {
            "success": True,
            "face_detected": True,
            "recognized": any(item["recognized"] for item in results),
            "faces": results,
            "primary": primary,
            "threshold": MATCH_THRESHOLD,
            "message": primary["message"] if primary else "No recognisable face.",
        }

    # ------------------------------------------------------------------
    # Student sample listing
    # ------------------------------------------------------------------
    def student_samples(self, student_id):
        samples = list_face_samples(student_id)
        return {
            "student_id": student_id,
            "count": len(samples),
            "samples": [
                {
                    "id": item["id"],
                    "captured_at": item["created_at"],
                    "filename": os.path.basename(item["sample_path"]),
                }
                for item in samples
            ],
            "face_registered": bool((get_student(student_id) or {}).get("face_registered")),
            "model": self._model_info,
        }


face_engine = FaceEngine()
