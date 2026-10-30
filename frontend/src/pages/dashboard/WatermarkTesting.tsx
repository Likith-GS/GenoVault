import { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  FlaskConical, Upload, FileText, CheckCircle2, XCircle,
  AlertTriangle, ShieldCheck, ShieldX, Loader2, RefreshCw,
  User, UserCheck, FileSearch, Info,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { Card }       from "@/components/ui/card";
import { Button }     from "@/components/ui/button";
import { Badge }      from "@/components/ui/badge";
import { useAuth }    from "@/contexts/AuthContext";

const API_BASE = "http://localhost:5000/api";

// ─── Types ────────────────────────────────────────────────────────
interface FileState {
  file: File | null;
  error: string | null;
}

interface TestResult {
  testedAt: string;
  ownerInfo: { name: string; email: string; institution: string | null } | null;
  originalFileName: string;
  watermarkedFileName: string;
  originalFileSize: number;
  watermarkedFileSize: number;
  originalFile:    { valid: boolean; readCount: number; error: string | null };
  watermarkedFile: { valid: boolean; readCount: number; error: string | null };
  readComparison: {
    totalOriginalReads: number;
    totalWatermarkedReads: number;
    matchingReadIds: number;
    readsOnlyInOriginal: number;
    readsOnlyInWatermarked: number;
    dnaSequencesUnchanged: boolean;
    dnaSequencesMatched: number;
    dnaSequencesMismatched: number;
    readSetMatch: boolean;
  } | null;
  watermarkRecordsChecked: number;
  bestMatch: {
    watermarkId: string;
    downloadId: string;
    algorithm: string;
    createdAt: string;
    matchScore: number;
    integrity: number;
    verified: boolean;
    commitmentMatch: boolean;
    fileInfo: { originalName: string; extension: string; datasetId: string | null } | null;
    researcherInfo: { name: string; email: string; institution: string | null } | null;
  } | null;
  outcome: "WATERMARK_VERIFIED" | "WATERMARK_NOT_VERIFIED" | "VERIFICATION_UNAVAILABLE" | "INVALID_INPUT";
  outcomeDetail: string;
}

// ─── Helpers ──────────────────────────────────────────────────────
function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}

const OUTCOME_META = {
  WATERMARK_VERIFIED:         { color: "text-emerald-400", border: "border-emerald-500/40", bg: "bg-emerald-500/10", Icon: ShieldCheck, label: "WATERMARK VERIFIED" },
  WATERMARK_NOT_VERIFIED:     { color: "text-red-400",     border: "border-red-500/40",     bg: "bg-red-500/10",     Icon: ShieldX,     label: "WATERMARK NOT VERIFIED" },
  VERIFICATION_UNAVAILABLE:   { color: "text-amber-400",   border: "border-amber-500/40",   bg: "bg-amber-500/10",   Icon: AlertTriangle,label: "VERIFICATION UNAVAILABLE" },
  INVALID_INPUT:              { color: "text-slate-400",   border: "border-slate-500/40",   bg: "bg-slate-500/10",   Icon: XCircle,     label: "INVALID INPUT" },
};

// ─── File Upload Box ──────────────────────────────────────────────
function FileUploadBox({
  id, label, description, state, onChange,
}: {
  id: string; label: string; description: string;
  state: FileState; onChange: (f: File | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0] ?? null;
    onChange(f);
  };

  const validate = (f: File | null) => {
    if (!f) return onChange(null);
    const ok = f.name.endsWith(".fastq") || f.name.endsWith(".fastq.gz");
    if (!ok) { onChange(null); return; }
    onChange(f);
  };

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-slate-300">{label}</label>
      <p className="text-xs text-slate-500">{description}</p>
      <div
        onDrop={handleDrop}
        onDragOver={e => e.preventDefault()}
        onClick={() => ref.current?.click()}
        className={`relative border-2 border-dashed rounded-2xl p-6 cursor-pointer transition-all
          ${state.file
            ? "border-indigo-500/60 bg-indigo-500/5"
            : "border-slate-600/60 bg-slate-800/30 hover:border-indigo-500/40 hover:bg-slate-800/50"
          }`}
      >
        <input
          id={id}
          ref={ref}
          type="file"
          accept=".fastq,.fastq.gz"
          className="hidden"
          onChange={e => validate(e.target.files?.[0] ?? null)}
        />
        {state.file ? (
          <div className="flex items-center gap-3">
            <FileText className="w-8 h-8 text-indigo-400 flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-white truncate">{state.file.name}</p>
              <p className="text-xs text-slate-400 mt-0.5">{fmtBytes(state.file.size)}</p>
            </div>
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onChange(null); if (ref.current) ref.current.value = ""; }}
              className="ml-auto text-slate-500 hover:text-red-400 transition-colors"
            >
              <XCircle className="w-5 h-5" />
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-center">
            <Upload className="w-8 h-8 text-slate-500" />
            <p className="text-sm text-slate-400">Drag & drop or click to upload</p>
            <p className="text-xs text-slate-600">.fastq or .fastq.gz</p>
          </div>
        )}
      </div>
      {state.error && (
        <p className="text-xs text-red-400 flex items-center gap-1">
          <XCircle className="w-3 h-3" /> {state.error}
        </p>
      )}
    </div>
  );
}

// ─── Result Row ───────────────────────────────────────────────────
function Row({ label, value, ok }: { label: string; value: React.ReactNode; ok?: boolean | null }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-slate-700/40 last:border-0">
      <span className="text-xs text-slate-400">{label}</span>
      <span className={`text-xs font-medium flex items-center gap-1 ${
        ok === true ? "text-emerald-400" : ok === false ? "text-red-400" : "text-slate-200"
      }`}>
        {ok === true  && <CheckCircle2 className="w-3 h-3" />}
        {ok === false && <XCircle className="w-3 h-3" />}
        {value}
      </span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────
export default function WatermarkTesting() {
  const { token } = useAuth();

  const [origFile, setOrigFile]   = useState<FileState>({ file: null, error: null });
  const [wmFile,   setWmFile]     = useState<FileState>({ file: null, error: null });
  const [loading,  setLoading]    = useState(false);
  const [result,   setResult]     = useState<TestResult | null>(null);
  const [apiError, setApiError]   = useState<string | null>(null);

  const canRun = origFile.file !== null && wmFile.file !== null && !loading;

  const handleRun = async () => {
    if (!canRun) return;
    setLoading(true);
    setResult(null);
    setApiError(null);

    const form = new FormData();
    form.append("originalFile",    origFile.file!);
    form.append("watermarkedFile", wmFile.file!);

    try {
      const res = await fetch(`${API_BASE}/testing/watermark-test`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const json = await res.json();
      if (!json.success && !json.outcome) throw new Error(json.message || "Test failed");
      setResult(json as TestResult);
    } catch (e: any) {
      setApiError(e.message || "Unexpected error");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setOrigFile({ file: null, error: null });
    setWmFile({ file: null, error: null });
    setResult(null);
    setApiError(null);
  };

  const outcomeMeta = result ? OUTCOME_META[result.outcome] : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Watermark Testing"
        description="Demonstration tool — verify whether a researcher-downloaded file carries a genuine GenoVault watermark"
        icon={<FlaskConical className="w-6 h-6 text-violet-400" />}
        action={
          result && (
            <Button variant="outline" size="sm" onClick={handleReset}>
              <RefreshCw className="w-4 h-4 mr-2" /> New Test
            </Button>
          )
        }
      />

      {/* ── Info banner ─────────────────────────────────────────── */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-violet-500/10 border border-violet-500/20 text-sm text-violet-300">
        <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>
          Upload the <strong>original FASTQ</strong> you provided and the <strong>watermarked copy</strong> 
          downloaded through GenoVault. The system will verify the watermark cryptographically 
          against your real watermark records — no secrets are exposed.
        </span>
      </div>

      {/* ── Upload section ──────────────────────────────────────── */}
      {!result && (
        <Card className="p-6 rounded-2xl bg-slate-800/50 border border-slate-700/50 space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <FileUploadBox
              id="orig"
              label="① Original User File"
              description="The unmodified FASTQ before watermark embedding (reference file)"
              state={origFile}
              onChange={f => setOrigFile({ file: f, error: null })}
            />
            <FileUploadBox
              id="wm"
              label="② Researcher-Downloaded Watermarked File"
              description="The FASTQ downloaded through GenoVault's researcher interface"
              state={wmFile}
              onChange={f => setWmFile({ file: f, error: null })}
            />
          </div>

          {apiError && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              <XCircle className="w-4 h-4 flex-shrink-0" /> {apiError}
            </div>
          )}

          <div className="flex justify-end">
            <Button
              onClick={handleRun}
              disabled={!canRun}
              className="bg-violet-600 hover:bg-violet-700 text-white px-8"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Running Test…</>
              ) : (
                <><FlaskConical className="w-4 h-4 mr-2" /> Run Watermark Test</>
              )}
            </Button>
          </div>
        </Card>
      )}

      {/* ── Results ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y:  0 }}
            className="space-y-4"
          >
            {/* Outcome banner */}
            {outcomeMeta && (
              <div className={`flex items-center gap-3 p-5 rounded-2xl border ${outcomeMeta.border} ${outcomeMeta.bg}`}>
                <outcomeMeta.Icon className={`w-7 h-7 flex-shrink-0 ${outcomeMeta.color}`} />
                <div>
                  <p className={`text-base font-bold ${outcomeMeta.color}`}>{outcomeMeta.label}</p>
                  <p className="text-sm text-slate-300 mt-0.5">{result.outcomeDetail}</p>
                </div>
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-4">

              {/* File Validation */}
              <Card className="p-5 rounded-2xl bg-slate-800/50 border border-slate-700/50">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                  <FileSearch className="w-4 h-4" /> File Validation
                </p>
                <Row label="Original file"    value={result.originalFile.valid    ? "PASS" : "FAIL"} ok={result.originalFile.valid} />
                <Row label="Watermarked file" value={result.watermarkedFile.valid ? "PASS" : "FAIL"} ok={result.watermarkedFile.valid} />
                {result.originalFile.valid && (
                  <Row label="Original reads"    value={result.originalFile.readCount.toLocaleString()} />
                )}
                {result.watermarkedFile.valid && (
                  <Row label="Watermarked reads" value={result.watermarkedFile.readCount.toLocaleString()} />
                )}
                {result.originalFile.error && (
                  <p className="text-xs text-red-400 mt-2">{result.originalFile.error}</p>
                )}
                {result.watermarkedFile.error && (
                  <p className="text-xs text-red-400 mt-2">{result.watermarkedFile.error}</p>
                )}
              </Card>

              {/* Read Comparison */}
              {result.readComparison && (
                <Card className="p-5 rounded-2xl bg-slate-800/50 border border-slate-700/50">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <FileText className="w-4 h-4" /> Read Comparison
                  </p>
                  <Row label="Read ID set match"        value={result.readComparison.readSetMatch ? "Match" : "Mismatch"} ok={result.readComparison.readSetMatch} />
                  <Row label="DNA sequences unchanged"  value={result.readComparison.dnaSequencesUnchanged ? "Yes ✓" : "No ✗"} ok={result.readComparison.dnaSequencesUnchanged} />
                  <Row label="Matching read IDs"        value={result.readComparison.matchingReadIds.toLocaleString()} />
                  <Row label="Sequence matches"         value={result.readComparison.dnaSequencesMatched.toLocaleString()} />
                  {result.readComparison.dnaSequencesMismatched > 0 && (
                    <Row label="Sequence mismatches" value={result.readComparison.dnaSequencesMismatched.toLocaleString()} ok={false} />
                  )}
                </Card>
              )}

              {/* Watermark Detection */}
              {result.bestMatch && (
                <Card className="p-5 rounded-2xl bg-slate-800/50 border border-slate-700/50">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4" /> Watermark Detection
                  </p>
                  <Row label="Watermark ID"       value={result.bestMatch.watermarkId} />
                  <Row label="Algorithm"          value={result.bestMatch.algorithm} />
                  <Row label="Bit accuracy"       value={`${result.bestMatch.matchScore}%`}
                    ok={result.bestMatch.matchScore >= 95} />
                  <Row label="Integrity"          value={`${result.bestMatch.integrity}%`}
                    ok={result.bestMatch.integrity >= 95} />
                  <Row label="Commitment match"   value={result.bestMatch.commitmentMatch ? "PASS" : "FAIL"}
                    ok={result.bestMatch.commitmentMatch} />
                  <Row label="Records checked"    value={result.watermarkRecordsChecked} />
                  <Row label="Download ID"        value={result.bestMatch.downloadId} />
                  <Row label="Watermark created"  value={new Date(result.bestMatch.createdAt).toLocaleString()} />
                </Card>
              )}

              {/* Researcher & Owner Info */}
              {(result.ownerInfo || result.bestMatch?.researcherInfo) && (
                <Card className="p-5 rounded-2xl bg-slate-800/50 border border-slate-700/50">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <User className="w-4 h-4" /> Parties Involved
                  </p>
                  {result.ownerInfo && (
                    <>
                      <p className="text-xs text-slate-500 mt-1 mb-0.5 font-medium flex items-center gap-1">
                        <User className="w-3 h-3" /> Data Owner
                      </p>
                      <Row label="Name"        value={result.ownerInfo.name} />
                      <Row label="Email"       value={result.ownerInfo.email} />
                      {result.ownerInfo.institution && (
                        <Row label="Institution" value={result.ownerInfo.institution} />
                      )}
                    </>
                  )}
                  {result.bestMatch?.researcherInfo && (
                    <>
                      <p className="text-xs text-slate-500 mt-3 mb-0.5 font-medium flex items-center gap-1">
                        <UserCheck className="w-3 h-3" /> Researcher (Watermark Recipient)
                      </p>
                      <Row label="Name"        value={result.bestMatch.researcherInfo.name} />
                      <Row label="Email"       value={result.bestMatch.researcherInfo.email} />
                      {result.bestMatch.researcherInfo.institution && (
                        <Row label="Institution" value={result.bestMatch.researcherInfo.institution} />
                      )}
                    </>
                  )}
                  {result.bestMatch?.fileInfo && (
                    <>
                      <p className="text-xs text-slate-500 mt-3 mb-0.5 font-medium flex items-center gap-1">
                        <FileText className="w-3 h-3" /> Registered File
                      </p>
                      <Row label="File name"  value={result.bestMatch.fileInfo.originalName} />
                      <Row label="Extension"  value={result.bestMatch.fileInfo.extension} />
                      {result.bestMatch.fileInfo.datasetId && (
                        <Row label="Dataset ID" value={result.bestMatch.fileInfo.datasetId} />
                      )}
                    </>
                  )}
                </Card>
              )}
            </div>

            {/* Disclaimer */}
            <div className="flex items-start gap-2 p-3 rounded-xl bg-slate-700/30 border border-slate-600/30 text-xs text-slate-500">
              <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span>
                This is a demonstration tool. No production records, blockchain transactions, or 
                access permissions were modified. Watermark secrets were used server-side only 
                and are not included in this result.
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
