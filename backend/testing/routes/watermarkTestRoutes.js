/**
 * backend/testing/routes/watermarkTestRoutes.js
 * ─────────────────────────────────────────────
 * Routes for the isolated Watermark Testing feature.
 * Mounted at /api/testing in server.js.
 *
 * DEMONSTRATION ONLY.
 * Never modifies WatermarkRegistry, MisuseEvents, blockchain, or
 * access permissions.
 */

"use strict";

const express    = require("express");
const multer     = require("multer");
const { protect } = require("../../middleware/authMiddleware");
const testCtrl   = require("../controllers/watermarkTestController");

const router = express.Router();

// ── Multer: in-memory storage, no disk persistence ───────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB per file
  fileFilter: (_req, file, cb) => {
    const ok =
      file.originalname.endsWith(".fastq") ||
      file.originalname.endsWith(".fastq.gz") ||
      file.mimetype === "application/x-gzip" ||
      file.mimetype === "text/plain";
    if (!ok) {
      return cb(new Error("Only .fastq and .fastq.gz files are accepted"));
    }
    cb(null, true);
  },
});

const twoFiles = upload.fields([
  { name: "originalFile",    maxCount: 1 },
  { name: "watermarkedFile", maxCount: 1 },
]);

// POST /api/testing/watermark-test
router.post(
  "/watermark-test",
  protect,                    // JWT required — owner only
  twoFiles,
  testCtrl.runWatermarkTest
);

module.exports = router;
