/**
 * cleanupOrphanedEvents.js
 * ─────────────────────────
 * One-time script: deletes all MisuseEvents and WatermarkRegistry records
 * whose fileId references a GenomicFile document that no longer exists.
 *
 * Run from the backend folder:
 *   node testing/cleanupOrphanedEvents.js
 */

"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const mongoose         = require("mongoose");
const MisuseEvent      = require("../models/MisuseEvent");
const WatermarkRegistry = require("../models/WatermarkRegistry");
const GenomicFile      = require("../models/GenomicFile");

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("✅  MongoDB connected");

  // ── 1. Get all distinct fileIds referenced in MisuseEvent ──────
  const misuseFileIds = await MisuseEvent.distinct("fileId");
  const wmFileIds     = await WatermarkRegistry.distinct("fileId");

  const allFileIds = [
    ...new Set([
      ...misuseFileIds.filter(Boolean).map(String),
      ...wmFileIds.filter(Boolean).map(String),
    ]),
  ];
  console.log(`🔍  Found ${allFileIds.length} unique fileId references to check`);

  // ── 2. Find which ones still exist in GenomicFile ──────────────
  const existingFiles = await GenomicFile.find(
    { _id: { $in: allFileIds } },
    { _id: 1 }
  ).lean();
  const existingIds = new Set(existingFiles.map(f => String(f._id)));

  const orphanedIds = allFileIds.filter(id => !existingIds.has(id));
  console.log(`🗑️   Orphaned fileIds (file deleted): ${orphanedIds.length}`);

  if (orphanedIds.length === 0) {
    console.log("✨  Nothing to clean up.");
    await mongoose.disconnect();
    return;
  }

  // ── 3. Also delete events where fileId is null ─────────────────
  const [eventsFromOrphans, eventsNullFile, wmFromOrphans, wmNullFile] = await Promise.all([
    MisuseEvent.deleteMany({ fileId: { $in: orphanedIds } }),
    MisuseEvent.deleteMany({ fileId: null }),
    WatermarkRegistry.deleteMany({ fileId: { $in: orphanedIds } }),
    WatermarkRegistry.deleteMany({ fileId: null }),
  ]);

  console.log(`\n✅  Cleanup complete:`);
  console.log(`   MisuseEvents deleted (orphaned fileId): ${eventsFromOrphans.deletedCount}`);
  console.log(`   MisuseEvents deleted (null fileId):     ${eventsNullFile.deletedCount}`);
  console.log(`   WatermarkRegistry deleted (orphaned):   ${wmFromOrphans.deletedCount}`);
  console.log(`   WatermarkRegistry deleted (null):       ${wmNullFile.deletedCount}`);

  await mongoose.disconnect();
  console.log("\n🔌  Disconnected. Done.");
}

run().catch(err => {
  console.error("❌  Error:", err.message);
  process.exit(1);
});
