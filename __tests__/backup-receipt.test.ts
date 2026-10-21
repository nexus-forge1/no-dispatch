// @vitest-environment node
import {afterEach,describe,it,expect} from 'vitest'
import {execFileSync,spawnSync} from 'node:child_process'
import {mkdtempSync,readFileSync,writeFileSync,copyFileSync,rmSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'

const folders:string[]=[]
afterEach(()=>{for(const p of folders.splice(0))rmSync(p,{recursive:true,force:true})})
const script=resolve('scripts/backup-receipt.py')
const verifier=resolve('scripts/check-recovery-point.py')
const CAPTURE='live-2026-10-21T170000Z-run-42-1'
const ARCHIVE_KEY=`nexus-forge/live/${CAPTURE}.zip`
const REPORT_KEY=`${ARCHIVE_KEY}.verification.json`

function py(args:string[]){
 const proc=spawnSync('python3',[script,...args],{encoding:'utf8'})
 return{status:proc.status,stdout:proc.stdout,result:JSON.parse(proc.stdout.trim().split('\n').pop()||'{}')}
}
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'nexus-backup-receipt-'));folders.push(root)
 const entries={'_tables/documents.jsonl':JSON.stringify({name:'missions',id:1})+'\n','missions/documents.jsonl':JSON.stringify({_id:'mission1'})+'\n'}
 const source=join(root,'source.zip'),retrieved=join(root,'retrieved.zip'),report=join(root,'report.json'),receipt=join(root,'receipt.json')
 execFileSync('python3',['-c','import json,sys,zipfile; x=json.load(sys.stdin); z=zipfile.ZipFile(sys.argv[1],"w",compression=zipfile.ZIP_DEFLATED); [z.writestr(k,v) for k,v in x.items()]; z.close()',source],{input:JSON.stringify(entries)})
 copyFileSync(source,retrieved)
 const bytes=readFileSync(source),sha=createHash('sha256').update(bytes).digest('hex'),size=bytes.length
 const capturedAt=new Date(Date.now()-10000).toISOString().replace(/\.\d{3}Z$/,'Z')
 const v=spawnSync('python3',[verifier,'--archive',retrieved,'--source',source,'--expected-sha256',sha,'--captured-at',capturedAt,'--report',report],{encoding:'utf8'})
 expect(v.status).toBe(0)
 const buildArgs=(o:Record<string,string>={})=>{
  const a:Record<string,string>={archive:source,retrieved,report,'reported-sha256':sha,'reported-bytes':String(size),'capture-key':CAPTURE,'captured-at':capturedAt,'archive-key':ARCHIVE_KEY,'report-key':REPORT_KEY,'commit-sha':'a'.repeat(40),'run-id':'42','run-url':'https://github.com/o/r/actions/runs/42',bucket:'nexus-backups',out:receipt,...o}
  return ['build',...Object.entries(a).flatMap(([k,v])=>['--'+k,v])]
 }
 const validateArgs=(o:Record<string,string>={})=>{
  const a:Record<string,string>={receipt,report,'expected-sha256':sha,'expected-bytes':String(size),'capture-key':CAPTURE,'archive-key':ARCHIVE_KEY,'report-key':REPORT_KEY,'commit-sha':'a'.repeat(40),'run-id':'42',...o}
  return ['validate',...Object.entries(a).flatMap(([k,v])=>['--'+k,v])]
 }
 const compareArgs=(o:Record<string,string>={})=>{
  const a:Record<string,string>={source,retrieved,'reported-sha256':sha,'reported-bytes':String(size),...o}
  return ['compare',...Object.entries(a).flatMap(([k,v])=>['--'+k,v])]
 }
 return{root,source,retrieved,report,receipt,sha,size,capturedAt,buildArgs,validateArgs,compareArgs}
}

describe('independent retrieval comparison',()=>{
 it('passes only when retrieved bytes match the values reported before upload',()=>{
  const f=fixture(),r=py(f.compareArgs({'remote-bytes':String(f.size)}))
  expect(r.status).toBe(0);expect(r.result).toMatchObject({passed:true,retrievedSha256:f.sha,retrievedBytes:f.size})
 })
 it('fails when retrieval produced no object',()=>{
  const f=fixture();rmSync(f.retrieved)
  expect(py(f.compareArgs())).toMatchObject({status:1,result:{failureCode:'RETRIEVED_FILE_MISSING'}})
 })
 it('fails on a byte-count mismatch',()=>{
  const f=fixture();writeFileSync(f.retrieved,Buffer.concat([readFileSync(f.retrieved),Buffer.from('x')]))
  expect(py(f.compareArgs()).result.failureCode).toBe('RETRIEVED_BYTE_COUNT_MISMATCH')
 })
 it('fails on a SHA-256 mismatch with identical length',()=>{
  const f=fixture(),b=Buffer.from(readFileSync(f.retrieved));b[b.length-1]^=0xff;writeFileSync(f.retrieved,b)
  expect(py(f.compareArgs()).result.failureCode).toBe('RETRIEVED_SHA256_MISMATCH')
 })
 it('fails when storage reports a different object size',()=>{
  const f=fixture()
  expect(py(f.compareArgs({'remote-bytes':String(f.size+1)})).result.failureCode).toBe('REMOTE_OBJECT_SIZE_MISMATCH')
 })
 it('refuses to treat the source file as its own retrieved copy',()=>{
  const f=fixture()
  expect(py(f.compareArgs({retrieved:f.source})).result.failureCode).toBe('DISTINCT_RETRIEVED_COPY_REQUIRED')
 })
 it('refuses missing or malformed reported values',()=>{
  const f=fixture()
  expect(py(f.compareArgs({'reported-sha256':''})).result.failureCode).toBe('REPORTED_SHA256_INVALID')
  expect(py(f.compareArgs({'reported-bytes':'0'})).result.failureCode).toBe('REPORTED_BYTES_INVALID')
 })
})

describe('receipt construction and validation',()=>{
 it('builds a receipt bound to the same archive, digest, size, report, commit and run, then validates it',()=>{
  const f=fixture(),b=py(f.buildArgs())
  expect(b.status).toBe(0)
  const receipt=JSON.parse(readFileSync(f.receipt,'utf8'))
  expect(receipt).toMatchObject({sha256:f.sha,retrievedSha256:f.sha,bytes:f.size,retrievedBytes:f.size,archiveKey:ARCHIVE_KEY,verificationReportKey:REPORT_KEY,capturedAt:f.capturedAt,commitSha:'a'.repeat(40),restorePerformed:false,liveExportConfirmed:true})
  expect(py(f.validateArgs()).status).toBe(0)
 })
 it('refuses a receipt when the verification report did not pass',()=>{
  const f=fixture(),rep=JSON.parse(readFileSync(f.report,'utf8'));rep.passed=false;writeFileSync(f.report,JSON.stringify(rep))
  expect(py(f.buildArgs()).result.failureCode).toBe('REPORT_NOT_PASSED');expect(existsSync(f.receipt)).toBe(false)
 })
 it('refuses invalid recovery metadata that refers to a different archive or capture',()=>{
  const a=fixture(),ra=JSON.parse(readFileSync(a.report,'utf8'));ra.sha256='0'.repeat(64);writeFileSync(a.report,JSON.stringify(ra))
  expect(py(a.buildArgs()).result.failureCode).toBe('REPORT_SHA256_MISMATCH')
  const b=fixture(),rb=JSON.parse(readFileSync(b.report,'utf8'));rb.bytes=rb.bytes+1;writeFileSync(b.report,JSON.stringify(rb))
  expect(py(b.buildArgs()).result.failureCode).toBe('REPORT_BYTES_MISMATCH')
  const c=fixture()
  expect(py(c.buildArgs({'captured-at':'2020-01-01T00:00:00Z'})).result.failureCode).toBe('REPORT_CAPTURE_TIME_MISMATCH')
  const d=fixture();writeFileSync(d.report,'not json')
  expect(py(d.buildArgs()).result.failureCode).toBe('REPORT_UNREADABLE')
 })
 it('refuses a receipt when the retrieved copy differs from the uploaded archive',()=>{
  const f=fixture(),b=Buffer.from(readFileSync(f.retrieved));b[0]^=0xff;writeFileSync(f.retrieved,b)
  expect(py(f.buildArgs()).result.failureCode).toBe('RETRIEVED_SHA256_MISMATCH')
 })
 it('refuses an archive key that belongs to a different capture',()=>{
  const f=fixture()
  expect(py(f.buildArgs({'archive-key':'nexus-forge/live/other.zip'})).result.failureCode).toBe('ARCHIVE_KEY_CAPTURE_KEY_MISMATCH')
  expect(py(f.buildArgs({'report-key':'nexus-forge/live/other.zip.verification.json'})).result.failureCode).toBe('REPORT_KEY_CAPTURE_KEY_MISMATCH')
 })
 it('rejects a stored receipt that does not match the expected backup',()=>{
  const f=fixture();expect(py(f.buildArgs()).status).toBe(0)
  expect(py(f.validateArgs({'expected-sha256':'1'.repeat(64)})).result.failureCode).toBe('RECEIPT_SHA256_MISMATCH')
  expect(py(f.validateArgs({'expected-bytes':String(f.size+1)})).result.failureCode).toBe('RECEIPT_BYTES_MISMATCH')
  expect(py(f.validateArgs({'run-id':'43'})).result.failureCode).toBe('RECEIPT_RUN_MISMATCH')
  expect(py(f.validateArgs({'archive-key':'nexus-forge/live/x.zip'})).result.failureCode).toBe('RECEIPT_ARCHIVE_KEY_MISMATCH')
 })
 it('never overwrites an existing receipt',()=>{
  const f=fixture();writeFileSync(f.receipt,'previous')
  expect(py(f.buildArgs()).result.failureCode).toBe('RECEIPT_ALREADY_EXISTS');expect(readFileSync(f.receipt,'utf8')).toBe('previous')
 })
})
