import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  ShieldCheck, ShieldAlert, FileText, RefreshCw, Dna,
  Loader2, CheckCircle2, XCircle, Clock, ExternalLink,
} from "lucide-react";
import { PageHeader }   from "@/components/dashboard/PageHeader";
import { Card }         from "@/components/ui/card";
import { Button }       from "@/components/ui/button";
import { Badge }        from "@/components/ui/badge";
import { useAuth }      from "@/contexts/AuthContext";

const API_BASE = "http://localhost:5000/api";

interface LayerResult {
  status: "PASS" | "FAIL" | "SKIP" | "PENDING";
  reason?: string;
  error?:  string;
  note?:   string;
  etherscanUrl?: string;
  txHash?:       string | number | null;
  blockNumber?:  string | number | null;
  registeredAt?: string | null;
  [key: string]: unknown;
}

interface IntegrityResult {
  fileId:           string;
  fileName:         string;
  datasetId:        string | null;
  checks: {
    sha256:     LayerResult;
    blockchain: LayerResult;
    aes:        LayerResult;
    azure:      LayerResult;
    ipfs:       LayerResult;
  };
  overall:          string;   // SECURE | PENDING | INTEGRITY_VIOLATION | KEY_OR_DECRYPTION_FAILURE | etc.
  overallIsFailure: boolean;  // true for anything other than SECURE or PENDING
  checkedAt:        string;
}

interface SimpleFile {
  _id:          string;
  originalName: string;
  sizeBytes:    number;
  createdAt:    string;
  datasetId?:   string | null;
}

const formatBytes = (b: number) => {
  if (b >= 1e9) return (b / 1e9).toFixed(2) + " GB";
  if (b >= 1e6) return (b / 1e6).toFixed(1) + " MB";
  if (b >= 1e3) return (b / 1e3).toFixed(0) + " KB";
  return b + " B";
};

const LayerBadge = ({ name, result }: { name: string; result?: LayerResult }) => {
  if (!result) return null;
  const { status, reason, note, error } = result;
  const tooltip = reason ?? error ?? note ?? "";
  const cls =
    status === "PASS"    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" :
    status === "FAIL"    ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" :
    status === "PENDING" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" :
                           "bg-muted text-muted-foreground";
  const Icon = status === "PASS" ? CheckCircle2 : status === "FAIL" ? XCircle : Clock;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`} title={tooltip}>
      <Icon className="h-3 w-3 shrink-0" />{name}
    </span>
  );
};

const Verification = () => {
  const { token = "" } = useAuth();
  const [files,    setFiles]    = useState<SimpleFile[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [results,  setResults]  = useState<Record<string, IntegrityResult>>({});
  const [checking, setChecking] = useState<Record<string, boolean>>({});

  const fetchFiles = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/files/my-files`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok) setFiles(data.files ?? []);
    } catch { /* ignore */ } finally { setLoading(false); }
  }, [token]);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  // Full integrity check — Re-verify button: includes live SHA-256 blob streaming.
  const checkFile = useCallback(async (fileId: string) => {
    setChecking(c => ({ ...c, [fileId]: true }));
    try {
      // No skipSha → full check including live SHA-256 vs blockchainFileHash comparison
      const res  = await fetch(`${API_BASE}/integrity/${fileId}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok && data.success) setResults(r => ({ ...r, [fileId]: data as IntegrityResult }));
    } catch { /* ignore */ } finally { setChecking(c => ({ ...c, [fileId]: false })); }
  }, [token]);

  // Fast auto-check on page load: skipSha=true skips 500MB blob streaming.
  // AES / Azure / IPFS / Blockchain results are instant. SHA shows as SKIP with
  // a prompt to click Re-verify for the live hash comparison.
  const autoCheckFile = useCallback(async (fileId: string) => {
    setChecking(c => ({ ...c, [fileId]: true }));
    try {
      const res  = await fetch(`${API_BASE}/integrity/${fileId}?skipSha=true`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && data.success) setResults(r => ({ ...r, [fileId]: data as IntegrityResult }));
    } catch { /* ignore */ } finally { setChecking(c => ({ ...c, [fileId]: false })); }
  }, [token]);

  useEffect(() => {
    if (!token || files.length === 0) return;
    files.forEach(f => autoCheckFile(f._id));
  }, [token, files, autoCheckFile]);

  const secureCount = Object.values(results).filter(r => r.overall === "SECURE").length;
  const atRiskCount = Object.values(results).filter(r => r.overallIsFailure).length;


  return (
    <>
      <PageHeader title="Data Verification" description="5-layer integrity check: SHA-256 · Blockchain · AES · Azure · IPFS" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {[
          { label: "Secure",      value: secureCount,  color: "bg-emerald-500/10 text-emerald-600", icon: ShieldCheck },
          { label: "At Risk",     value: atRiskCount,  color: "bg-destructive/10 text-destructive",  icon: ShieldAlert },
          { label: "Total Files", value: files.length, color: "bg-primary/10 text-primary",          icon: FileText },
        ].map(({ label, value, color, icon: Icon }) => (
          <Card key={label} className="p-5 shadow-card">
            <div className="flex items-center gap-3">
              <div className={`h-11 w-11 rounded-xl flex items-center justify-center ${color}`}><Icon className="h-5 w-5" /></div>
              <div><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-bold">{value}</p></div>
            </div>
          </Card>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 text-muted-foreground animate-spin" /></div>
      ) : files.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          <Dna className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No files uploaded yet.</p>
          <Button variant="ghost" size="sm" className="mt-3" onClick={fetchFiles}><RefreshCw className="h-3.5 w-3.5 mr-1.5" />Refresh</Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {files.map((f, i) => {
            const result     = results[f._id];
            const isChecking = checking[f._id] ?? false;
            const overall    = result?.overall;
            const borderCls  = !result ? "border-l-muted-foreground/30" : overall === "SECURE" ? "border-l-emerald-500" : "border-l-destructive";
            return (
              <motion.div key={f._id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <Card className={`p-5 shadow-card border-l-4 ${borderCls}`}>
                  {/* Header */}
                  <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-10 w-10 rounded-lg bg-accent flex items-center justify-center shrink-0"><FileText className="h-4 w-4" /></div>
                      <div className="min-w-0">
                        <p className="font-medium truncate">{f.originalName}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatBytes(f.sizeBytes)} · {new Date(f.createdAt).toLocaleDateString()}
                          {f.datasetId && <span className="ml-2 font-mono">{f.datasetId}</span>}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isChecking && <Badge variant="secondary" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />Checking…</Badge>}
                      {!isChecking && overall && (
                        <Badge className={overall === "SECURE" ? "bg-emerald-500 text-white hover:bg-emerald-600" : "bg-destructive text-destructive-foreground"}>
                          {overall === "SECURE" ? <><ShieldCheck className="h-3 w-3 mr-1" />SECURE</> : <><ShieldAlert className="h-3 w-3 mr-1" />AT RISK</>}
                        </Badge>
                      )}
                      <Button variant="outline" size="sm" onClick={() => checkFile(f._id)} disabled={isChecking}>
                        <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isChecking ? "animate-spin" : ""}`} />Re-verify
                      </Button>
                    </div>
                  </div>

                  {/* Layer pills */}
                  {result && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      <LayerBadge name="SHA-256"    result={result.checks.sha256} />
                      <LayerBadge name="Blockchain" result={result.checks.blockchain} />
                      <LayerBadge name="AES-256"    result={result.checks.aes} />
                      <LayerBadge name="Azure"      result={result.checks.azure} />
                      <LayerBadge name="IPFS"       result={result.checks.ipfs} />
                    </div>
                  )}

                  {/* Blockchain panel */}
                  {result?.checks.blockchain.status === "PASS" && (
                    <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs flex flex-wrap gap-x-6 gap-y-1">
                      {result.checks.blockchain.txHash && (
                        <span>
                          <span className="text-muted-foreground">Tx: </span>
                          <span className="font-mono">{String(result.checks.blockchain.txHash).slice(0, 18)}…</span>
                          {result.checks.blockchain.etherscanUrl && (
                            <a href={String(result.checks.blockchain.etherscanUrl)} target="_blank" rel="noopener noreferrer"
                              className="ml-1 text-primary hover:underline inline-flex items-center gap-0.5">
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </span>
                      )}
                      {result.checks.blockchain.blockNumber && (
                        <span><span className="text-muted-foreground">Block: </span>{Number(result.checks.blockchain.blockNumber).toLocaleString()}</span>
                      )}
                      <span><span className="text-muted-foreground">Network: </span>Ethereum Sepolia</span>
                      {result.checks.blockchain.registeredAt && (
                        <span><span className="text-muted-foreground">Registered: </span>{new Date(String(result.checks.blockchain.registeredAt)).toLocaleDateString()}</span>
                      )}
                    </div>
                  )}

                  {/* Fail reasons */}
                  {result && Object.entries(result.checks).some(([, v]) => v.status === "FAIL") && (
                    <div className="mt-2 rounded-lg bg-destructive/5 border border-destructive/20 px-3 py-2 text-xs space-y-1">
                      {Object.entries(result.checks).map(([layer, v]) =>
                        v.status === "FAIL" ? (
                          <p key={layer} className="text-destructive">
                            <span className="font-semibold capitalize">{layer}: </span>
                            {v.reason ?? v.error ?? "Check failed"}
                          </p>
                        ) : null
                      )}
                    </div>
                  )}
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}
    </>
  );
};

export default Verification;

