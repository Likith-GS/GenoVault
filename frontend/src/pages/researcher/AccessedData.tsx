import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  DatabaseZap, RefreshCw, Download, Clock, ShieldCheck,
  Loader2, AlertTriangle, ExternalLink, HardDrive, Calendar,
  Dna, CheckCircle2, TimerReset,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge }  from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────
interface ApprovedAccess {
  _id: string;
  status: string;
  approvedAt?: string;
  accessExpiresAt?: string;
  approveTxHash?: string;
  approveEtherscanUrl?: string;
  file: {
    _id: string;
    originalName: string;
    extension: string;
    sizeBytes: number;
    blockchainFileId?: number;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatSize(bytes: number) {
  if (bytes < 1048576)    return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

function formatDate(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatCountdown(ms: number) {
  if (ms <= 0) return "Expired";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  return `${h}h ${String(m).padStart(2,"0")}m ${String(s).padStart(2,"0")}s`;
}

const EXT_COLORS: Record<string, { bg: string; text: string }> = {
  ".fastq": { bg: "bg-violet-500/15", text: "text-violet-400" },
  ".bam":   { bg: "bg-cyan-500/15",   text: "text-cyan-400"   },
  ".vcf":   { bg: "bg-emerald-500/15",text: "text-emerald-400" },
};

// ── 1-second ticker ───────────────────────────────────────────────────────────
function useTick(ms = 1000) {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN(n => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}

// ── Access Card ───────────────────────────────────────────────────────────────
function AccessCard({ access, token, onExpired }: {
  access: ApprovedAccess;
  token: string | null;
  onExpired: (id: string) => void;
}) {
  useTick(1000);
  const [downloading,  setDownloading]  = useState(false);
  const [dlProgress,   setDlProgress]   = useState(0); // 0-100

  const expiresMs     = access.accessExpiresAt ? new Date(access.accessExpiresAt).getTime() : 0;
  const approvedMs    = access.approvedAt ? new Date(access.approvedAt).getTime() : expiresMs - 86_400_000;
  const totalDuration = 24 * 3_600_000;
  const remaining     = expiresMs - Date.now();
  const elapsed       = totalDuration - remaining;
  const pct           = Math.max(0, Math.min(100, (elapsed / totalDuration) * 100));
  const isActive      = remaining > 0;

  // Notify parent when expired so the card can be removed
  useEffect(() => {
    if (!isActive) onExpired(access._id);
  }, [isActive, access._id, onExpired]);

  const ext = EXT_COLORS[access.file.extension] ?? EXT_COLORS[".vcf"];

  const handleDownload = async () => {
    if (!token || downloading) return;
    setDownloading(true);
    setDlProgress(0);
    try {
      const res = await fetch(`http://localhost:5000/api/access/download/${access.file._id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        let msg = `Download failed (${res.status})`;
        try { const d = await res.json(); msg = d.message || msg; } catch {}
        throw new Error(msg);
      }

      const contentLength = Number(res.headers.get("Content-Length") ?? 0);

      // ── Stream directly to disk (no 500MB RAM buffer) ─────────────────
      // Uses File System Access API (Chrome 86+, Edge 86+).
      // Falls back to Blob+createObjectURL for other browsers.
      if ("showSaveFilePicker" in window) {
        let fileHandle: FileSystemFileHandle;
        try {
          fileHandle = await (window as any).showSaveFilePicker({
            suggestedName: access.file.originalName,
            types: [{
              description: "Genomic File",
              accept: { "application/octet-stream": [".bam", ".fastq", ".vcf", ".gz"] },
            }],
          });
        } catch (pickerErr: any) {
          // User cancelled the save dialog — abort cleanly
          if (pickerErr.name === "AbortError") { setDownloading(false); return; }
          throw pickerErr;
        }

        const writable = await (fileHandle as any).createWritable();
        const reader   = res.body!.getReader();
        let received   = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await writable.write(value);
          received += value.length;
          if (contentLength > 0) setDlProgress(Math.round((received / contentLength) * 100));
        }
        await writable.close();
        toast.success(`✅ ${access.file.originalName} saved to disk!`);

      } else {
        // ── Fallback: buffer in memory then trigger anchor click ──────────
        const reader = res.body!.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          if (contentLength > 0) setDlProgress(Math.round((received / contentLength) * 100));
        }

        const blob = new Blob(chunks);
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href     = url;
        a.download = access.file.originalName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast.success(`✅ ${access.file.originalName} downloaded!`);
      }
    } catch (e: any) {
      toast.error(e.message || "Download failed");
    } finally {
      setDownloading(false);
      setDlProgress(0);
    }
  };


  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="rounded-xl border border-border bg-card p-5 shadow-card hover:shadow-elegant transition-shadow"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={`h-11 w-11 rounded-xl flex items-center justify-center flex-shrink-0 ${ext.bg}`}>
            <Dna className={`h-5 w-5 ${ext.text}`} />
          </div>
          <div>
            <p className="font-semibold text-sm truncate max-w-[200px]" title={access.file.originalName}>
              {access.file.originalName}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
              <HardDrive className="h-3 w-3" />
              {formatSize(access.file.sizeBytes)}
            </p>
          </div>
        </div>
        <Badge className={isActive ? "bg-emerald-500/15 text-emerald-400 border-0" : "bg-zinc-500/15 text-zinc-400 border-0"}>
          {isActive ? <><ShieldCheck className="h-3 w-3 mr-1" />Active</> : "Expired"}
        </Badge>
      </div>

      {/* Countdown */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" /> Time remaining
          </span>
          <span className={`font-mono font-semibold ${isActive ? "text-foreground" : "text-muted-foreground"}`}>
            {formatCountdown(remaining)}
          </span>
        </div>
        <Progress value={pct} className={`h-1.5 ${!isActive ? "opacity-40" : ""}`} />
      </div>

      {/* Metadata */}
      <div className="space-y-1 mb-4 text-xs text-muted-foreground">
        <p className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3 w-3 text-emerald-400" />
          Approved: {formatDate(access.approvedAt)}
        </p>
        <p className="flex items-center gap-1.5">
          <TimerReset className="h-3 w-3" />
          Expires: {formatDate(access.accessExpiresAt)}
        </p>
        {access.approveEtherscanUrl && (
          <a
            href={access.approveEtherscanUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-blue-400 hover:underline"
          >
            <ExternalLink className="h-3 w-3" /> View approval on Etherscan
          </a>
        )}
      </div>

      {/* Download button */}
      <Button
        className="w-full relative overflow-hidden"
        size="sm"
        disabled={!isActive || downloading}
        onClick={handleDownload}
      >
        {/* Progress fill behind text */}
        {downloading && dlProgress > 0 && (
          <span
            className="absolute inset-0 bg-emerald-500/30 transition-all duration-300"
            style={{ width: `${dlProgress}%` }}
          />
        )}
        <span className="relative flex items-center justify-center gap-2">
          {downloading ? (
            <><Loader2 className="h-4 w-4 animate-spin" />
              {dlProgress > 0 ? `Downloading… ${dlProgress}%` : "Preparing…"}
            </>
          ) : (
            <><Download className="h-4 w-4" />Download File</>
          )}
        </span>
      </Button>
    </motion.div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AccessedData() {
  const { token } = useAuth();
  const [accesses,   setAccesses]   = useState<ApprovedAccess[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAccesses = useCallback(async (silent = false) => {
    if (!token) { setLoading(false); return; }   // no token → stop skeleton
    if (!silent) setLoading(true); else setRefreshing(true);
    setError(null);
    try {
      const res  = await fetch("http://localhost:5000/api/access/my-requests", {
        headers: { Authorization: `Bearer ${token}` },
        cache:   "no-store",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to load");

      // Only show approved grants that haven't expired yet, and skip orphaned (null file/owner)
      const active = (data.requests ?? []).filter((r: ApprovedAccess) => {
        if (!r.file || !r.owner) return false;   // deleted doc guard
        if (r.status !== "approved") return false;
        if (!r.accessExpiresAt) return true;
        return new Date(r.accessExpiresAt).getTime() > Date.now();
      });
      setAccesses(active);
    } catch (e: any) {
      setError(e.message || "Network error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => { fetchAccesses(); }, [fetchAccesses]);

  // Poll every 30 s
  useEffect(() => {
    const id = setInterval(() => fetchAccesses(true), 30_000);
    return () => clearInterval(id);
  }, [fetchAccesses]);

  // Remove an individual card when its timer expires
  const handleExpired = useCallback((id: string) => {
    setAccesses(prev => prev.filter(a => a._id !== id));
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Accessed Data</h2>
          <p className="text-muted-foreground mt-1">
            {accesses.length > 0
              ? `${accesses.length} active grant${accesses.length !== 1 ? "s" : ""} — download before they expire.`
              : "Manage active sessions and verify genomic data integrity before use."}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => fetchAccesses(true)} disabled={refreshing}>
          <RefreshCw className={`h-4 w-4 mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-5 space-y-4 animate-pulse">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 rounded-xl bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-muted rounded w-2/3" />
                  <div className="h-3 bg-muted rounded w-1/3" />
                </div>
              </div>
              <div className="h-2 bg-muted rounded-full" />
              <div className="h-9 bg-muted rounded-lg" />
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="flex flex-col items-center py-12 text-center rounded-xl border border-dashed border-red-500/30 bg-red-500/5">
          <AlertTriangle className="h-8 w-8 text-red-400 mb-2" />
          <p className="text-sm text-red-400">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => fetchAccesses()}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Retry
          </Button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && accesses.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex flex-col items-center justify-center text-center py-20 rounded-xl border border-dashed"
        >
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <DatabaseZap className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-1">No Active Data Sessions</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Once an owner approves your access request, the dataset will appear here with a live countdown timer and download option.
          </p>
        </motion.div>
      )}

      {/* Active grants grid */}
      {!loading && !error && accesses.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {accesses.map(access => (
            <AccessCard
              key={access._id}
              access={access}
              token={token}
              onExpired={handleExpired}
            />
          ))}
        </div>
      )}
    </div>
  );
}
