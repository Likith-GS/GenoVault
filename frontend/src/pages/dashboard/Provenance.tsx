import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Shield, ShieldCheck, ShieldAlert, ShieldX,
  Download, Search, RefreshCw, Loader2, AlertTriangle,
  CheckCircle2, Clock, ExternalLink, ChevronRight,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Card }       from "@/components/ui/card";
import { Button }     from "@/components/ui/button";
import { Badge }      from "@/components/ui/badge";
import { useAuth }    from "@/contexts/AuthContext";

const API_BASE = "http://localhost:5000/api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MisuseSummary {
  confirmed:    number;
  possible:     number;
  metadataOnly: number;
  total:        number;
}

interface RecentDownload {
  _id:          string;
  watermarkId:  string;
  downloadId:   string;
  watermarkVersion: string;
  embeddingMethod:  string;
  fileFormat:       string;
  blockchainStatus: string;
  createdAt:        string;
  originalFileName: string | null;
  fileId:      { originalName: string; extension: string } | null;
  researcherId:{ name: string; email: string } | null;
}

interface FormatStrengthEntry {
  level: "STRONG" | "LIMITED";
  label: string;
  icon:  string;
}

interface DashboardData {
  fileStats:     Array<{
    _id:             string;
    totalDownloads:  number;
    activeCount:     number;
    watermarkVersion:string;
    embeddingMethod: string;
    lastDownload:    string | null;
  }>;
  misuseSummary:  MisuseSummary;
  recentDownloads:RecentDownload[];
  formatStrength: Record<string, FormatStrengthEntry>;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Provenance() {
  const { token } = useAuth();
  const [data,    setData]    = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [scanning,setScanning]= useState(false);
  const [scanMsg, setScanMsg] = useState<string | null>(null);

  const authHeaders = { Authorization: `Bearer ${token}` };

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API_BASE}/provenance/dashboard`, { headers: authHeaders });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setData(json.dashboard);
    } catch (e: any) {
      setError(e.message || "Failed to load provenance dashboard");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  const startScan = async () => {
    try {
      setScanning(true);
      setScanMsg(null);
      const res = await fetch(`${API_BASE}/provenance/scans`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (json.success) {
        setScanMsg(`Scan started — ID: ${json.scanId}. Check the Misuse Events tab for results.`);
      } else {
        setScanMsg(`Scan failed: ${json.message}`);
      }
    } catch (e: any) {
      setScanMsg(`Scan error: ${e.message}`);
    } finally {
      setScanning(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
        <span className="ml-3 text-slate-400">Loading provenance data…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <ShieldX className="w-10 h-10 text-red-400" />
        <p className="text-red-400 text-sm">{error}</p>
        <Button variant="outline" size="sm" onClick={fetchDashboard}>
          <RefreshCw className="w-4 h-4 mr-2" /> Retry
        </Button>
      </div>
    );
  }

  const mis = data?.misuseSummary;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Genomic Data Provenance"
        description="Watermark coverage, researcher accountability, and misuse detection"
        icon={<Shield className="w-6 h-6 text-indigo-400" />}
        action={
          <div className="flex gap-3">
            <Button variant="outline" size="sm" onClick={fetchDashboard}>
              <RefreshCw className="w-4 h-4 mr-2" /> Refresh
            </Button>
            <Button
              size="sm"
              onClick={startScan}
              disabled={scanning}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {scanning
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <Search className="w-4 h-4 mr-2" />}
              {scanning ? "Starting scan…" : "Start NCBI Scan"}
            </Button>
          </div>
        }
      />

      {scanMsg && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-sm"
        >
          {scanMsg}
        </motion.div>
      )}

      {/* ── Misuse Alert Summary ───────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: "Confirmed Leaks",
            value: mis?.confirmed ?? 0,
            Icon:  ShieldX,
            color: "text-red-400",
            bg:    "bg-red-500/10 border-red-500/20",
          },
          {
            label: "Possible Matches",
            value: mis?.possible ?? 0,
            Icon:  ShieldAlert,
            color: "text-amber-400",
            bg:    "bg-amber-500/10 border-amber-500/20",
          },
          {
            label: "Metadata Only",
            value: mis?.metadataOnly ?? 0,
            Icon:  AlertTriangle,
            color: "text-yellow-400",
            bg:    "bg-yellow-500/10 border-yellow-500/20",
          },
          {
            label: "Total Events",
            value: mis?.total ?? 0,
            Icon:  Shield,
            color: "text-slate-400",
            bg:    "bg-slate-500/10 border-slate-500/20",
          },
        ].map(({ label, value, Icon, color, bg }) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <Card className={`p-5 border ${bg} rounded-2xl`}>
              <div className="flex items-center gap-3">
                <Icon className={`w-6 h-6 ${color}`} />
                <div>
                  <p className="text-2xl font-bold text-white">{value}</p>
                  <p className="text-xs text-slate-400">{label}</p>
                </div>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* ── Watermark Strength by Format ───────────────────────────── */}
      <Card className="p-6 rounded-2xl bg-slate-800/50 border border-slate-700/50">
        <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-indigo-400" />
          Watermark Strength by File Format
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Object.entries(data?.formatStrength ?? {}).map(([ext, info]) => (
            <div
              key={ext}
              className={`p-4 rounded-xl border ${
                info.level === "STRONG"
                  ? "bg-emerald-500/10 border-emerald-500/20"
                  : "bg-amber-500/10 border-amber-500/20"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">{info.icon}</span>
                <span className="font-mono text-sm text-slate-300 uppercase">{ext}</span>
              </div>
              <p className={`text-xs ${info.level === "STRONG" ? "text-emerald-300" : "text-amber-300"}`}>
                {info.label}
              </p>
              {info.level === "LIMITED" && (
                <p className="text-xs text-slate-500 mt-1">
                  Metadata watermark only — can be stripped by standard tools
                </p>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* ── Recent Watermarked Downloads ───────────────────────────── */}
      <Card className="p-6 rounded-2xl bg-slate-800/50 border border-slate-700/50">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
            <Download className="w-4 h-4 text-indigo-400" />
            Recent Watermarked Downloads
          </h3>
          <Button variant="ghost" size="sm" className="text-indigo-400 text-xs gap-1">
            View all <ChevronRight className="w-3 h-3" />
          </Button>
        </div>

        {!data?.recentDownloads?.length ? (
          <p className="text-slate-500 text-sm text-center py-8">No watermarked downloads yet.</p>
        ) : (
          <div className="space-y-3">
            {data.recentDownloads.map((dl) => (
              <motion.div
                key={dl._id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center justify-between p-4 rounded-xl bg-slate-700/30 border border-slate-700/50"
              >
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${
                    dl.blockchainStatus === "ANCHORED" ? "bg-emerald-400" :
                    dl.blockchainStatus === "FAILED"   ? "bg-red-400" : "bg-amber-400"
                  }`} />
                  <div>
                    <p className="text-sm text-white font-medium">
                      {dl.fileId?.originalName ?? dl.originalFileName ?? "Unknown file"}
                    </p>
                    <p className="text-xs text-slate-400">
                      {dl.researcherId?.name ?? "Unknown"} · {dl.watermarkId}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge
                    variant="outline"
                    className={`text-xs ${
                      dl.watermarkVersion === "GENOMIC_LSB_V1"
                        ? "border-emerald-500/40 text-emerald-400"
                        : "border-amber-500/40 text-amber-400"
                    }`}
                  >
                    {dl.watermarkVersion === "GENOMIC_LSB_V1" ? "✅ Strong" : "⚠️ Metadata"}
                  </Badge>
                  <span className="text-xs text-slate-500 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(dl.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </Card>

      {/* ── PARTIAL scan warning note ───────────────────────────────── */}
      <div className="p-4 rounded-xl bg-slate-700/30 border border-slate-700/50 text-xs text-slate-400">
        <AlertTriangle className="w-3 h-3 inline mr-1 text-amber-400" />
        <strong className="text-slate-300">Note on NCBI scans:</strong>{" "}
        Metadata-only matches require manual review — FASTQ quality data was not retrievable for these
        candidates. A PARTIAL scan result does NOT mean "no misuse detected"; check which sources
        were unavailable in the scan detail view.
      </div>
    </div>
  );
}
