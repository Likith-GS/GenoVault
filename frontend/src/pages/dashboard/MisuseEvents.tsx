import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ShieldX, ShieldAlert, AlertTriangle, Search, RefreshCw,
  Loader2, Filter, ChevronRight, CheckCircle2, Clock,
} from "lucide-react";
import { PageHeader }  from "@/components/dashboard/PageHeader";
import { Card }        from "@/components/ui/card";
import { Button }      from "@/components/ui/button";
import { Badge }       from "@/components/ui/badge";
import { useAuth }     from "@/contexts/AuthContext";

const API_BASE = "http://localhost:5000/api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MisuseEvent {
  _id:                 string;
  eventId:             string;
  watermarkId:         string;
  status:              string;
  source:              string;
  sourceRecordId:      string | null;
  originalFileName:    string | null;
  watermarkMatchScore: number | null;
  overallConfidence:   string | null;
  detectedAt:          string;
  blockchainStatus:    string;
  fileId:       { originalName: string; extension: string } | null;
  researcherId: { name: string; email: string } | null;
}

interface PageState {
  events: MisuseEvent[];
  total:  number;
  pages:  number;
  page:   number;
}

// ─── Status meta ──────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; Icon: any; color: string }> = {
  CONFIRMED_WATERMARK_MATCH: { label: "Confirmed",      Icon: ShieldX,     color: "text-red-400" },
  HIGH_CONFIDENCE_MATCH:     { label: "High Confidence",Icon: ShieldAlert,  color: "text-orange-400" },
  POSSIBLE_MATCH:            { label: "Possible",       Icon: ShieldAlert,  color: "text-amber-400" },
  METADATA_MATCH_ONLY:       { label: "Metadata Only",  Icon: AlertTriangle,color: "text-yellow-400" },
  FALSE_POSITIVE:            { label: "False Positive", Icon: CheckCircle2, color: "text-slate-400" },
  UNDER_REVIEW:              { label: "Under Review",   Icon: AlertTriangle,color: "text-blue-400" },
  RESOLVED:                  { label: "Resolved",       Icon: CheckCircle2, color: "text-emerald-400" },
};

const STATUS_FILTERS = [
  { value: "",                          label: "All Statuses" },
  { value: "CONFIRMED_WATERMARK_MATCH", label: "Confirmed" },
  { value: "HIGH_CONFIDENCE_MATCH",     label: "High Confidence" },
  { value: "POSSIBLE_MATCH",            label: "Possible" },
  { value: "METADATA_MATCH_ONLY",       label: "Metadata Only" },
  { value: "UNDER_REVIEW",              label: "Under Review" },
  { value: "RESOLVED",                  label: "Resolved" },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function MisuseEvents() {
  const navigate   = useNavigate();
  const { token }  = useAuth();
  const authHeaders = { Authorization: `Bearer ${token}` };

  const [state,   setState]   = useState<PageState>({ events: [], total: 0, pages: 1, page: 1 });
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [status,  setStatus]  = useState("");
  const [page,    setPage]    = useState(1);

  const fetchEvents = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (status) params.set("status", status);
      const res = await fetch(`${API_BASE}/provenance/misuse-events?${params}`, {
        headers: authHeaders,
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      setState({
        events: json.events,
        total:  json.total,
        pages:  json.pages,
        page:   json.page,
      });
    } catch (e: any) {
      setError(e.message || "Failed to load misuse events");
    } finally {
      setLoading(false);
    }
  }, [token, page, status]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const handleFilterChange = (newStatus: string) => {
    setStatus(newStatus);
    setPage(1);
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <PageHeader
        title="Misuse Events"
        description={`${state.total} total events detected across all scans`}
        icon={<ShieldAlert className="w-6 h-6 text-amber-400" />}
        action={
          <Button variant="outline" size="sm" onClick={fetchEvents}>
            <RefreshCw className="w-4 h-4 mr-2" /> Refresh
          </Button>
        }
      />

      {/* ── Status filter bar ─────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => handleFilterChange(f.value)}
            className={`px-3 py-1 rounded-full text-xs border transition-colors ${
              status === f.value
                ? "bg-indigo-600 border-indigo-500 text-white"
                : "border-slate-600 text-slate-400 hover:border-indigo-500 hover:text-slate-200"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* ── Event list ────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-400" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center h-48 justify-center gap-3">
          <ShieldX className="w-8 h-8 text-red-400" />
          <p className="text-red-400 text-sm">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchEvents}>Retry</Button>
        </div>
      ) : state.events.length === 0 ? (
        <Card className="p-12 rounded-2xl bg-slate-800/50 border border-slate-700/50 text-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
          <p className="text-slate-300 font-medium">No misuse events found</p>
          <p className="text-slate-500 text-sm mt-1">
            {status ? "No events match the current filter." : "No misuse has been detected yet."}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {state.events.map((ev) => {
            const meta = STATUS_META[ev.status] ?? {
              label: ev.status, Icon: AlertTriangle, color: "text-slate-400",
            };
            return (
              <motion.div
                key={ev._id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 rounded-2xl bg-slate-800/50 border border-slate-700/50
                           hover:border-indigo-500/40 cursor-pointer transition-all"
                onClick={() => navigate(`/dashboard/misuse/${ev.eventId}`)}
              >
                <div className="flex items-center gap-4">
                  <meta.Icon className={`w-5 h-5 ${meta.color} flex-shrink-0`} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <p className="text-sm text-white font-medium truncate">
                        {ev.fileId?.originalName ?? ev.originalFileName ?? "Unknown file"}
                      </p>
                      <Badge
                        variant="outline"
                        className={`text-xs flex-shrink-0 ${
                          ev.status === "CONFIRMED_WATERMARK_MATCH" ? "border-red-500/40 text-red-400" :
                          ev.status === "POSSIBLE_MATCH"           ? "border-amber-500/40 text-amber-400" :
                          ev.status === "METADATA_MATCH_ONLY"      ? "border-yellow-500/40 text-yellow-400" :
                          ev.status === "RESOLVED"                  ? "border-emerald-500/40 text-emerald-400" :
                          "border-slate-500/40 text-slate-400"
                        }`}
                      >
                        {meta.label}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {ev.researcherId
                        ? `${ev.researcherId.name} · `
                        : "Unknown researcher · "}
                      {ev.source}{ev.sourceRecordId ? ` / ${ev.sourceRecordId}` : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-4 flex-shrink-0">
                    {ev.watermarkMatchScore !== null && (
                      <div className="text-right hidden md:block">
                        <p className="text-xs text-slate-400">Match Score</p>
                        <p className="text-sm font-bold text-white">
                          {(ev.watermarkMatchScore * 100).toFixed(1)}%
                        </p>
                      </div>
                    )}
                    <div className="text-right hidden md:block">
                      <p className="text-xs text-slate-400">Blockchain</p>
                      <p className={`text-xs font-medium ${
                        ev.blockchainStatus === "ANCHORED" ? "text-emerald-400" :
                        ev.blockchainStatus === "FAILED"   ? "text-red-400" : "text-amber-400"
                      }`}>
                        {ev.blockchainStatus}
                      </p>
                    </div>
                    <div className="text-right hidden lg:block">
                      <p className="text-xs text-slate-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(ev.detectedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-600" />
                  </div>
                </div>

                {ev.status === "METADATA_MATCH_ONLY" && (
                  <p className="text-xs text-yellow-400 mt-2 ml-9">
                    ⚠ FASTQ quality data unavailable — watermark detection was not run.
                    Manual review required.
                  </p>
                )}
              </motion.div>
            );
          })}
        </div>
      )}

      {/* ── Pagination ────────────────────────────────────────────── */}
      {state.pages > 1 && (
        <div className="flex items-center justify-between pt-4">
          <p className="text-sm text-slate-400">
            Page {state.page} of {state.pages} · {state.total} total events
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline" size="sm"
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline" size="sm"
              disabled={page >= state.pages}
              onClick={() => setPage(p => Math.min(state.pages, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
