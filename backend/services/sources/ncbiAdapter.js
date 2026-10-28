/**
 * ncbiAdapter.js
 * ──────────────────────────────────────────────────────────────────
 * Two-stage NCBI adapter for the Misuse Detection Engine.
 *
 * Stage A — Candidate Discovery (E-utilities):
 *   esearch → returns SRA accession IDs matching dataset metadata
 *   efetch runinfo → checks per-accession accessibility metadata
 *   einfo → healthcheck and database status
 *
 * Stage B — Conditional Sequence Retrieval:
 *   retrieveFASTQ() → retrieves quality-bearing FASTQ via supported
 *   SRA data-access infrastructure.
 *   Returns qualitiesAvailable=false when only FASTA is obtainable.
 *
 * CRITICAL: The caller MUST check qualitiesAvailable === true before
 * passing the result to GENOMIC_LSB_V1 watermark detection.
 * If qualitiesAvailable === false, record METADATA_MATCH_ONLY.
 *
 * V1 Scalability note: This adapter performs sequential requests.
 * Parallelism and rate-limiting refinement are future enhancements.
 */

"use strict";

const https  = require("https");
const http   = require("http");
const url    = require("url");

// ── NCBI E-utilities base URL ────────────────────────────────────
const EUTILS_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

// Rate limiting: NCBI allows 3 req/sec without API key, 10/sec with key
const API_KEY    = process.env.NCBI_API_KEY || null;
const TOOL_EMAIL = process.env.NCBI_TOOL_EMAIL || "genovault@example.com";
const TOOL_NAME  = "GenoVault";
const MAX_RESULTS = 15;  // Upper bound; actual per-scan value is deterministic (10–15) based on file

// ─────────────────────────────────────────────────────────────────
// Internal HTTP helper
// ─────────────────────────────────────────────────────────────────

/**
 * httpGet(targetUrl, timeoutMs)
 * Simple promise-based HTTP/HTTPS GET returning body as string.
 */
function httpGet(targetUrl, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const parsed  = new url.URL(targetUrl);
    const adapter = parsed.protocol === "https:" ? https : http;

    const req = adapter.get(targetUrl, { timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on("data",  (c) => chunks.push(c));
      res.on("end",   () => resolve(Buffer.concat(chunks).toString("utf8")));
      res.on("error", reject);
    });
    req.on("error",   reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`NCBI request timed out (${timeoutMs}ms): ${targetUrl}`));
    });
  });
}

/**
 * httpGetBuffer(targetUrl, timeoutMs)
 * Like httpGet but returns a Buffer (for binary / gzip FASTQ downloads).
 * Follows one level of HTTP redirect.
 */
function httpGetBuffer(targetUrl, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const parsed  = new url.URL(targetUrl);
    const adapter = parsed.protocol === "https:" ? https : http;

    const req = adapter.get(targetUrl, { timeout: timeoutMs }, (res) => {
      // Follow redirect
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGetBuffer(res.headers.location, timeoutMs).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${targetUrl}`));
      }
      const chunks = [];
      res.on("data",  (c) => chunks.push(c));
      res.on("end",   () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("error",   reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Download timed out (${timeoutMs}ms): ${targetUrl}`));
    });
  });
}

/**
 * buildEutilsUrl(endpoint, params)
 * Adds standard tool/email/apikey parameters.
 */
function buildEutilsUrl(endpoint, params = {}) {
  const p = new URLSearchParams({
    tool:  TOOL_NAME,
    email: TOOL_EMAIL,
    retmode: "json",
    ...(API_KEY ? { api_key: API_KEY } : {}),
    ...params,
  });
  return `${EUTILS_BASE}/${endpoint}?${p.toString()}`;
}

// ─────────────────────────────────────────────────────────────────
// Stage A — Candidate Discovery
// ─────────────────────────────────────────────────────────────────

/**
 * search(datasetMetadata, maxResults)
 *
 * Stage A-1: Queries NCBI SRA via esearch using genomic dataset metadata.
 * Returns a list of SRA accession IDs that are metadata-similar candidates.
 *
 * Query strategy: assembles an esearch term from available metadata fields
 * (organism, genome build, library strategy/layout, phenotype, sequencing
 * technology). More specific queries reduce false-positive candidates.
 *
 * @param {Object} datasetMetadata
 *   Optional fields: { organism, genomeBuild, libraryStrategy,
 *                      libraryLayout, phenotype, instrument, keywords[] }
 * @param {number} maxResults
 * @returns {Promise<string[]>}  SRA accession IDs (e.g. ["SRR123456", ...])
 */
async function search(datasetMetadata = {}, maxResults = MAX_RESULTS) {
  const mandatory = [];   // ALL must match (AND)
  const optional  = [];   // nice-to-have boosts (OR block)

  // Organism is the strongest discriminator — require it if present
  if (datasetMetadata.organism) {
    mandatory.push(`"${datasetMetadata.organism}"[Organism]`);
  }

  // Library strategy (WGS, RNA-Seq, etc.) narrows significantly
  if (datasetMetadata.libraryStrategy) {
    mandatory.push(`${datasetMetadata.libraryStrategy}[Strategy]`);
  }

  // Library layout (PAIRED / SINGLE)
  if (datasetMetadata.libraryLayout) {
    mandatory.push(`${datasetMetadata.libraryLayout}[Layout]`);
  }

  // Instrument platform
  if (datasetMetadata.instrument) {
    optional.push(`${datasetMetadata.instrument}[Platform]`);
  }

  // Phenotype / biosample attribute
  if (datasetMetadata.phenotype) {
    mandatory.push(`"${datasetMetadata.phenotype}"[All Fields]`);
  }

  // File stem keywords — use quoted phrase search for exactness
  if (datasetMetadata.keywords && datasetMetadata.keywords.length > 0) {
    for (const kw of datasetMetadata.keywords) {
      // Only use meaningful stems (skip very short or generic names)
      if (kw && kw.length >= 4 && !/^(sample|test|file|data|read)$/i.test(kw)) {
        mandatory.push(`"${kw}"[All Fields]`);
      }
    }
  }

  if (mandatory.length === 0 && optional.length === 0) {
    console.warn("[NCBIAdapter] search() called with no queryable metadata; returning empty");
    return [];
  }

  // Build query: mandatory terms AND-joined, optional OR-joined in parens
  let query = mandatory.join(" AND ");
  if (optional.length > 0) {
    const optBlock = optional.join(" OR ");
    query = query ? `${query} AND (${optBlock})` : `(${optBlock})`;
  }

  // Restrict to FASTQ-capable runs only
  query += " AND biomol_dna[Properties]";

  const searchUrl = buildEutilsUrl("esearch.fcgi", {
    db:      "sra",
    term:    query,
    retmax:  maxResults,
    retmode: "json",
  });

  console.log(`[NCBIAdapter] esearch query: ${query.slice(0, 200)}`);

  let body;
  try {
    body = await httpGet(searchUrl);
  } catch (err) {
    throw new Error(`NCBI esearch failed: ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("NCBI esearch returned invalid JSON");
  }

  const ids = parsed?.esearchresult?.idlist || [];
  console.log(`[NCBIAdapter] esearch returned ${ids.length} candidate IDs (query matched ${parsed?.esearchresult?.count || 0} total in SRA)`);
  return ids;
}

/**
 * getRunInfo(accessionId)
 *
 * Stage A-2: Fetches SRA run metadata for a specific accession to check:
 *   - Whether the accession is publicly accessible
 *   - What file formats are available
 *   - Whether quality scores are likely present
 *
 * Returns parsed run info object or null on failure.
 *
 * @param {string} accessionId  – SRA run ID e.g. SRR123456
 * @returns {Promise<Object|null>}
 */
async function getRunInfo(accessionId) {
  const infoUrl = buildEutilsUrl("efetch.fcgi", {
    db:      "sra",
    id:      accessionId,
    rettype: "runinfo",
    retmode: "text",
  });

  try {
    const body = await httpGet(infoUrl);
    // runinfo is CSV; parse first data row
    const lines = body.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return null;

    const headers = lines[0].split(",");
    const values  = lines[1].split(",");
    const info    = {};
    headers.forEach((h, i) => { info[h.trim()] = (values[i] || "").trim(); });
    return info;
  } catch (err) {
    console.warn(`[NCBIAdapter] getRunInfo failed for ${accessionId}: ${err.message}`);
    return null;
  }
}

/**
 * healthCheck()
 * Pings NCBI einfo to verify E-utilities connectivity.
 * Returns { ok: boolean, latencyMs: number, error?: string }
 */
async function healthCheck() {
  const start = Date.now();
  try {
    const checkUrl = buildEutilsUrl("einfo.fcgi", { db: "sra" });
    await httpGet(checkUrl, 5000);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────
// Stage B — Quality-Bearing FASTQ Retrieval
// ─────────────────────────────────────────────────────────────────

/**
 * retrieveFASTQ(accessionId)
 *
 * Stage B: Attempts to retrieve quality-bearing FASTQ data for the given
 * SRA accession ID via supported SRA data-access infrastructure.
 *
 * V1 implementation note:
 *   NCBI E-utilities efetch cannot reliably return quality-bearing FASTQ
 *   for SRA data. Full-quality FASTQ retrieval requires SRA Toolkit
 *   (fastq-dump / fasterq-dump) or cloud-native SRA access (AWS/GCP).
 *   If SRA Toolkit is not available in the runtime environment, this
 *   function returns qualitiesAvailable=false, and the caller MUST record
 *   the result as METADATA_MATCH_ONLY.
 *
 * Returns one of three shapes:
 *   { buffer: Buffer, format: 'FASTQ', qualitiesAvailable: true }
 *   { buffer: null, format: 'FASTA', qualitiesAvailable: false }
 *   { buffer: null, format: null, qualitiesAvailable: false, error: string }
 *
 * @param {string} accessionId
 * @returns {Promise<Object>}
 */
async function retrieveFASTQ(accessionId) {
  // Check if SRA Toolkit is available in the environment
  const sraToolkitAvailable = await _checkSraToolkitAvailable();

  if (!sraToolkitAvailable) {
    console.log(
      `[NCBIAdapter] SRA Toolkit not found — trying ENA HTTP fallback for ${accessionId}...`
    );

    // ── ENA fallback: ENA mirrors all SRA data with direct FASTQ download URLs ──
    try {
      const enaResult = await _retrieveViaENA(accessionId);
      if (enaResult.qualitiesAvailable) {
        return enaResult;
      }
      // ENA also failed — fall through to METADATA_MATCH_ONLY
      console.warn(`[NCBIAdapter] ENA fallback also failed for ${accessionId}: ${enaResult.error}`);
    } catch (enaErr) {
      console.warn(`[NCBIAdapter] ENA fallback error for ${accessionId}: ${enaErr.message}`);
    }

    return {
      buffer:             null,
      format:             null,
      qualitiesAvailable: false,
      error:              "SRA Toolkit not available and ENA HTTP fallback failed",
    };
  }

  // SRA Toolkit is available — attempt retrieval via fastq-dump / fasterq-dump
  try {
    const { execFile } = require("child_process");
    const os           = require("os");
    const path         = require("path");
    const fs           = require("fs");

    const tmpDir      = path.join(os.tmpdir(), `gv_ncbi_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    const fastqBuffer = await new Promise((resolve, reject) => {
      execFile(
        "fasterq-dump",
        ["--split-files", "--outdir", tmpDir, accessionId],
        { timeout: 120000 },
        (err) => {
          if (err) { return reject(err); }

          // Read first FASTQ output file
          const files = fs.readdirSync(tmpDir).filter(f => f.endsWith(".fastq"));
          if (files.length === 0) {
            return reject(new Error("fasterq-dump produced no .fastq files"));
          }
          const buf = fs.readFileSync(path.join(tmpDir, files[0]));
          resolve(buf);
        }
      );
    });

    // Clean up temp
    try {
      const { execSync } = require("child_process");
      execSync(`${process.platform === "win32" ? "rmdir /s /q" : "rm -rf"} "${tmpDir}"`);
    } catch { /* non-fatal */ }

    return { buffer: fastqBuffer, format: "FASTQ", qualitiesAvailable: true };

  } catch (err) {
    console.warn(`[NCBIAdapter] FASTQ retrieval failed for ${accessionId}: ${err.message}`);
    return {
      buffer:             null,
      format:             null,
      qualitiesAvailable: false,
      error:              err.message,
    };
  }
}

/**
 * _checkSraToolkitAvailable()
 * Internal: checks if fasterq-dump (SRA Toolkit) is on PATH.
 */
async function _checkSraToolkitAvailable() {
  const { execFile } = require("child_process");
  return new Promise((resolve) => {
    execFile("fasterq-dump", ["--version"], { timeout: 3000 }, (err) => {
      resolve(!err);
    });
  });
}

/**
 * _retrieveViaENA(accessionId)
 *
 * ENA (European Nucleotide Archive) mirrors ALL NCBI SRA data and provides
 * direct FASTQ download URLs via its REST API — no SRA Toolkit needed.
 *
 * API endpoint: https://www.ebi.ac.uk/ena/portal/api/filereport
 * Returns direct FTP/HTTPS URLs to .fastq.gz files.
 *
 * @param {string} accessionId  e.g. "SRR12345678"
 * @returns {Promise<{ buffer, format, qualitiesAvailable, error? }>}
 */
async function _retrieveViaENA(accessionId) {
  try {
    // Query ENA Portal API for FASTQ download URLs
    const enaApiUrl =
      `https://www.ebi.ac.uk/ena/portal/api/filereport` +
      `?accession=${encodeURIComponent(accessionId)}` +
      `&result=read_run&fields=fastq_ftp,fastq_aspera,run_accession` +
      `&format=json`;

    console.log(`[NCBIAdapter/ENA] Querying ENA for ${accessionId}...`);
    const enaRaw  = await httpGet(enaApiUrl, 20000);
    const enaData = JSON.parse(enaRaw);

    if (!Array.isArray(enaData) || enaData.length === 0) {
      return { buffer: null, format: null, qualitiesAvailable: false,
               error: `ENA: no records found for ${accessionId}` };
    }

    const record   = enaData[0];
    const ftpField = record.fastq_ftp || "";

    if (!ftpField) {
      return { buffer: null, format: null, qualitiesAvailable: false,
               error: `ENA: no fastq_ftp URLs for ${accessionId}` };
    }

    // ENA returns semicolon-separated FTP paths (no protocol prefix)
    // Take the first file URL
    const ftpPaths = ftpField.split(";").filter(Boolean);
    const httpsUrl = "https://" + ftpPaths[0].replace(/^ftp:\/\//, "");

    console.log(`[NCBIAdapter/ENA] Downloading FASTQ from: ${httpsUrl}`);
    const gzBuffer = await httpGetBuffer(httpsUrl, 180000); // 3 min timeout

    console.log(`[NCBIAdapter/ENA] ✅ Downloaded ${(gzBuffer.length / 1e6).toFixed(1)} MB for ${accessionId}`);

    return {
      buffer:             gzBuffer,      // may be gzip-compressed (.fastq.gz)
      format:             "FASTQ",
      qualitiesAvailable: true,
    };

  } catch (err) {
    return {
      buffer:             null,
      format:             null,
      qualitiesAvailable: false,
      error:              `ENA retrieval error: ${err.message}`,
    };
  }
}

module.exports = { search, getRunInfo, healthCheck, retrieveFASTQ };
