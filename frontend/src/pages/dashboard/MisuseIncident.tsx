import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ShieldX, ShieldAlert, AlertTriangle, ArrowLeft, ExternalLink,
  FileText, Loader2, CheckCircle2, Clock, RefreshCw,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Card }       from "@/components/ui/card";
import { Button }     from "@/components/ui/button";
import { Badge }      from "@/components/ui/badge";
import { useAuth }    from "@/contexts/AuthContext";

const API_BASE = "http://localhost:5000/api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MisuseEvent {
  _id:                 string;
  eventId:             string;
  watermarkId:         string;
  downloadId:          string | null;
  status:              string;
  detectionMethod:     string | null;
  watermarkMatchScore: number | null;
  watermarkIntegrity:  number | null;
  overallConfidence:   string | null;
  source:              string;
  sourceRecordId:      string | null;
  sourceUrl:           string | null;
  detectedAt:          string;
  blockchainStatus:    string;
  blockchainTxHash:    string | null;
  evidenceHash:        string | null;
  resolutionNotes:     string | null;
  resolvedAt:          string | null;
  fileId:       { originalName: string; extension: string } | null;
  researcherId: { name: string; email: string; institution: string } | null;
}

interface WatermarkRecord {
  watermarkId:         string;
  downloadId:          string;
  watermarkVersion:    string;
  watermarkAlgorithm:  string;
  watermarkCommitment: string;
  embeddingMethod:     string;
  originalFileHash:    string;
  watermarkedFileHash: string;
  blockchainStatus:    string;
  blockchainTxHash:    string | null;
  createdAt:           string;
}

interface Report {
  reportVersion:   string;
  generatedAt:     string;
  eventId:         string;
  watermarkId:     string;
  reportHash:      string;
  file:            { originalName: string; extension: string; datasetId: string };
  researcher:      { name: string; email: string; institution: string; orcid: string };
  detection:       Record<string, unknown>;
  watermark:       Record<string, unknown>;
  blockchain:      Record<string, unknown>;
}

// ─── Status meta ──────────────────────────────────────────────────────────────

const statusMeta: Record<string, { label: string; Icon: any; color: string; bg: string }> = {
  CONFIRMED_WATERMARK_MATCH: {
    label: "Confirmed Leak",
    Icon:  ShieldX,
    color: "text-red-400",
    bg:    "bg-red-500/10 border-red-500/30",
  },
  HIGH_CONFIDENCE_MATCH: {
    label: "High Confidence Match",
    Icon:  ShieldAlert,
    color: "text-orange-400",
    bg:    "bg-orange-500/10 border-orange-500/30",
  },
  POSSIBLE_MATCH: {
    label: "Possible Match",
    Icon:  ShieldAlert,
    color: "text-amber-400",
    bg:    "bg-amber-500/10 border-amber-500/30",
  },
  METADATA_MATCH_ONLY: {
    label: "Metadata Match — Manual Review Required",
    Icon:  AlertTriangle,
    color: "text-yellow-400",
    bg:    "bg-yellow-500/10 border-yellow-500/30",
  },
  FALSE_POSITIVE: {
    label: "False Positive",
    Icon:  CheckCircle2,
    color: "text-slate-400",
    bg:    "bg-slate-500/10 border-slate-500/30",
  },
  UNDER_REVIEW: {
    label: "Under Review",
    Icon:  AlertTriangle,
    color: "text-blue-400",
    bg:    "bg-blue-500/10 border-blue-500/30",
  },
  RESOLVED: {
    label: "Resolved",
    Icon:  CheckCircle2,
    color: "text-emerald-400",
    bg:    "bg-emerald-500/10 border-emerald-500/30",
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function MisuseIncident() {
  const { eventId }   = useParams<{ eventId: string }>();
  const navigate      = useNavigate();
  const { token }     = useAuth();
  const authHeaders   = { Authorization: `Bearer ${token}` };

  const [event,    setEvent]    = useState<MisuseEvent | null>(null);
  const [wmRecord, setWmRecord] = useState<WatermarkRecord | null>(null);
  const [report,   setReport]   = useState<Report | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [repLoading, setRepLoading] = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  const fetchEvent = useCallback(async () => {
    if (!eventId) return;
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API_BASE}/provenance/misuse-events/${eventId}`, {
        headers: authHeaders,
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setEvent(json.event);
      setWmRecord(json.watermarkRecord ?? null);
    } catch (e: any) {
      setError(e.message || "Failed to load incident");
    } finally {
      setLoading(false);
    }
  }, [eventId, token]);

  useEffect(() => { fetchEvent(); }, [fetchEvent]);

  const generateReport = async () => {
    if (!eventId) return;
    try {
      setRepLoading(true);
      const res = await fetch(
        `${API_BASE}/provenance/misuse-events/${eventId}/report`,
        { method: "POST", headers: authHeaders }
      );
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setReport(json.report);
    } catch (e: any) {
      alert(`Report generation failed: ${e.message}`);
    } finally {
      setRepLoading(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <ShieldX className="w-10 h-10 text-red-400" />
        <p className="text-red-400 text-sm">{error ?? "Event not found"}</p>
        <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back
        </Button>
      </div>
    );
  }

  const meta = statusMeta[event.status] ?? {
    label: event.status,
    Icon:  ShieldAlert,
    color: "text-slate-400",
    bg:    "bg-slate-500/10 border-slate-500/30",
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Misuse Incident"
        description={`Event ID: ${event.eventId}`}
        icon={<meta.Icon className={`w-6 h-6 ${meta.color}`} />}
        action={
          <div className="flex gap-3">
            <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
              <ArrowLeft className="w-4 h-4 mr-2" /> Back
            </Button>
            <Button
              size="sm"
              onClick={generateReport}
              disabled={repLoading}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {repLoading
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <FileText className="w-4 h-4 mr-2" />}
              Generate Evidence Report
            </Button>
          </div>
        }
      />

      {/* ── Status Banner ──────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className={`p-5 rounded-2xl border flex items-center gap-4 ${meta.bg}`}
      >
        <meta.Icon className={`w-8 h-8 ${meta.color} flex-shrink-0`} />
        <div>
          <p className={`font-semibold ${meta.color}`}>{meta.label}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            Detected on {new Date(event.detectedAt).toLocaleString()} · Source: {event.source}
          </p>
        </div>
        {event.status === "METADATA_MATCH_ONLY" && (
          <div className="ml-auto p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 text-xs text-yellow-300 max-w-xs">
            FASTQ quality data was not retrievable for this candidate.
            Watermark detection was <strong>not run</strong>. Manual review required.
          </div>
        )}
      </motion.div>

      {/* ── Detection Metrics ──────────────────────────────────────── */}
      {event.watermarkMatchScore !== null && (
        <Card className="p-6 rounded-2xl bg-slate-800/50 border border-slate-700/50">
          <h3 className="text-sm font-semibold text-slate-300 mb-4">Detection Metrics</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Match Score",      value: `${((event.watermarkMatchScore ?? 0) * 100).toFixed(1)}%` },
              { label: "Watermark Integrity", value: `${((event.watermarkIntegrity ?? 0) * 100).toFixed(1)}%` },
              { label: "Confidence",       value: event.overallConfidence ?? "—" },
              { label: "Method",           value: event.detectionMethod   ?? "—" },
            ].map(({ label, value }) => (
              <div key={label} className="p-3 rounded-xl bg-slate-700/30 border border-slate-700/50">
                <p className="text-xs text-slate-400">{label}</p>
                <p className="text-lg font-bold text-white mt-1">{value}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Source & Researcher ────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-6 rounded-2xl bg-slate-800/50 border border-slate-700/50">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">External Source</h3>
          <dl className="space-y-2 text-sm">
            <Row label="Source"    value={event.source} />
            <Row label="Accession" value={event.sourceRecordId ?? "—"} />
            {event.sourceUrl && (
              <div className="flex items-center justify-between">
                <span className="text-slate-400">URL</span>
                <a
                  href={event.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-400 flex items-center gap-1 hover:underline text-xs"
                >
                  NCBI SRA <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}
          </dl>
        </Card>

        <Card className="p-6 rounded-2xl bg-slate-800/50 border border-slate-700/50">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Attributed Researcher</h3>
          {event.researcherId ? (
            <dl className="space-y-2 text-sm">
              <Row label="Name"        value={event.researcherId.name} />
              <Row label="Email"       value={event.researcherId.email} />
              <Row label="Institution" value={event.researcherId.institution ?? "—"} />
            </dl>
          ) : (
            <p className="text-slate-500 text-sm">
              {event.status === "METADATA_MATCH_ONLY"
                ? "Researcher attribution not available for metadata-only matches."
                : "No researcher attributed."}
            </p>
          )}
        </Card>
      </div>

      {/* ── Watermark Record ───────────────────────────────────────── */}
      {wmRecord && (
        <Card className="p-6 rounded-2xl bg-slate-800/50 border border-slate-700/50">
          <h3 className="text-sm font-semibold text-slate-300 mb-4">Watermark Record</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <Row label="Watermark ID"  value={wmRecord.watermarkId} mono />
            <Row label="Download ID"   value={wmRecord.downloadId}  mono />
            <Row label="Version"       value={wmRecord.watermarkVersion} />
            <Row label="Algorithm"     value={wmRecord.watermarkAlgorithm} />
            <Row label="Method"        value={wmRecord.embeddingMethod} />
            <Row label="Blockchain"    value={wmRecord.blockchainStatus}
                 badge badgeColor={wmRecord.blockchainStatus === "ANCHORED" ? "green" : "red"} />
            <div className="col-span-2">
              <span className="text-slate-400 text-xs">Watermark Commitment (SHA-256 of payload)</span>
              <p className="font-mono text-xs text-slate-300 mt-1 break-all">
                {wmRecord.watermarkCommitment}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* ── Evidence Report ────────────────────────────────────────── */}
      {report && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <Card className="p-6 rounded-2xl bg-emerald-900/20 border border-emerald-500/30">
            <h3 className="text-sm font-semibold text-emerald-300 mb-2 flex items-center gap-2">
              <FileText className="w-4 h-4" /> Evidence Report Generated
            </h3>
            <p className="text-xs text-slate-400 mb-3">
              Generated at {new Date(report.generatedAt).toLocaleString()} ·
              Anchoring to blockchain in background
            </p>
            <div className="p-3 rounded-xl bg-slate-900/50 font-mono text-xs text-slate-300">
              <p><span className="text-slate-500">Report Hash:</span> {report.reportHash}</p>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              Note: watermarkSeed is intentionally excluded from this report per security policy.
            </p>
          </Card>
        </motion.div>
      )}
    </div>
  );
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function Row({
  label,
  value,
  mono   = false,
  badge  = false,
  badgeColor = "slate",
}: {
  label: string;
  value: string;
  mono?:  boolean;
  badge?: boolean;
  badgeColor?: "green" | "red" | "slate";
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-slate-400 flex-shrink-0">{label}</span>
      {badge ? (
        <Badge
          variant="outline"
          className={`text-xs ${
            badgeColor === "green" ? "border-emerald-500/40 text-emerald-400" :
            badgeColor === "red"   ? "border-red-500/40 text-red-400" :
            "border-slate-500/40 text-slate-400"
          }`}
        >
          {value}
        </Badge>
      ) : (
        <span className={`${mono ? "font-mono" : ""} text-slate-200 text-right break-all`}>
          {value}
        </span>
      )}
    </div>
  );
}
