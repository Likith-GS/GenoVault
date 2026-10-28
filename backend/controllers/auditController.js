const AccessRequest = require('../models/AccessRequest');
const GenomicFile   = require('../models/GenomicFile');
const AuditLog      = require('../models/AuditLog');

const getAudit = async (req, res) => {
  try {
    const userId = req.user.userId;
    const role   = req.user.role;
    const events = [];

    if (role === 'owner') {
      // ── File upload events ──────────────────────────────────────────────
      const files = await GenomicFile.find({ owner: userId })
        .select('originalName blockchainFileId blockchainTxHash blockchainBlockNum blockchainTimestamp createdAt')
        .lean();

      for (const f of files) {
        events.push({
          eventType:   'FileRegistered',
          action:      'Upload',
          fileId:      f.blockchainFileId ?? null,
          fileName:    f.originalName,
          actor:       'You (owner)',
          txHash:      f.blockchainTxHash ?? null,
          blockNumber: f.blockchainBlockNum ?? null,
          etherscanUrl: f.blockchainTxHash
            ? 'https://sepolia.etherscan.io/tx/' + f.blockchainTxHash
            : null,
          timestamp:   f.blockchainTimestamp || f.createdAt,
          gasUsed:     null,
        });
      }

      // ── Access request events ──────────────────────────────────────────
      const requests = await AccessRequest.find({ owner: userId })
        .populate('researcher', 'name email orcid')
        .populate('file', 'originalName blockchainFileId')
        .lean();

      for (const r of requests) {
        const fileName       = r.file?.originalName || r.fileName || 'Unknown file';
        const researcherName = r.researcher ? r.researcher.name           : 'Unknown researcher';
        const fileId         = r.file       ? r.file.blockchainFileId     : null;

        // Always emit the Request event (with or without a tx hash)
        events.push({
          eventType:   'AccessRequested',
          action:      'Request',
          fileId,
          fileName,
          actor:       researcherName,
          txHash:      r.requestTxHash ?? null,
          blockNumber: r.requestBlockNumber ?? null,
          etherscanUrl: r.requestTxHash
            ? 'https://sepolia.etherscan.io/tx/' + r.requestTxHash
            : null,
          timestamp:   r.createdAt,
          gasUsed:     r.requestGasUsed ?? null,
        });

        // Emit Approve event if status is approved (or has an approve tx)
        if (r.status === 'approved' || r.approveTxHash) {
          events.push({
            eventType:   'AccessApproved',
            action:      'Approve',
            fileId,
            fileName,
            actor:       'You (owner)',
            txHash:      r.approveTxHash ?? null,
            blockNumber: r.approveBlockNumber ?? null,
            etherscanUrl: r.approveTxHash
              ? 'https://sepolia.etherscan.io/tx/' + r.approveTxHash
              : null,
            timestamp:   r.approvedAt || r.updatedAt,
            gasUsed:     r.approveGasUsed ?? null,
          });
        }

        // Emit Reject event if status is denied/rejected (or has a reject tx)
        if (r.status === 'denied' || r.status === 'rejected' || r.rejectTxHash) {
          events.push({
            eventType:   'AccessRejected',
            action:      'Reject',
            fileId,
            fileName,
            actor:       'You (owner)',
            txHash:      r.rejectTxHash ?? null,
            blockNumber: r.rejectBlockNumber ?? null,
            etherscanUrl: r.rejectTxHash
              ? 'https://sepolia.etherscan.io/tx/' + r.rejectTxHash
              : null,
            timestamp:   r.updatedAt,
            gasUsed:     r.rejectGasUsed ?? null,
          });
        }

        // Emit Revoke event if status is revoked (or has a revoke tx)
        if (r.status === 'revoked' || r.revokeTxHash) {
          events.push({
            eventType:   'AccessRevoked',
            action:      'Revoke',
            fileId,
            fileName,
            actor:       'You (owner)',
            txHash:      r.revokeTxHash ?? null,
            blockNumber: r.revokeBlockNumber ?? null,
            etherscanUrl: r.revokeTxHash
              ? 'https://sepolia.etherscan.io/tx/' + r.revokeTxHash
              : null,
            timestamp:   r.updatedAt,
            gasUsed:     r.revokeGasUsed ?? null,
          });
        }
      }

    } else {
      // ── Researcher view ──────────────────────────────────────────────────
      const requests = await AccessRequest.find({ researcher: userId })
        .populate('file', 'originalName blockchainFileId')
        .lean();

      for (const r of requests) {
        const fileName = r.file?.originalName || r.fileName || 'Unknown file';
        const fileId   = r.file ? r.file.blockchainFileId : null;

        // Always emit the Request event
        events.push({
          eventType:   'AccessRequested',
          action:      'Requested',
          fileId,
          fileName,
          actor:       'You',
          txHash:      r.requestTxHash ?? null,
          blockNumber: r.requestBlockNumber ?? null,
          etherscanUrl: r.requestTxHash
            ? 'https://sepolia.etherscan.io/tx/' + r.requestTxHash
            : null,
          timestamp:   r.createdAt,
          gasUsed:     r.requestGasUsed ?? null,
        });

        if (r.status === 'approved' || r.approveTxHash) {
          events.push({
            eventType:   'AccessApproved',
            action:      'Approved',
            fileId,
            fileName,
            actor:       'Owner',
            txHash:      r.approveTxHash ?? null,
            blockNumber: r.approveBlockNumber ?? null,
            etherscanUrl: r.approveTxHash
              ? 'https://sepolia.etherscan.io/tx/' + r.approveTxHash
              : null,
            timestamp:   r.approvedAt || r.updatedAt,
            gasUsed:     r.approveGasUsed ?? null,
          });
        }

        if (r.status === 'denied' || r.status === 'rejected' || r.rejectTxHash) {
          events.push({
            eventType:   'AccessRejected',
            action:      'Rejected',
            fileId,
            fileName,
            actor:       'Owner',
            txHash:      r.rejectTxHash ?? null,
            blockNumber: r.rejectBlockNumber ?? null,
            etherscanUrl: r.rejectTxHash
              ? 'https://sepolia.etherscan.io/tx/' + r.rejectTxHash
              : null,
            timestamp:   r.updatedAt,
            gasUsed:     r.rejectGasUsed ?? null,
          });
        }

        if (r.status === 'revoked' || r.revokeTxHash) {
          events.push({
            eventType:   'AccessRevoked',
            action:      'Revoked',
            fileId,
            fileName,
            actor:       'Owner',
            txHash:      r.revokeTxHash ?? null,
            blockNumber: r.revokeBlockNumber ?? null,
            etherscanUrl: r.revokeTxHash
              ? 'https://sepolia.etherscan.io/tx/' + r.revokeTxHash
              : null,
            timestamp:   r.updatedAt,
            gasUsed:     r.revokeGasUsed ?? null,
          });
        }
      }
    }
    // ── Unit 6: merge persistent AuditLog events (downloads & integrity checks) ────
    // These events are written by auditLogService (non-blocking) during the
    // download pipeline. We fetch them here and map them to the same shape
    // as the blockchain events above, so the frontend Audit.tsx needs no changes.
    try {
      // For owner: find all files they own, then fetch AuditLog events for those files
      // For researcher: fetch AuditLog events where they are the actor
      let persistedEvents = [];
      if (role === 'owner') {
        const ownerFiles = await GenomicFile.find({ owner: userId }).select('_id originalName blockchainFileId').lean();
        const fileIdMap  = {};
        ownerFiles.forEach(f => { fileIdMap[String(f._id)] = f; });
        const fileIds    = ownerFiles.map(f => f._id);

        persistedEvents = await AuditLog.find({ fileId: { $in: fileIds } })
          .sort({ timestamp: -1 })
          .limit(200)
          .populate('userId', 'name')
          .lean();

        for (const e of persistedEvents) {
          const fileDoc = e.fileId ? fileIdMap[String(e.fileId)] : null;
          events.push({
            eventType:   e.operation,
            action:      _operationToAction(e.operation),
            fileId:      fileDoc?.blockchainFileId ?? null,
            fileName:    fileDoc?.originalName ?? e.details?.fileName ?? 'Unknown file',
            actor:       e.userId?.name ?? 'Researcher',
            txHash:      e.txHash   ?? null,
            blockNumber: e.blockNumber ?? null,
            etherscanUrl: e.txHash ? 'https://sepolia.etherscan.io/tx/' + e.txHash : null,
            timestamp:   e.timestamp,
            gasUsed:     null,
            details:     e.details ?? {},
            status:      e.status,
          });
        }
      } else {
        persistedEvents = await AuditLog.find({ userId })
          .sort({ timestamp: -1 })
          .limit(200)
          .lean();

        for (const e of persistedEvents) {
          events.push({
            eventType:   e.operation,
            action:      _operationToAction(e.operation),
            fileId:      null,
            fileName:    e.details?.fileName ?? 'Unknown file',
            actor:       'You',
            txHash:      e.txHash   ?? null,
            blockNumber: e.blockNumber ?? null,
            etherscanUrl: e.txHash ? 'https://sepolia.etherscan.io/tx/' + e.txHash : null,
            timestamp:   e.timestamp,
            gasUsed:     null,
            details:     e.details ?? {},
            status:      e.status,
          });
        }
      }
    } catch (mergeErr) {
      // Non-fatal: if AuditLog query fails, return existing blockchain events
      console.warn('[auditController] Failed to merge AuditLog events:', mergeErr.message);
    }

    events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return res.status(200).json({ success: true, count: events.length, events });
  } catch (err) {
    console.error('[auditController]', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch audit trail' });
  }
};

/**
 * _operationToAction — maps AuditLog operation enum to short display string
 * matching the existing actionMeta keys in Audit.tsx (no frontend changes needed).
 */
function _operationToAction(op) {
  const map = {
    UPLOAD:             'Upload',
    ACCESS_REQUEST:     'Request',
    ACCESS_APPROVED:    'Approve',
    ACCESS_REJECTED:    'Reject',
    ACCESS_REVOKED:     'Revoke',
    DOWNLOAD_INITIATED: 'Download',
    DOWNLOAD_COMPLETED: 'Download',
    DOWNLOAD_FAILED:    'Download',
    INTEGRITY_VERIFIED: 'Verify',
    INTEGRITY_FAILED:   'Verify',
  };
  return map[op] ?? op;
}

module.exports = { getAudit };
