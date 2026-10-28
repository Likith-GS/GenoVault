/**
 * watermarkRobustnessSupplemental.js — P6 (reorder), P7 (removal), P8 (reserialize)
 * Campaign: EVIDENCE_2026-10-17
 */
"use strict";
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const crypto = require("crypto");
const fs     = require("fs");
const path   = require("path");
const wmService = require("../services/watermarkService");
const { normalizeFASTQ, serializeFASTQ } = require("../services/watermark/lsbQualityEmbedder");

const N=5, N_READS=500, READ_LEN=150;
const OUT_FILE = path.resolve(__dirname, "../../results/phase7_watermark/watermark_robustness_supplemental.json");

function generateSyntheticFASTQBuffer(nReads=N_READS, readLen=READ_LEN) {
  const bases=["A","T","C","G"]; const lines=[];
  for(let i=0;i<nReads;i++){
    lines.push(`@SYN_READ_${i}_${crypto.randomBytes(4).toString("hex")}`);
    let seq=""; for(let j=0;j<readLen;j++) seq+=bases[crypto.randomBytes(1)[0]%4];
    lines.push(seq); lines.push("+");
    let qual=""; for(let j=0;j<readLen;j++){const p=20+(crypto.randomBytes(1)[0]%21);qual+=String.fromCharCode(p+33);}
    lines.push(qual);
  }
  return Buffer.from(lines.join("\n")+"\n","utf8");
}
function makeSyntheticWatermarkRecord(){
  const ownerId=crypto.randomBytes(12).toString("hex");
  const researcherId=crypto.randomBytes(12).toString("hex");
  const fileId=crypto.randomBytes(12).toString("hex");
  const accessReqId=crypto.randomBytes(12).toString("hex");
  const downloadId=wmService.generateDownloadId();
  const nonce=crypto.randomBytes(16);
  const watermarkSeed=wmService.generateWatermarkSeed(ownerId,researcherId,fileId,accessReqId,downloadId,nonce);
  return wmService.buildWatermarkRecord({watermarkId:wmService.generateWatermarkId(),downloadId,fileId,ownerId,researcherId,accessRequestId:accessReqId,watermarkSeed,fileExt:".fastq",fileSize:0,originalFileHash:crypto.randomBytes(32).toString("hex")});
}
function computeStats(arr){
  const n=arr.length,mn=arr.reduce((a,b)=>a+b,0)/n;
  const sd=n>1?Math.sqrt(arr.reduce((a,b)=>a+(b-mn)**2,0)/(n-1)):0;
  const s=[...arr].sort((a,b)=>a-b);
  const med=n%2===0?(s[n/2-1]+s[n/2])/2:s[Math.floor(n/2)];
  return{mean:+mn.toFixed(4),sd:+sd.toFixed(4),median:+med.toFixed(4),min:+Math.min(...arr).toFixed(4),max:+Math.max(...arr).toFixed(4)};
}

// P6: Fisher-Yates shuffle of all reads
function perturbReadReorder(buf){
  const reads=normalizeFASTQ(buf);
  for(let i=reads.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[reads[i],reads[j]]=[reads[j],reads[i]];}
  return serializeFASTQ(reads);
}
// P7: delete 5% of reads (shrinks array — distinct from P3 substitution)
function perturbReadRemoval(buf,rate=0.05){
  const reads=normalizeFASTQ(buf);
  const n=Math.floor(reads.length*rate);
  const rm=new Set();
  while(rm.size<n)rm.add(Math.floor(Math.random()*reads.length));
  return serializeFASTQ(reads.filter((_,i)=>!rm.has(i)));
}
// P8: parse then re-serialize with no other change
function perturbReserialize(buf){return serializeFASTQ(normalizeFASTQ(buf));}

async function runPerturbation(label,description,perturbFn){
  console.log(`\n  --- ${label} ---`);
  const runResults=[];
  for(let i=0;i<N;i++){
    let record,plainBuffer,wmBuffer;
    try{
      record=makeSyntheticWatermarkRecord();
      plainBuffer=generateSyntheticFASTQBuffer();
      const {watermarkedBuffer}=wmService.embedWatermark(plainBuffer,".fastq",record);
      wmBuffer=watermarkedBuffer;
    }catch(err){runResults.push({run:i+1,detected:false,matchScore:0,verified:false,error:`EMBED_FAILED:${err.message}`});console.warn(`    Run ${i+1}: EMBED ERROR`);continue;}
    try{
      const perturbed=perturbFn(wmBuffer);
      const detection=wmService.detectWatermarkInCandidate(perturbed,record);
      const detected=!!(detection.verified||detection.matchScore>=0.85);
      runResults.push({run:i+1,detected,matchScore:+(detection.matchScore||0).toFixed(4),verified:!!detection.verified,confidence:detection.confidence});
      console.log(`    Run ${i+1}: score=${(detection.matchScore||0).toFixed(4)} verified=${detection.verified}`);
    }catch(err){runResults.push({run:i+1,detected:false,matchScore:0,verified:false,error:`DETECT_FAILED:${err.message}`});console.warn(`    Run ${i+1}: DETECT ERROR — ${err.message}`);}
  }
  const detected=runResults.filter(r=>r.detected).length;
  const scores=runResults.map(r=>r.matchScore||0);
  const detectionRate=`${((detected/N)*100).toFixed(1)}%`;
  console.log(`    Detection rate: ${detectionRate} (${detected}/${N})`);
  return{label,description,nRuns:N,detected,notDetected:N-detected,detectionRate,matchScoreStats:computeStats(scores),runs:runResults};
}

async function main(){
  const runAt=new Date().toISOString();
  console.log("=== GenoVault Robustness Supplemental (P6,P7,P8) ===");
  console.log(`  runAt: ${runAt}`);
  const results=[];
  results.push(await runPerturbation("P6_read_reorder","Fisher-Yates shuffle of all 500 reads. Read count unchanged; position selection recomputed from shuffled array.",perturbReadReorder));
  results.push(await runPerturbation("P7_5pct_read_removal","Delete 25 of 500 reads (random). Array shrinks to 475. Detector recomputes positions mod 475 — different mapping from mod 500.",perturbReadRemoval));
  results.push(await runPerturbation("P8_fastq_reserialize","normalizeFASTQ then serializeFASTQ with no other change. Tests losslessness of the parse/serialize cycle.",perturbReserialize));
  const output={experiment:"watermark_robustness_supplemental",version:"v1",campaign:"EVIDENCE_2026-10-17",runAt,pipeline:"generateWatermarkSeed->buildWatermarkRecord->embedWatermark(.fastq)->perturbFn->detectWatermarkInCandidate",nRuns:N,syntheticReads:{count:N_READS,readLength:READ_LEN,dataSource:"SYNTHETIC — crypto.randomBytes() only"},detectionThreshold:"verified===true OR matchScore>=0.85",notes:["P6: shuffle changes read order; position selection uses readIdx%reads.length — reordering invalidates the mapping.","P7: removal shrinks reads.length from 500 to 475, changing ALL modulo computations in position selection. Distinct from P3 (which substitutes, preserving reads.length=500).","P8: tests parse/serialize byte-level losslessness.","All data SYNTHETIC. No real genomic data."],perturbations:results};
  const outDir=path.dirname(OUT_FILE);
  if(!fs.existsSync(outDir))fs.mkdirSync(outDir,{recursive:true});
  fs.writeFileSync(OUT_FILE,JSON.stringify(output,null,2),"utf8");
  console.log(`\nResults written to: ${OUT_FILE}`);
}
main().catch(err=>{console.error("FAILED:",err.message);process.exit(1);});
