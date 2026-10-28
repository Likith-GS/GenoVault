# GenoVault — Genomic Data Provenance & Misuse Detection Engine
# Complete Technical Documentation

---

## 1. WHY DID WE BUILD THIS FEATURE?

### 1.1 The Core Problem It Solves

Genomic data does not disappear after it is downloaded.

When a researcher downloads a FASTQ file containing someone's DNA sequence, that file
leaves GenoVault's controlled environment forever. Traditional access control systems —
including GenoVault's existing PIN-verified, blockchain-gated download system — can answer:
  "Did this researcher have permission to download?"

But they CANNOT answer:
  "Has this researcher shared or leaked the file after downloading it?"
  "If this file appears on a public database, which specific download did it come from?"
  "Which researcher's copy was leaked — there are 12 approved researchers for this dataset?"

This is the attribution problem. Without it:
  - A researcher can leak genomic data and deny it was their copy
  - A data owner cannot prove WHICH download event caused a leak
  - A file appearing on NCBI/SRA cannot be traced back to a specific download event
  - There is no cryptographic provenance evidence linking the leaked file to a specific download event
    (Note: whether such cryptographic evidence is legally admissible depends on jurisdiction and context.)

### 1.2 Why Standard Logging Is Not Sufficient

MongoDB's audit trail records that a download happened.
Blockchain records that the access was approved.
Neither records what happened to the file AFTER it left the server.

PROBLEM 1: Standard downloads give every researcher the same bytes.
  If 12 researchers download the same file, every copy is identical.
  When one copy leaks, there is no way to tell whose it was.
  Any researcher can plausibly deny: "The leaked copy isn't mine — it's byte-for-byte
  identical to every other download."

PROBLEM 2: Download logs are server-side only.
  A researcher can claim the log is fabricated or that the server was compromised.
  Without a cryptographic link between the specific bytes they received and the
  specific download event, the log is just an assertion, not proof.

PROBLEM 3: Manual monitoring is impossible at scale.
  Genomic datasets from GenoVault may appear years later on NCBI SRA, bioRxiv datasets,
  or public repositories. No human can monitor all of these continuously.

CONCLUSION: The only solution is to embed an invisible, cryptographically unique
identifier INTO each downloaded file — one that proves which specific download event
produced that specific copy, and to automate scanning of external databases to detect
when any such copy appears publicly.

### 1.3 What This Feature Provides

For the DATA OWNER:
  - Every researcher who downloads a file receives a cryptographically unique copy
  - The owner can see exactly which researcher downloaded which file and when
  - If a leak occurs, the owner can prove exactly which download it came from
  - An automated scanner checks NCBI SRA for copies of watermarked files
  - A structured evidence report can be generated for ethics boards or legal proceedings

For REGULATORY COMPLIANCE:
  - GDPR Article 5(1)(f) requires appropriate security measures for personal data
  - Research institutions require demonstrable data stewardship
  - IRB/ethics board audits require traceable consent and access records
  - The watermark commitment is anchored to blockchain — independently verifiable

For the BROADER COMMUNITY:
  - Genomic data misuse is a real and documented problem in research ethics
  - Watermarking does not prevent misuse, but it creates accountability
  - A researcher who knows their download is uniquely watermarked is deterred from leaking
  - The system increases trust between data owners and researchers


---

## 2. WHAT IS A DIGITAL WATERMARK?

### 2.1 The Concept

A digital watermark is information embedded invisibly into a digital file such that:
  - It does not meaningfully degrade the usability of the file
  - It survives normal use of the file (format conversion, compression, reuse)
  - It can be extracted later to identify the provenance of a specific copy
  - It is not visible to the user of the file

Watermarking is NOT encryption. The file content is readable and usable.
Watermarking is NOT steganography (hiding secret messages). It identifies provenance.
Watermarking is NOT access control. It does not prevent copying.

The correct analogy: a serial number stamped on a banknote.
  You can spend the banknote normally. But if it turns up in a crime scene,
  the serial number traces it back to a specific transaction at a specific bank branch.

### 2.2 Why Genomic Files Are Well-Suited for Watermarking

FASTQ files contain:
  - Read ID lines (starting with @)
  - DNA sequence data (A, C, G, T characters)
  - Separator lines (+)
  - Quality score lines (Phred-encoded ASCII characters per base)

The quality score line is the embedding target. Phred quality scores encode sequencing
confidence, not biological content. They are instrument-dependent, run-dependent, and
vary between sequencing platforms. Existing analysis pipelines treat quality scores as
a probability distribution — they do NOT depend on exact bit-level values.

  - Changes quality scores by at most ±1 Phred unit per modified read position
  - The implemented downstream-impact experiment measured a mean quality-score change below 0.001 Phred
    across 1,000 synthetic reads × 150 bp (N=5 runs). Broader compatibility with all downstream
    bioinformatics tools (GATK, BWA, etc.) is not claimed from this experiment alone.
  - DNA sequence data (A/C/G/T nucleotide bases) is NEVER modified.
  - Is not visible to any researcher using the file for its intended purpose

BAM and VCF files are less ideal for embedded watermarks.
Their formats do not contain per-base quality score streams in the same structure.
For these formats, GenoVault uses a metadata-field watermark (METADATA_V1):
  inserting a specially-crafted comment/tag field into the file header.
This is explicitly labelled as WEAK because metadata fields can be stripped by standard
bioinformatics tools (samtools view, bcftools annotate). It provides provenance tracking
but NOT the same forensic strength as GENOMIC_LSB_V1.

### 2.3 GenoVault's Watermarking Algorithm — GENOMIC_LSB_V1

The specific algorithm GenoVault implements for FASTQ files is:

STEP 1: Normalize the FASTQ file
  Parse all reads into a canonical stream: {id, sequence, quality}.
  Strip trailing whitespace. Remove blank lines. Normalize line endings.
  This normalization ensures that two slightly different representations of
  the same FASTQ file produce identical embedding positions.

STEP 2: Generate a 256-bit watermark seed (see Section 3)
  This seed is unique to this specific download (owner + researcher + file +
  access request + download ID + random nonce).

STEP 3: Select embedding positions using the seed (HMAC counter mode)
  For each block of positions needed, compute:
    HMAC-SHA256(watermarkSeed || counter)
  Use the output bytes to select candidate quality score positions.
  Skip positions where quality score Phred value < 10 (low-confidence bases —
  these are less stable and introduce noise into watermark recovery).
  This ensures positions are deterministically derivable from the seed but
  appear random without knowledge of the seed.

STEP 4: Encode the 64-bit watermark payload with repetition code (N=7)
  The 64-bit payload is repeated 7 times, producing a 448-bit encoded stream.
  Each payload bit is embedded in 7 separate positions.
  During recovery, majority-vote decoding corrects any single-position errors:
    5/7 positions agree = correct bit
    6/7 positions agree = high confidence
    7/7 positions agree = perfect match
  This gives robustness against minor quality score modifications by downstream tools.

STEP 5: Embed by flipping the LSB of selected quality ASCII values
  For each embedding position:
    watermarked_quality[i] = (original_quality[i] & ~1) | payload_bit
  The original sequence data is NEVER modified. Only quality score bytes change.

STEP 6: Self-verify before delivery
  Before sending the watermarked file to the researcher, GenoVault runs the
  detection algorithm on the watermarked buffer and confirms the result matches.
  If self-verification fails, the download is BLOCKED and the original file is NOT sent.

Read reordering is NOT guaranteed in V1.
The positional watermarking strategy derives embedding locations from deterministic
positions in the normalized read stream. If a tool reorders the reads, positions shift
and the watermark cannot be recovered without re-normalization.
This is a known V1 limitation. V2 will use read-ID-keyed positions.


---

## 3. THE CRYPTOGRAPHIC PIPELINE

### 3.1 Three Distinct Cryptographic Values

This is the most important concept to understand about GenoVault's watermarking:

There are THREE separate cryptographic values, each with a distinct role:

  watermarkSeed       (256 bits = 64 hex chars)
    WHO decides WHERE to embed.
    Derived from context via HMAC-SHA256.
    Controls position selection in lsbQualityEmbedder.js.
    NEVER exposed via API, frontend, or reports.
    Stored in MongoDB with select: false (must be explicitly requested in code).

  watermarkPayload    (64 bits = 8 bytes)
    WHAT is actually embedded into the file and recovered later.
    Derived from the first 8 bytes of the watermarkSeed.
    The physical bits that are written into quality score LSBs.
    Never exposed to users. Never appears in reports.

  watermarkCommitment (256 bits = 64 hex chars)
    HOW we verify that detection found the right payload.
    Computed as SHA-256(watermarkPayload).
    Stored in MongoDB (not sensitive — it reveals nothing about seed or payload).
    Used by the detector: if SHA-256(recovered_payload) == watermarkCommitment → MATCH.

### 3.2 Why Three Values Instead of One?

WHY NOT just store the payload and compare directly?
  An adversary with database read access could learn the payload bits, reconstruct
  the quality LSB pattern, and check whether a file contains that pattern.
  Using a commitment hash means the adversary learns nothing useful even if they
  read the database — they see only SHA-256(payload), not the payload itself.
  They cannot reverse SHA-256 to learn the payload.

WHY NOT use the seed as the commitment?
  The seed is the most sensitive value — it controls position selection.
  If the seed were compromised, an adversary could reconstruct the exact embedding
  positions AND the payload. Storing SHA-256(seed) as the commitment would still
  expose whether two seeds are identical.
  The correct commitment is SHA-256(payload) — a value derived two steps from the seed.

WHY NOT use SHA-256(seed) as the commitment and compare recovered payload to seed?
  Because the detector recovers the PAYLOAD (64 bits), not the seed (256 bits).
  You cannot embed a 256-bit seed into a file using the same scheme.
  The commitment must match what the detector actually produces.

CORRECT verification flow:
  1. Detector recovers 64-bit watermarkPayload from candidate file.
  2. Computes SHA-256(recovered_payload).
  3. Compares with stored watermarkCommitment.
  4. Match → verified = true.
  This is what GenoVault implements.

WRONG flow (rejected):
  SHA-256(recovered payload) compared to SHA-256(seed) → ALWAYS FAILS
  because SHA-256(payload) ≠ SHA-256(seed) by construction.

### 3.3 Seed Generation

The watermarkSeed is generated using HMAC-SHA256:

  HMAC-SHA256(
    key    = WATERMARK_SECRET,              ← server-side secret (env var)
    inputs = ownerId | researcherId | fileId | accessRequestId | downloadId | nonce
  ) = 256-bit watermarkSeed

Each input component plays a specific role:

  ownerId         — ties the watermark to the specific data owner's genomic data
  researcherId    — ties the watermark to the specific researcher who received the file
  fileId          — ties the watermark to the specific dataset downloaded
  accessRequestId — ties the watermark to the specific approved access request
  downloadId      — ties the watermark to this specific download transaction
  nonce           — 32 random bytes generated freshly per download (prevents precomputation)

This construction means:
  - The same researcher downloading the same file twice gets DIFFERENT watermarks
    (because each download has a unique downloadId and fresh nonce).
  - Every watermark is completely unique even for identical source files.
  - Without WATERMARK_SECRET, no one can compute or brute-force the watermark.

### 3.4 Secret Key Requirements

WATERMARK_SECRET must be:
  - A 256-bit (64 hex character) cryptographically random value
  - Generated with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  - Stored as an environment variable only — never in code or git
  - NEVER rotated without re-watermarking all existing downloads
    (rotation means old watermarks cannot be re-derived for comparison)

If WATERMARK_SECRET is missing from the environment:
  - GenoVault BLOCKS ALL DOWNLOADS immediately with HTTP 503
  - This is a fail-safe: sending unwatermarked files is WORSE than blocking the download
  - An unwatermarked file cannot be traced if leaked

WATERMARK_SECRET_VERSION (e.g. "watermark-key-v1") is stored alongside each watermark
record to support future key rotation. If the secret is ever rotated, old records
know which key version was used and can still be detected with the old key.


---

## 4. HOW THE DOWNLOAD PIPELINE WORKS

### 4.1 Overview of the Three-Pass Download Process

Before this feature, GenoVault's download used a streaming pipeline:
  Azure Blob → AES-256-CBC decipher → HTTP response (chunked)

After this feature, the download uses an in-memory three-pass pipeline:
  PASS 1: SHA-256 integrity verification (unchanged)
  PASS 2: In-memory decryption
  PASS 3: Watermark embedding + self-verification
  DELIVER: Send watermarked buffer to researcher

### 4.2 Pre-Download Guards

GUARD 1: WATERMARK_SECRET check
  If process.env.WATERMARK_SECRET is not set:
    → Log WATERMARK_EMBEDDING_FAILED to AuditLog
    → Return HTTP 503 with code WATERMARK_SECRET_MISSING
    → Download blocked

GUARD 2: File size limit
  WM_MAX_FILE_SIZE_MB (default: 500 MB)
  If the file's stored sizeBytes exceeds this limit:
    → Log WATERMARK_FAILED_SIZE_LIMIT to AuditLog
    → Return HTTP 503 with code FILE_TOO_LARGE_FOR_WATERMARKING
    → Download blocked
  Rationale: In-memory buffering of very large files risks OOM crashes.
  V2 will implement streaming watermark embedding for large files.

### 4.3 Pass 1 — SHA-256 Integrity Verification (Unchanged)

Before any decryption happens, the existing integrity verification runs:
  1. Open a streaming read of the Azure Blob.
  2. Compute SHA-256(encrypted_bytes) chunk-by-chunk.
  3. Compare with stored blockchainFileHash.
  4. If mismatch → Log INTEGRITY_FAILED → Return HTTP 409 → Download blocked.
  5. If match → proceed.

This is preserved exactly from the existing implementation. If the encrypted
file stored in Azure has been tampered with, the download is blocked BEFORE
any decryption or watermarking occurs.

### 4.4 Pass 2 — In-Memory Decryption

Unlike the previous streaming decryption, the watermarking pipeline requires the
COMPLETE decrypted file in memory before embedding can begin.
(Position selection uses the entire normalized read stream.)

  1. Download the entire encrypted Azure Blob into a Buffer.
     Uses azureService.downloadBlobToBuffer() — reads all chunks into Buffer.concat().
  2. Retrieve the AES key from Azure Key Vault.
  3. Apply AES-256-CBC decryption:
       decipher = crypto.createDecipheriv("aes-256-cbc", key, iv)
       plainBuffer = Buffer.concat([decipher.update(encryptedBuffer), decipher.final()])
  4. The plainBuffer is the raw genomic file (FASTQ, BAM, or VCF).

The original plainBuffer is NEVER sent to the researcher. It exists only as an
intermediate value within the request handler's scope. After the watermarked buffer
is produced, the plain buffer is eligible for garbage collection.

### 4.5 Pass 3 — Watermark Embedding

  1. Generate unique identifiers:
       downloadId  = wmService.generateDownloadId()   → "DL-XXXXXX-YYYY"
       watermarkId = wmService.generateWatermarkId()  → "WM-XXXXXXXX"
       nonce       = crypto.randomBytes(32)            → fresh per download

  2. Compute watermarkSeed via HMAC-SHA256(WATERMARK_SECRET, all context inputs + nonce)

  3. Compute originalFileHash = SHA-256(plainBuffer)

  4. Build watermarkRecord via wmService.buildWatermarkRecord():
       Derives watermarkPayload = first 8 bytes of seed
       Computes watermarkCommitment = SHA-256(watermarkPayload)
       Sets watermarkVersion = GENOMIC_LSB_V1 for .fastq, METADATA_V1 for .bam/.vcf
       Sets embeddingMethod based on format

  5. Embed watermark:
       .fastq → lsbQualityEmbedder.embed(plainBuffer, watermarkRecord)
       .bam   → metadataEmbedder.embed(plainBuffer, ".bam", watermarkRecord)
       .vcf   → metadataEmbedder.embed(plainBuffer, ".vcf", watermarkRecord)
       If embedding fails → Log WATERMARK_EMBEDDING_FAILED → HTTP 500 → Download blocked.

  6. Self-verify (CRITICAL SAFETY CHECK):
       result = wmService.detectWatermarkInCandidate(watermarkedBuffer, watermarkRecord)
       If result.verified is false → Log WATERMARK_EMBEDDING_FAILED → HTTP 500 → Blocked.
       This guarantees the watermarked file is actually detectable before delivery.

  7. Compute watermarkedFileHash = SHA-256(watermarkedBuffer)

  8. Save WatermarkRegistry document to MongoDB:
       If save fails → Log WATERMARK_EMBEDDING_FAILED → HTTP 500 → Download blocked.
       (Cannot send a watermarked file that has no registry entry — undetectable later)

  9. Anchor watermarkedFileHash to Ethereum blockchain (fire-and-forget, setImmediate):
       Uses existing registerFileOnChain() from blockchainService.
       WatermarkRegistry.blockchainStatus updated to ANCHORED or FAILED asynchronously.
       Download is NOT delayed by this step.

### 4.6 Delivery

After all checks pass:
  res.setHeader("Content-Disposition", `attachment; filename="${file.originalName}"`)
  res.setHeader("Content-Type", file.mimeType)
  res.setHeader("Content-Length", watermarkedBuffer.length)
  res.setHeader("X-Watermark-Id", watermarkId)   ← watermarkId only, NEVER seed
  res.setHeader("X-Download-Id", downloadId)
  return res.send(watermarkedBuffer)

Logged: WATERMARKED_FILE_DOWNLOADED to AuditLog.

### 4.7 Fail-Safe Philosophy

Every single watermarking step uses the same fail-safe rule:
  IF ANYTHING FAILS → BLOCK THE DOWNLOAD → NEVER SEND THE ORIGINAL FILE.

This is the single most important design decision in the entire feature.

Sending an unwatermarked file is WORSE than not sending the file at all.
An unwatermarked file:
  - Cannot be traced if leaked
  - Undermines the integrity of all other watermarked copies
  - Gives the researcher a "clean" copy that defeats provenance

The researcher will get an error and can contact the data owner or retry.
That is acceptable. Sending un-attributed genomic data is not.


---

## 5. THE WATERMARK REGISTRY

### 5.1 What Is Stored

Every watermarked download creates a WatermarkRegistry document with these fields:

IDENTITY FIELDS:
  watermarkId         — "WM-A1B2C3D4" (unique per download)
  downloadId          — "DL-LPQ4XZ-A3B2" (unique per download transaction)
  fileId              — which GenomicFile was downloaded
  ownerId             — the data owner
  researcherId        — the researcher who downloaded
  accessRequestId     — the specific approved AccessRequest used

CRYPTOGRAPHIC FIELDS:
  watermarkSeed       — 64-char hex. select: false. NEVER returned by default queries.
  watermarkCommitment — SHA-256(watermarkPayload). Used for verification.
  watermarkSecretVersion — "watermark-key-v1" (for key rotation support)

ALGORITHM FIELDS:
  watermarkVersion        — "GENOMIC_LSB_V1" or "METADATA_V1"
  watermarkAlgorithm      — human-readable algorithm name
  embeddingParametersVersion — all V1 parameters (payloadBits, repetitionFactor, etc.)
  embeddingMethod         — "LSB_QUALITY", "SAM_TAG", or "COMMENT_FIELD"
  fileFormat              — ".fastq", ".bam", or ".vcf"

FILE EVIDENCE FIELDS:
  fileSize             — size of the decrypted plaintext in bytes
  originalFileHash     — SHA-256(original decrypted plaintext)
  watermarkedFileHash  — SHA-256(watermarked output)

BLOCKCHAIN FIELDS:
  blockchainStatus     — "PENDING", "ANCHORED", "FAILED"
  blockchainTxHash     — Ethereum transaction hash of watermarkedFileHash registration
  blockchainBlockNum   — Ethereum block number

STATUS FIELD:
  status               — "active" (can be used for detection) or "revoked"

### 5.2 Security of the Seed Field

watermarkSeed is defined in the Mongoose schema as:
  watermarkSeed: { type: String, required: true, select: false }

The `select: false` means:
  - WatermarkRegistry.find() never returns watermarkSeed by default
  - WatermarkRegistry.findOne() never returns watermarkSeed by default
  - Even aggregate() requires explicitly adding watermarkSeed to $project

To access the seed (only in internal detection code):
  WatermarkRegistry.find(query).select("+watermarkSeed ...")

This ensures that:
  - API endpoints that list downloads CANNOT accidentally expose the seed
  - Frontend pages that fetch download history CANNOT see the seed
  - Evidence reports CANNOT contain the seed (they use watermarkCommitment instead)
  - Even a bug in response serialization cannot expose the seed

The seed is used ONLY in misuseDetectionService.js when:
  1. Loading watermark records for comparison against a candidate file
  2. Explicitly calling .select("+watermarkSeed") before detection

### 5.3 Indexes for Performance

  { ownerId: 1, fileId: 1 }           — scan all downloads for a file
  { ownerId: 1, researcherId: 1 }     — scan all downloads by a researcher
  { watermarkId: 1 }                  — unique, fast lookup for verification
  { downloadId: 1 }                   — unique, fast lookup per download
  { status: 1, watermarkVersion: 1 }  — filter for active GENOMIC_LSB_V1 records


---

## 6. HOW DETECTION WORKS

### 6.1 The Candidate File Problem

When GenoVault detects a file on NCBI SRA, it faces a "blind" detection problem:
  The candidate file is a public SRA accession.
  GenoVault does not know which watermark (if any) is embedded in it.
  There are potentially dozens of registered watermarks for the same genomic dataset.

Naïve approach (REJECTED): Download the candidate, try to extract a watermark,
  then search the database for a matching commitment.
  PROBLEM: You cannot "extract a watermark" without knowing the seed (positions).
  The seed determines WHERE to look in the quality stream.
  Without the seed, you are reading random quality score bits.

GenoVault's approach: One-to-many comparison.
  1. Load ALL active WatermarkRegistry records for the owner.
     Each record contains the seed (loaded with +watermarkSeed).
  2. Normalize the candidate FASTQ file ONCE into a read stream.
  3. For each registered watermark record:
       Use the record's watermarkSeed to reconstruct embedding positions.
       Read quality LSBs at those exact positions.
       Majority-vote decode the 448-bit stream → recover 64-bit payload.
       Compute SHA-256(recovered_payload).
       Compare with record.watermarkCommitment.
       If match → verified = true → this is the source download.
  4. The candidate normalization (step 2) is done ONCE and reused.
     This avoids re-parsing the file for every watermark tested.

### 6.2 Detection Confidence Levels

The detection result includes:
  matchScore — fraction of majority-voted bits that were recoverable (0.0 to 1.0)
  integrity  — fraction of bit positions that were consistent (0.0 to 1.0)
  verified   — true ONLY if SHA-256(recovered_payload) == watermarkCommitment

Confidence is determined by:
  CONFIRMED   — verified = true (cryptographic match, cannot be coincidence)
  HIGH        — matchScore >= 0.95, verified = false (payload recovered but commitment mismatch)
  MEDIUM      — matchScore >= 0.80, verified = false
  LOW         — matchScore < 0.80, verified = false

Only CONFIRMED means a proven match. GenoVault records all confidence levels
in MisuseEvent but only marks CONFIRMED_WATERMARK_MATCH as a proven leak.

### 6.3 What "METADATA_MATCH_ONLY" Means

When the SRA Toolkit (fasterq-dump) is not available in the runtime environment,
GenoVault cannot retrieve quality-bearing FASTQ data. It can only access metadata
(SRA run info via E-utilities efetch).

In this case:
  - The watermark detection algorithm is NOT run (it needs quality scores)
  - GenoVault records a MisuseEvent with status METADATA_MATCH_ONLY
  - The event is flagged for manual review
  - The owner is notified that this candidate requires human investigation

This is NOT a false positive and NOT a confirmed match.
It means: "This SRA accession has metadata characteristics similar to this dataset,
but we could not run watermark detection because quality data was unavailable."

CRITICAL: A METADATA_MATCH_ONLY event does NOT attribute any researcher.
researcherId is null for these events. Do not treat them as proven leaks.

### 6.4 Deduplication

If the same SRA accession is scanned multiple times (across multiple scan runs),
MisuseEvent uses a compound unique index on (watermarkId, source, sourceRecordId).
The first match creates the event. Subsequent scans update the matchScore if improved
but do not create duplicate records.


---

## 7. THE NCBI ADAPTER — TWO-STAGE ARCHITECTURE

### 7.1 Stage A: Candidate Discovery via E-utilities

NCBI E-utilities is the public API for NCBI databases. GenoVault uses three endpoints:

esearch.fcgi — Searches the SRA database for candidate accessions.
  GenoVault builds a search query from the file's metadata:
    {organism}[Organism] AND {libraryStrategy}[Strategy] AND {libraryLayout}[Layout]
    AND {instrument}[Platform] AND {phenotype}[All Fields] AND {keywords}[All Fields]
  Returns a list of SRA run IDs (e.g., SRR12345678) that are potentially similar.
  Maximum 20 results per scan in V1 (configurable).

efetch.fcgi (runinfo) — Retrieves per-accession metadata.
  For each accession ID returned by esearch, GenoVault fetches:
    Organism, LibraryStrategy, LibraryLayout, Platform, SRAFilesURL, availability
  This allows filtering candidates that are clearly not related before FASTQ retrieval.

einfo.fcgi — Health check.
  GenoVault pings einfo before starting any scan to verify E-utilities connectivity.
  If NCBI is unreachable, the scan status becomes PARTIAL (not FAILED — it may succeed later).

Rate limiting:
  Without NCBI_API_KEY: 3 requests/second maximum.
  With NCBI_API_KEY:    10 requests/second.
  GenoVault honours these limits to avoid IP blocking.

### 7.2 Stage B: Quality-Bearing FASTQ Retrieval

NCBI E-utilities efetch CANNOT reliably return quality-bearing FASTQ for SRA data.
The SRA archive stores data in SRA format, not raw FASTQ.
To retrieve FASTQ with quality scores, the SRA Toolkit is required.

fasterq-dump (SRA Toolkit):
  fasterq-dump --split-files --outdir /tmp/scan_{timestamp} {accessionId}
  This produces .fastq files with full quality scores.
  The first output file is read into a Buffer.

If fasterq-dump is not on PATH:
  → _checkSraToolkitAvailable() returns false
  → retrieveFASTQ() returns { qualitiesAvailable: false }
  → Caller records METADATA_MATCH_ONLY and proceeds to next candidate

This two-stage design ensures:
  - Discovery (E-utilities) works in all environments
  - Detection (SRA Toolkit) only runs when the toolkit is available
  - The system never silently skips candidates — all are recorded

### 7.3 Environments and Deployment Notes

For development environments (Windows, laptops):
  The SRA Toolkit may not be installed. All candidates will be METADATA_MATCH_ONLY.
  This is expected and documented. Install the SRA Toolkit from:
    https://www.ncbi.nlm.nih.gov/sra/docs/sradownload/

For production (Linux server, Docker):
  Install with: conda install -c bioconda sra-tools
  Or: apt-get install sra-toolkit
  Verify: fasterq-dump --version

NCBI API key registration:
  Register at: https://www.ncbi.nlm.nih.gov/account/
  Set NCBI_API_KEY in .env
  Set NCBI_TOOL_EMAIL to a valid contact email (NCBI requirement)


---

## 8. THE MISUSE DETECTION PIPELINE

### 8.1 Starting a Scan

A scan is started by the data owner from the frontend dashboard
(POST /api/provenance/scans) or programmatically.

The startScan function:
  1. Creates a MisuseScan document (status: QUEUED) immediately.
  2. Returns { scanId, status: "QUEUED" } to the caller.
  3. Uses setImmediate() to run the actual scan asynchronously.

The owner does NOT wait for the scan to complete.
The HTTP response arrives in milliseconds.
The scan runs in the background and may take minutes.
The owner can check scan status via GET /api/provenance/scans/:scanId.

Rate limiting: 5 scans per hour per IP (scanLimiter in server.js).
This prevents accidental or malicious NCBI API abuse.

### 8.2 Scan Execution Flow

runScan(scanId):

  STEP 1: Load active watermark records with seed.
    WatermarkRegistry.find({ ownerId, status: "active" }).select("+watermarkSeed ...")
    If no active records → COMPLETED immediately (nothing to compare against).

  STEP 2: Build dataset metadata query.
    Loads GenomicFile documents for all files referenced by watermark records.
    Extracts organism, libraryStrategy, libraryLayout, instrument, phenotype.
    Builds NCBI esearch query string.

  STEP 3: Health-check NCBI.
    If unreachable → scan status = PARTIAL → return early with error logged.

  STEP 4: Query NCBI esearch for candidates.
    Returns up to 20 SRA accession IDs.
    Stored as MisuseScan.totalCandidates.

  STEP 5: For each candidate accession:
    5a. ncbiAdapter.getRunInfo(accessionId) — accessibility check
    5b. ncbiAdapter.retrieveFASTQ(accessionId) — quality-bearing FASTQ retrieval
    5c. If qualitiesAvailable = false → record METADATA_MATCH_ONLY → next candidate
    5d. If qualitiesAvailable = true:
          normalizedReads = normalizeFASTQ(candidateBuffer)  [parsed ONCE]
          For each watermarkRecord (inner loop):
            result = wmService.detectWatermarkInCandidate(normalizedReads, watermarkRecord)
            if result.matchScore >= 0.85 OR result.verified:
              → createOrUpdateMisuseEvent()
              → anchor evidence to blockchain (setImmediate, fire-and-forget)

  STEP 6: Update MisuseScan with final counts.
    confirmedMatches, possibleMatches, metadataOnlyMatches, status (COMPLETED/PARTIAL/FAILED).

  STEP 7: Log MISUSE_SCAN_COMPLETED to AuditLog.

### 8.3 MisuseScan Status Values

  QUEUED      — created, not yet started
  RUNNING     — actively scanning
  COMPLETED   — all sources processed (may have found matches or not)
  PARTIAL     — some sources were unavailable (e.g., NCBI down) but others completed
  FAILED      — unrecoverable error prevented the scan

A COMPLETED scan with 0 matches means GenoVault found no evidence of misuse.
A PARTIAL scan means the result is inconclusive — retry when source is available.

### 8.4 MisuseEvent Status Values

  CONFIRMED_WATERMARK_MATCH
    verified = true. SHA-256(recovered_payload) == watermarkCommitment.
    This is the strongest possible detection. The specific download event is identified.
    researcherId is populated.

  HIGH_CONFIDENCE_MATCH
    matchScore >= 0.95, verified = false.
    Payload recovery was very close to correct. May be due to minor quality modifications.
    Requires human review to confirm.

  POSSIBLE_MATCH
    0.85 <= matchScore < 0.95, verified = false.
    Statistically significant but not conclusive. May be coincidental similarity.

  METADATA_MATCH_ONLY
    FASTQ quality data not available. Only metadata similarity detected.
    researcherId is null. Cannot attribute to any researcher without watermark detection.

  UNDER_REVIEW
    Manually set by data owner while investigating.

  FALSE_POSITIVE
    Manually set by data owner after investigation concludes it is not a leak.

  RESOLVED
    Manually set after appropriate action has been taken.


---

## 9. EVIDENCE REPORTS

### 9.1 What an Evidence Report Contains

A data owner can generate an evidence report for any misuse event
(POST /api/provenance/misuse-events/:eventId/report).

The report contains:

  reportVersion    — "1.0"
  generatedAt      — ISO 8601 timestamp
  reportHash       — SHA-256 of the entire report JSON (for integrity verification)

  eventId          — which MisuseEvent this covers
  watermarkId      — the specific watermark matched
  downloadId       — the specific download transaction

  file section     — originalName, extension, datasetId (NOT the file contents)
  researcher       — name, email, institution, ORCID
  detection        — status, detectionMethod, matchScore, integrity, confidence,
                     detectedAt, source, sourceRecordId, sourceUrl
  watermark        — version, algorithm, commitment, secretVersion, embeddingMethod,
                     originalFileHash, watermarkedFileHash, downloadedAt
  blockchain       — event and watermark blockchain transaction hashes and statuses

The reportHash is computed as SHA-256(JSON.stringify(report)) and anchored to
Ethereum blockchain asynchronously (fire-and-forget).

### 9.2 What an Evidence Report Does NOT Contain

  watermarkSeed — NEVER INCLUDED. This is the most sensitive field.
  Reason: The seed controls position selection. If an adversary learns the seed,
  they could potentially craft a file that passes watermark detection, or learn
  exactly which quality positions were modified.

  watermarkPayload — Not included directly.
  Only the commitment (SHA-256 of payload) is included, which is sufficient to
  prove that a specific payload was embedded without revealing the payload itself.

  AES encryption key — Not part of this feature (already protected by Key Vault).
  Any raw genomic sequence — Reports contain metadata only.

### 9.3 How to Use a Report as Evidence

The evidence report is designed to be presented to:
  - Institutional Research Integrity Offices
  - IRB/Ethics Boards investigating data misuse allegations
  - Legal counsel in copyright or data breach proceedings
  - Funding agencies auditing research compliance

Chain of evidence:
  1. Report shows the specific download event (downloadId, timestamp, researcher identity).
  2. Report shows the watermark version and parameters used.
  3. Report shows the watermarkCommitment — the cryptographic fingerprint of the embedded payload.
  4. Report shows the blockchain transaction hash anchoring the watermarkedFileHash.
  5. Anyone can verify on Sepolia Etherscan that this hash was recorded at that timestamp.
  6. The reportHash can be verified: SHA-256(report JSON) should match reportHash.
  7. The reportHash blockchain anchoring (if completed) provides a timestamp for the report.

This chain demonstrates:
  - Researcher X received watermarked copy Y at time T.
  - That watermarked copy was anchored to blockchain at time T.
  - The public SRA accession Z contains evidence matching watermark Y's commitment.
  - Therefore: the public accession was derived from researcher X's copy.


---

## 10. API REFERENCE

### 10.1 Route Base

All provenance endpoints are mounted at: /api/provenance
All require: Authorization: Bearer {jwt_token}
All require: Owner role (enforced by requireOwner middleware)

### 10.2 Dashboard & Accountability

GET /api/provenance/dashboard
  Returns:
    fileStats[]        — per-file download counts and watermark versions
    misuseSummary      — { confirmed, possible, metadataOnly, total }
    recentDownloads[]  — last 5 watermarked downloads (no watermarkSeed)
    formatStrength     — watermark strength classification per file extension
  Rate limit: dashboardLimiter (600 req / 15 min)

GET /api/provenance/downloads?page=&limit=&fileId=&researcherId=
  Paginated list of all watermarked downloads for the owner's files.
  Supports filtering by fileId or researcherId.
  Never returns watermarkSeed.
  Rate limit: dashboardLimiter

GET /api/provenance/researcher/:researcherId
  All downloads and misuse events for a specific researcher.
  Includes researcher profile, download list, misuse event list.
  Never returns watermarkSeed.
  Rate limit: dashboardLimiter

### 10.3 Scan Management

POST /api/provenance/scans
  Body: { fileId? }   — omit fileId to scan all owner files
  Response: { success, message, scanId, status: "QUEUED" }
  Non-blocking: returns immediately. Scan runs in background.
  Rate limit: scanLimiter (5 req / 1 hour)

GET /api/provenance/scans?page=&limit=
  Paginated list of all scans for the owner.
  Rate limit: dashboardLimiter

GET /api/provenance/scans/:scanId
  Status and result counts for one scan.
  Rate limit: dashboardLimiter

### 10.4 Misuse Events

GET /api/provenance/misuse-events?status=&page=&limit=
  Paginated list of all misuse events for the owner.
  Filter by status: CONFIRMED_WATERMARK_MATCH, POSSIBLE_MATCH, METADATA_MATCH_ONLY, etc.
  Rate limit: dashboardLimiter

GET /api/provenance/misuse-events/:eventId
  Full detail for one misuse event.
  Includes linked WatermarkRegistry record (without watermarkSeed).
  Rate limit: dashboardLimiter

POST /api/provenance/misuse-events/:eventId/report
  Generates structured evidence report.
  Anchors reportHash to Ethereum blockchain.
  Response: { success, report: { ...all evidence fields, reportHash } }
  Rate limit: dashboardLimiter (reports are light-weight)


---

## 11. FRONTEND PAGES

### 11.1 Provenance Dashboard (/dashboard/provenance)

Accessible via: "Provenance" nav item in owner sidebar (Shield icon)

Displays:
  MISUSE ALERT SUMMARY: 4 cards
    - Confirmed Leaks (red) — CONFIRMED_WATERMARK_MATCH count
    - Possible Matches (amber) — POSSIBLE_MATCH + HIGH_CONFIDENCE_MATCH count
    - Metadata Only (yellow) — METADATA_MATCH_ONLY count (require manual review)
    - Total Events (slate) — total MisuseEvent count

  WATERMARK STRENGTH BY FORMAT: 3 cards
    - .fastq → "✅ Strong watermark (GENOMIC_LSB_V1)"
    - .bam   → "⚠️ Limited metadata watermark" (WEAK — can be stripped)
    - .vcf   → "⚠️ Limited metadata watermark" (WEAK — can be stripped)

  RECENT WATERMARKED DOWNLOADS: last 5 download records
    File name, researcher name, watermarkId, watermark version badge,
    blockchain anchoring status (green dot = ANCHORED, amber = PENDING, red = FAILED)

  NCBI SCAN LAUNCHER: "Start NCBI Scan" button
    Sends POST /api/provenance/scans with no fileId (scans all files).
    Shows scanId in a success banner.
    Scan result available via Misuse Events page.

  PARTIAL SCAN WARNING NOTE: explanatory text at bottom about METADATA_MATCH_ONLY.

### 11.2 Misuse Events (/dashboard/misuse)

Accessible via: "Misuse Events" nav item in owner sidebar (ShieldAlert icon)

Displays:
  STATUS FILTER BAR: pill buttons for each status value
    All Statuses, Confirmed, High Confidence, Possible, Metadata Only, Under Review, Resolved

  PAGINATED EVENT LIST: clickable rows
    File name, researcher name (if attributed), source/accession ID
    Status badge (color-coded), match score, blockchain status, detected date
    METADATA_MATCH_ONLY events show inline warning: "FASTQ quality data unavailable"

  Each row navigates to the MisuseIncident detail page on click.

### 11.3 Misuse Incident Detail (/dashboard/misuse/:eventId)

Displays:
  STATUS BANNER: large colored banner showing event status and timestamp
    METADATA_MATCH_ONLY events show a prominent warning box explaining
    that watermark detection was NOT run and manual review is required.

  DETECTION METRICS: 4 cards
    Match Score, Watermark Integrity, Confidence, Detection Method
    Hidden for METADATA_MATCH_ONLY events (not applicable).

  EXTERNAL SOURCE: NCBI SRA accession, source URL (clickable external link)
  ATTRIBUTED RESEARCHER: name, email, institution (null for METADATA_MATCH_ONLY)

  WATERMARK RECORD: watermarkId, downloadId, version, algorithm, method,
    watermarkCommitment (displayed — this is safe), blockchain status and tx hash.
    watermarkSeed is NEVER shown.

  GENERATE EVIDENCE REPORT button:
    Calls POST /api/provenance/misuse-events/:eventId/report.
    Shows the reportHash when complete.
    Displays note: "watermarkSeed is intentionally excluded from this report."


---

## 12. DATABASE MODELS

### 12.1 WatermarkRegistry

One document per watermarked download (created at download time).
Collection: watermarkregistries

Critical field: watermarkSeed — select: false.
Indexes: watermarkId (unique), downloadId (unique), ownerId+fileId, ownerId+researcherId

Full schema:
  watermarkId           String, unique
  downloadId            String, unique
  fileId                ObjectId → GenomicFile
  ownerId               ObjectId → User
  researcherId          ObjectId → User
  accessRequestId       ObjectId → AccessRequest
  watermarkSeed         String, select: false   ← SENSITIVE
  watermarkCommitment   String                  ← SHA-256(payload), safe to expose
  watermarkVersion      Enum: GENOMIC_LSB_V1 | METADATA_V1
  watermarkAlgorithm    String
  watermarkSecretVersion String
  embeddingParametersVersion Object
  embeddingMethod       Enum: LSB_QUALITY | SAM_TAG | COMMENT_FIELD
  fileFormat            String (.fastq, .bam, .vcf)
  fileSize              Number
  originalFileHash      String (SHA-256 of plaintext)
  watermarkedFileHash   String (SHA-256 of watermarked output)
  blockchainStatus      Enum: PENDING | ANCHORED | FAILED
                        ← Decoupled from download status: watermarkedFileHash anchoring runs
                          asynchronously (setImmediate after delivery). Download is NOT
                          delayed waiting for blockchain confirmation.
  blockchainTxHash      String
  blockchainBlockNum    Number
  status                Enum: active | revoked

### 12.2 MisuseEvent

One document per detected or suspected misuse incident.
Collection: misuseevents
Compound unique index on (watermarkId, source, sourceRecordId) — prevents duplicates.

Full schema:
  eventId               String, unique ("MSE-XXXXXX")
  watermarkId           String (matches WatermarkRegistry.watermarkId)
  downloadId            String
  fileId                ObjectId → GenomicFile
  ownerId               ObjectId → User
  researcherId          ObjectId → User (null for METADATA_MATCH_ONLY)
  scanId                String (which scan detected this)
  source                Enum: NCBI_SRA | MANUAL | EBI_ENA
  sourceRecordId        String (SRA accession, e.g., SRR12345678)
  sourceUrl             String
  status                Enum: CONFIRMED_WATERMARK_MATCH | HIGH_CONFIDENCE_MATCH |
                               POSSIBLE_MATCH | METADATA_MATCH_ONLY |
                               FALSE_POSITIVE | UNDER_REVIEW | RESOLVED
  misuseType            Enum: CONFIRMED_LEAK | PROBABLE_LEAK | SUSPECTED_LEAK |
                               METADATA_SIGNAL | MANUAL_REVIEW | NOT_MISUSE | UNKNOWN
                        ← Reviewer item R3.5: explicit semantic classification separate from
                          detection status. Derived by classifyMisuseEvent() in
                          misuseDetectionService.js based on status + matchScore + verified.
                          Allows fine-grained filtering and reporting beyond the raw detection
                          status enum. Never null after classification.
  detectionMethod       String (watermarkVersion used)
  watermarkMatchScore   Number 0.0–1.0
  watermarkIntegrity    Number 0.0–1.0
  overallConfidence     Enum: CONFIRMED | HIGH | MEDIUM | LOW
  evidenceHash          String (SHA-256 of serialized event for blockchain)
  blockchainStatus      Enum: PENDING | ANCHORED | FAILED
                        ← Decoupled from event status: blockchain anchoring of evidenceHash
                          runs asynchronously (setImmediate). PENDING until tx confirmed;
                          ANCHORED when tx.wait(1) succeeds; FAILED if blockchain error.
                          Evidence status and blockchain status are independent state machines.
  blockchainTxHash      String
  resolutionNotes       String
  resolvedAt            Date
  detectedAt            Date

### 12.3 MisuseScan

One document per scan execution.
Collection: misusescans

Full schema:
  scanId                String, unique ("SCN-XXXXXXXX")
  ownerId               ObjectId → User
  fileId                ObjectId → GenomicFile (null = all files)
  status                Enum: QUEUED | RUNNING | COMPLETED | PARTIAL | FAILED
  startedAt             Date
  completedAt           Date
  error                 String
  totalCandidates       Number
  confirmedMatches      Number
  possibleMatches       Number
  metadataOnlyMatches   Number
  sources[]             Array of { name, status, candidatesFound,
                                   watermarkTested, metadataOnlyCount, error }

### 12.4 New AuditLog Operations

12 new operation types added to AuditLog.operation enum:

  WATERMARK_EMBEDDED          — watermark successfully embedded in downloaded file
  WATERMARK_VERIFIED          — embedded watermark self-verified before delivery
  WATERMARK_EMBEDDING_FAILED  — embedding failed (download blocked)
  WATERMARKED_FILE_DOWNLOADED — watermarked file successfully delivered to researcher
  WATERMARK_DETECTED          — watermark matched in external candidate file
  MISUSE_SCAN_STARTED         — owner initiated a misuse detection scan
  MISUSE_SCAN_COMPLETED       — scan finished (with result summary)
  MISUSE_EVENT_CREATED        — a new misuse event was recorded
  MISUSE_REPORT_GENERATED     — evidence report generated for an event
  WATERMARK_FAILED_SIZE_LIMIT — file too large for in-memory watermarking (download blocked)
  PROVENANCE_DASHBOARD_VIEW   — owner viewed the provenance dashboard
  WATERMARK_REVOKED           — watermark record marked as revoked


---

## 13. ENVIRONMENT VARIABLES

### 13.1 Required Variables

WATERMARK_SECRET
  Type:     64-character lowercase hexadecimal string (256 bits)
  Purpose:  HMAC-SHA256 key for watermark seed derivation
  Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  WARNING:  Never commit a real value. Never rotate without re-embedding all downloads.
  Effect:   If missing → ALL downloads are blocked (fail-safe design).

### 13.2 Optional Variables (with defaults)

WATERMARK_SECRET_VERSION (default: "watermark-key-v1")
  Stored in each WatermarkRegistry record to identify which key version was used.
  Supports future key rotation by identifying which key to use for each record.

WATERMARK_VERSION (default: "GENOMIC_LSB_V1")
  The default embedding algorithm version for new downloads.

WM_MAX_FILE_SIZE_MB (default: 500)
  Maximum file size in megabytes that can be watermarked in-memory.
  Files larger than this are blocked from download until V2 streaming is implemented.
  Set higher if your server has sufficient RAM.

WM_PAYLOAD_BITS (default: 64)
  Number of bits in the watermark payload. Stored as reference; not used at runtime.

WM_REPETITION_FACTOR (default: 7)
  Repetition code factor for error correction (must match lsbQualityEmbedder constants).
  Encoded bits = WM_PAYLOAD_BITS × WM_REPETITION_FACTOR = 448 bits.

WM_MIN_QUALITY_THRESHOLD (default: 10)
  Minimum Phred quality score for a position to be used for embedding.
  Positions below this threshold are skipped (unstable quality scores).

NCBI_API_KEY (optional)
  NCBI account API key. Without it: 3 requests/second limit.
  With it: 10 requests/second. Register at: https://www.ncbi.nlm.nih.gov/account/

NCBI_TOOL_EMAIL (default: "genovault@example.com")
  Required by NCBI E-utilities in the tool and email parameters.
  Should be a valid contact email for the organization.


---

## 14. SECURITY ANALYSIS

### 14.1 Threat Model

THREAT 1: Researcher extracts the watermark to learn they are being tracked.
  Defense: The watermark uses quality score LSB manipulation, which is imperceptible
  to any analysis tool. A researcher would need to know EXACTLY which positions to
  check, which requires WATERMARK_SECRET. Without the secret, they see random noise.

THREAT 2: Researcher modifies quality scores to destroy the watermark.
  Defense: Repetition code with N=7. A researcher would need to modify 4 of every 7
  embedding positions for each bit. This would require knowing the positions (needs
  WATERMARK_SECRET) and would significantly degrade file quality, making it suspicious.
  Future V2 will add additional robustness via block redundancy.

THREAT 3: Researcher shares their copy with another researcher to launder the source.
  Defense: Both copies are identical (same watermark), so both trace to the same download.
  The watermark identifies the download event, not just the recipient.

THREAT 4: Researcher strips BAM/VCF metadata headers.
  Defense: GenoVault labels BAM/VCF watermarks as WEAK (METADATA_V1).
  These formats do not receive forensic attribution guarantees.
  Future work: implement sequence-level watermarking for BAM/VCF.

THREAT 5: Attacker reads MongoDB to learn watermarkSeed values.
  Defense: watermarkSeed has select: false. It cannot be accessed via normal API calls.
  Even if MongoDB is compromised: the seed lets the attacker find embedding positions,
  but does NOT let them modify existing WatermarkRegistry commitment records (blockchain).

THREAT 6: WATERMARK_SECRET is compromised.
  Defense: Rotate the key immediately. Old records store watermarkSecretVersion.
  New downloads use new key. Old detections become unreliable until re-embedding.
  This is the most catastrophic single-point failure — protect the secret aggressively.

THREAT 7: Database admin deletes WatermarkRegistry records to cover a researcher's tracks.
  Defense: The watermarkedFileHash was anchored to Ethereum blockchain at download time.
  The blockchain record cannot be deleted. An auditor can verify the hash existed
  even if the MongoDB record is gone.

### 14.2 What the System Cannot Prevent

The watermarking system is a detection and attribution tool, NOT a prevention tool.

It CANNOT prevent:
  - A researcher from downloading the file (that is controlled by access management)
  - A researcher from sharing the file after download
  - A researcher from converting FASTQ to another format (watermark may not survive)
  - A researcher who knows the embedding scheme from attempting destruction
  - Misuse that does not involve uploading to a searchable public database

It CAN detect:
  - Copies that appear on NCBI SRA with matching watermarks
  - The specific download event that produced a leaked copy
  - Whether a specific SRA accession is attributable to a specific researcher

### 14.3 Algorithmic Security Properties

HMAC-SHA256 for seed generation:
  PRF security — the seed is computationally indistinguishable from random without
  knowledge of WATERMARK_SECRET. An adversary cannot reverse-engineer the seed
  from the watermark positions or the payload.

SHA-256 for commitment:
  Preimage resistance — knowing SHA-256(payload) does not reveal the payload.
  Collision resistance — probability of two different payloads producing the same
  commitment is 2^-256, computationally impossible.

Repetition code with N=7:
  Error correction — recovers from floor((7-1)/2) = 3 errors per bit.
  This is not cryptographic security but provides resilience against noise.


---

## 15. IMPLEMENTATION FILES REFERENCE

### 15.1 Backend — New Files

backend/models/WatermarkRegistry.js
  Mongoose model for download registry. watermarkSeed has select: false.

backend/models/MisuseEvent.js
  Mongoose model for detected misuse incidents. Compound dedup index.

backend/models/MisuseScan.js
  Mongoose model for scan execution records.

backend/services/watermark/lsbQualityEmbedder.js
  Core FASTQ LSB watermark engine.
  Functions: normalizeFASTQ, selectEmbeddingPositions, encodePayload,
             decodePayload, embed, detectForRecord

backend/services/watermark/metadataEmbedder.js
  BAM/VCF metadata watermark engine. Clearly labelled WEAK_WATERMARK.
  Functions: embed (dispatches to embedBAM/embedVCF), detectForRecord

backend/services/watermarkService.js
  Orchestration layer. Implements complete cryptographic pipeline.
  Functions: generateWatermarkId, generateDownloadId, generateWatermarkSeed,
             deriveWatermarkPayload, computeWatermarkCommitment,
             computeWatermarkedFileHash, embedWatermark,
             detectWatermarkInCandidate, buildWatermarkRecord

backend/services/sources/ncbiAdapter.js
  Two-stage NCBI integration. Stage A: E-utilities. Stage B: SRA Toolkit.
  Functions: search, getRunInfo, healthCheck, retrieveFASTQ

backend/services/misuseDetectionService.js
  Background scan engine. Runs via setImmediate (non-blocking).
  Functions: startScan (public), runScan, _processCandidateAccession (internal)

backend/controllers/watermarkController.js
  Dashboard and download history endpoints.
  Functions: getAccountabilityDashboard, getResearcherDetail, getDownloadHistory

backend/controllers/misuseController.js
  Scan management and evidence report generation.
  Functions: startScan, listScans, getScanStatus, getMisuseEvents,
             getMisuseEventDetail, generateEvidenceReport

backend/routes/provenanceRoutes.js
  Express router for all 10 /api/provenance/* endpoints.
  Middleware: verifyToken + requireOwner on all routes.

backend/tests/watermark.test.js
  29-test Jest test suite covering all layers.

### 15.2 Backend — Modified Files

backend/models/AuditLog.js
  Added 12 new operation enum values for provenance/watermark events.

backend/controllers/accessController.js
  downloadFile() extended with 3-pass pipeline:
    PASS 1: integrity (unchanged)
    PASS 2: in-memory decryption (changed from streaming)
    PASS 3: watermark embedding + self-verify + registry save

backend/services/azureService.js
  Added downloadBlobToBuffer() for in-memory blob download.

backend/server.js
  Added provenanceRoutes import and mount at /api/provenance.
  Added scanLimiter (5/hr) applied to /api/provenance/scans.
  Added X-Watermark-Id and X-Download-Id to CORS exposedHeaders.

backend/.env
  Added WATERMARK_SECRET, WATERMARK_SECRET_VERSION, WATERMARK_VERSION,
  WM_MAX_FILE_SIZE_MB, WM_PAYLOAD_BITS, WM_REPETITION_FACTOR,
  WM_MIN_QUALITY_THRESHOLD, NCBI_API_KEY, NCBI_TOOL_EMAIL.

### 15.3 Frontend — New Files

frontend/src/pages/dashboard/Provenance.tsx
  Provenance dashboard: misuse summary, format strength, recent downloads, scan launcher.

frontend/src/pages/dashboard/MisuseEvents.tsx
  Paginated misuse events list with status filter bar.

frontend/src/pages/dashboard/MisuseIncident.tsx
  Incident detail: status banner, detection metrics, source/researcher, evidence report.

### 15.4 Frontend — Modified Files

frontend/src/App.tsx
  Added routes: /dashboard/provenance, /dashboard/misuse, /dashboard/misuse/:eventId

frontend/src/components/dashboard/AppSidebar.tsx
  Added nav items: "Provenance" (Shield icon), "Misuse Events" (ShieldAlert icon)


---

## 16. TEST SUITE — ALL 29 TESTS

### 16.1 Tests 1–14: Functional Tests

  1.  normalizeFASTQ parses correct number of reads
  2.  normalizeFASTQ read structure has correct fields (id, sequence, quality)
  3.  embed() returns a watermarkedBuffer (Buffer type)
  4.  Watermarked buffer differs from original (not byte-identical)
  5.  Watermarked FASTQ has same number of lines as original
  6.  Watermark is detected in watermarked output (verified=true)
  7.  Watermark detection fails for a different watermark record (verified=false)
  8.  Detection on original (non-watermarked) buffer returns verified=false
  9.  watermarkCommitment = SHA-256(watermarkPayload) — not SHA-256(seed)
  10. generateWatermarkSeed produces unique seeds for different inputs
  11. Same inputs produce same watermarkSeed (HMAC determinism)
  12. Different nonces produce different seeds (unique watermarks per download)
  13. detectWatermarkInCandidate accepts pre-normalized reads array
  14. Sequence data is unchanged after watermark embedding

### 16.2 Test 15: Concurrent Download Test

  15. 20 concurrent embeddings produce 20 distinct, independently-verifiable watermarks
      Verifies: all 20 are verified=true, all watermarkIds unique, all commitments unique.

### 16.3 Tests 16–26: Robustness Tests

  16. Missing WATERMARK_SECRET throws during seed generation
  17. embedWatermark throws for unsupported file extension (.txt)
  18. metadataEmbedder inserts GENOVAULT_WM CO tag in BAM/SAM
  19. metadataEmbedder inserts ##GENOVAULT_WM line in VCF
  20. metadataEmbedder detects correct watermarkId in BAM (verified=true)
  21. metadataEmbedder returns verified=false for wrong watermarkId
  22. metadataEmbedder throws for unsupported format
  23. detectWatermarkInCandidate throws if non-Buffer passed for METADATA_V1
  24. Small FASTQ (50 reads) still produces a detectable watermark (matchScore > 0)
  25. computeWatermarkedFileHash equals SHA-256(watermarkedBuffer)
  26. generateWatermarkId returns WM-XXXXXXXX format (8 hex chars)

### 16.4 Tests 27–29: Cryptographic Commitment Tests

  27. Commitment is consistent: same seed always produces same commitment
  28. Modified payload produces a different commitment — detection rejects it
  29. Seed, payload, and commitment are three distinct cryptographic values
      Specifically verifies:
        seed ≠ payload ≠ commitment
        seed is 64-char hex (256 bits)
        payload is 16-char hex (64 bits)
        commitment is 64-char hex (256 bits)
        commitment == SHA-256(payload_bytes)   ← correct
        commitment ≠ SHA-256(seed_bytes)       ← would be wrong


---

## 17. FREQUENTLY ASKED QUESTIONS

Q: Will the watermark affect downstream analysis (alignment, variant calling)?

  GenoVault flips the least significant bit of quality score ASCII values only.
  The maximum quality score change per modified position is ±1 Phred unit.
  The implemented downstream-impact experiment measured a mean quality-score
  change below 0.001 Phred across 1,000 synthetic reads × 150 bp (N=5 runs),
  which is well within the noise range of typical analyses.
  The DNA sequence data is NEVER modified. Nucleotide bases (A/C/G/T) are untouched.
  Broader compatibility with all downstream tools (BWA, GATK, samtools, STAR) is not
  experimentally claimed; the result above is from the implemented synthetic experiment.

Q: What happens if a researcher compresses the FASTQ with gzip?

  FASTQ.gz is lossless compression. The watermark survives gzip compression and
  decompression perfectly. All quality score bits are preserved exactly.
  A .fastq.gz file downloaded from GenoVault retains its watermark.

Q: What happens if a researcher converts FASTQ to FASTA format?

  FASTA format does not store quality scores. Converting FASTQ → FASTA removes
  all quality scores and therefore removes the watermark.
  This is a known limitation. GenoVault cannot detect misuse of FASTA-converted copies.
  The metadata watermark for BAM/VCF has the same stripping vulnerability.

Q: What happens if two researchers share a file — whose watermark appears?

  Only ONE watermark is embedded per download. If researcher A downloaded the file
  and shared it with researcher B, the watermark belongs to researcher A's download.
  If researcher B also downloaded independently, B's copy has B's watermark.
  A leaked copy traces to whichever download event produced it.

Q: Can a researcher remove the watermark by writing a script?

  Without knowing WATERMARK_SECRET, no.
  They would need to try all possible quality score modifications exhaustively
  across hundreds or thousands of positions. With N=7 repetition coding and
  blockCount=4 distributed blocks, this is computationally infeasible.
  With WATERMARK_SECRET compromised, yes — key rotation would then be required.

Q: Why does METADATA_MATCH_ONLY not identify the researcher?

  The NCBI SRA accession has metadata (organism, sequencing platform, etc.) that
  is similar to the owner's dataset. This is not unusual — many researchers
  sequence similar organisms. Without running the watermark detector (which needs
  quality scores), there is no cryptographic link to any specific download.
  Watermark detection is the ONLY reliable way to attribute a specific download.
  METADATA_MATCH_ONLY is flagged for human investigation, not automated attribution.

Q: How long does a scan take?

  This depends on:
    - Number of NCBI E-utilities results (up to 20 in V1)
    - Whether SRA Toolkit is available for FASTQ retrieval
    - Network latency to NCBI APIs
    - Number of registered watermarks per file (inner loop)
  Typical range: 30 seconds (no SRA Toolkit) to 10-15 minutes (full FASTQ retrieval
  for 20 accessions). The scan runs in the background. The owner is not blocked.

Q: Why is the download changed from streaming to in-memory buffering?

  The watermarking algorithm requires the COMPLETE normalized read stream to
  select embedding positions before embedding can begin. Streaming embedding
  (processing each chunk independently) is not possible with a seed-based
  positional scheme because position selection looks at the entire read stream.
  The WM_MAX_FILE_SIZE_MB guard (default 500 MB) prevents OOM crashes.
  V2 will explore chunk-keyed watermarking that restores streaming capability.

Q: What does "ANCHORED" in blockchainStatus mean for a watermark?

  After embedding, GenoVault computes SHA-256(watermarkedBuffer) and registers
  this hash on the Ethereum Sepolia testnet via the existing GenomicDataRegistry
  smart contract's registerFile() function. "ANCHORED" means the transaction
  was confirmed on-chain. This provides a timestamped, immutable record that
  this specific watermarked copy existed at the time of download.
  Even if GenoVault's MongoDB is wiped, the blockchain proves the copy was created.


---

## 18. KNOWN LIMITATIONS AND FUTURE WORK (V2)

### 18.1 V1 Limitations

1. IN-MEMORY BUFFERING ONLY
   The current pipeline buffers the entire decrypted file in RAM.
   Limit: WM_MAX_FILE_SIZE_MB (default 500 MB).
   Very large genomic datasets (whole-genome sequencing, >500 MB) cannot be downloaded.

2. READ REORDERING NOT SUPPORTED
   If a tool reorders the reads in the FASTQ file, the watermark positions shift
   and the watermark cannot be recovered. This is documented and labelled.

3. METADATA WATERMARK IS WEAK
   BAM/VCF metadata watermarks can be trivially stripped with samtools view or bcftools.
   These formats do not receive forensic attribution guarantees.

4. NCBI DISCOVERY ONLY
   V1 scans only NCBI SRA. The European Nucleotide Archive (EBI ENA), DDBJ,
   and other genomic databases are not scanned.

5. SRA TOOLKIT DEPENDENCY
   Quality-bearing FASTQ retrieval requires fasterq-dump installed on the server.
   Without it, all candidates are METADATA_MATCH_ONLY.

6. NO AUTOMATIC SCAN SCHEDULING
   Scans are started manually by the owner. There is no automated scheduled scanning.

7. SEQUENTIAL NCBI REQUESTS
   Candidates are processed sequentially, not in parallel. A large scan may be slow.

### 18.2 Planned V2 Improvements

1. STREAMING WATERMARK EMBEDDING
   Redesign using read-ID-keyed position selection: each read's watermark positions
   are determined by HMAC(seed, readId), not by position in the stream.
   This restores streaming capability and read-reordering robustness.

2. BAM SEQUENCE-LEVEL WATERMARKING
   Use unused BAM auxiliary tag fields (YW:Z:) for a more robust BAM watermark
   that is harder to strip than the SAM @CO header.

3. MULTI-SOURCE SCANNING
   Add EBI ENA adapter (same two-stage architecture) for European database coverage.
   Add DDBJ adapter for Japanese database coverage.

4. SCHEDULED SCANS
   Automated weekly or monthly scans triggered by a cron job.
   Owners receive email alerts when new misuse events are detected.

5. PARALLEL CANDIDATE PROCESSING
   Process multiple NCBI accessions concurrently with configurable parallelism.
   Add a job queue (Bull/BullMQ) for scan tasks.

6. LARGE FILE SUPPORT
   Implement per-chunk watermarking for files above 500 MB.
   Use streaming read ID-keyed approach to avoid full buffering.

7. GENOMIC FORMAT EXPANSION
   CRAM format support (widely used for compressed alignment data).
   Oxford Nanopore FAST5/POD5 format watermarking.

---

*End of GenoVault Genomic Data Provenance & Misuse Detection Engine Documentation*
*Version: 1.1 | Implementation: GENOMIC_LSB_V1 + METADATA_V1*
*Updated: September 2026 — Major Revision R3.5: misuseType classification field + classifyMisuseEvent(); decoupled blockchain state machines documented*
*Status: Fully Implemented*
