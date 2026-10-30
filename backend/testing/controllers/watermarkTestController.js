/**
 * backend/testing/controllers/watermarkTestController.js
 * ────────────────────────────────────────────────────────
 * HTTP controller for POST /api/testing/watermark-test
 *
 * Validates uploads, calls watermarkTestService, returns result.
 * Never modifies any production records.
 */

"use strict";

const { runWatermarkTest } = require("../services/watermarkTestService");

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

const runWatermarkTestHandler = async (req, res) => {
  try {
    const originalFile    = req.files?.originalFile?.[0];
    const watermarkedFile = req.files?.watermarkedFile?.[0];

    // Both files required
    if (!originalFile || !watermarkedFile) {
      return res.status(400).json({
        success: false,
        outcome: "INVALID_INPUT",
        outcomeDetail: "Both the original file and watermarked file are required.",
      });
    }

    // Size guard
    if (originalFile.size > MAX_BYTES || watermarkedFile.size > MAX_BYTES) {
      return res.status(400).json({
        success: false,
        outcome: "INVALID_INPUT",
        outcomeDetail: "File size exceeds 50 MB limit.",
      });
    }

    const ownerId = req.user.userId;

    const result = await runWatermarkTest({
      ownerId,
      originalBuffer:    originalFile.buffer,
      watermarkedBuffer: watermarkedFile.buffer,
      originalName:      originalFile.originalname,
      watermarkedName:   watermarkedFile.originalname,
    });

    // Attach file names to result for display
    result.originalFileName    = originalFile.originalname;
    result.watermarkedFileName = watermarkedFile.originalname;
    result.originalFileSize    = originalFile.size;
    result.watermarkedFileSize = watermarkedFile.size;

    return res.status(200).json({ success: true, ...result });

  } catch (err) {
    console.error("[WatermarkTest] Controller error:", err.message);
    return res.status(500).json({
      success: false,
      outcome: "VERIFICATION_UNAVAILABLE",
      outcomeDetail: "An internal error occurred during watermark testing.",
    });
  }
};

module.exports = { runWatermarkTest: runWatermarkTestHandler };
