// @vitest-environment node
import {afterEach,describe,it,expect} from 'vitest'
import {execFileSync,spawnSync} from 'node:child_process'
import {mkdtempSync,readFileSync,writeFileSync,copyFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
const folders:string[]=[]
afterEach(()=>{for(const p of folders.splice(0))rmSync(p,{recursive:true,force:true})})
function fixture(extra:Record<string,string>={}){
 const root=mkdtempSync(join(tmpdir(),'nexus-backup-check-'));folders.push(root)
 const entries:Record<string,string>={'_tables/documents.jsonl':JSON.stringify({name:'missions',id:1})+'\n'+JSON.stringify({name:'artifacts',id:2})+'\n','missions/documents.jsonl':JSON.stringify({_id:'mission1',ownerKey:'owner'})+'\n','artifacts/documents.jsonl':JSON.stringify({_id:'artifact1',missionId:'mission1'})+'\n',...extra}
 const source=join(root,'source.zip'),archive=join(root,'saved.zip'),report=join(root,'report.json')
 execFileSync('python3',['-c','import json,sys,zipfile; x=json.load(sys.stdin); z=zipfile.ZipFile(sys.argv[1],"w",compression=zipfile.ZIP_DEFLATED); [z.writestr(k,v) for k,v in x.items()]; z.close()',source],{input:JSON.stringify(entries)})
 copyFileSync(source,archive)
 const sha=createHash('sha256').update(readFileSync(source)).digest('hex')
 function run(options:{hash?:string;captured?:string;source?:string}={}){
  const proc=spawnSync('python3',[resolve('scripts/check-recovery-point.py'),'--archive',archive,'--source',options.source??source,'--expected-sha256',options.hash??sha,'--captured-at',options.captured??new Date(Date.now()-10000).toISOString(),'--report',report],{encoding:'utf8'})
  return{status:proc.status,stdout:proc.stdout,result:JSON.parse(proc.stdout.trim())}
 }
 return{root,source,archive,report,sha,run}
}
describe('recovery-point verification',()=>{
 it('excludes Convex table-registry metadata from data counts and checks separate identical copies',()=>{
  const f=fixture(),r=f.run()
  expect(r.status).toBe(0);expect(r.result).toMatchObject({passed:true,tableCount:2,documentCount:2,savedCopyMatchesSource:true,zipCrcPassed:true,restorePerformed:false,fullServiceRecoveryEstablished:false})
  expect(JSON.parse(readFileSync(f.report,'utf8')).tableCounts).toEqual({missions:1,artifacts:1})
 })
 it('detects stale captures without changing valid archives',()=>{
  const f=fixture(),before=readFileSync(f.archive),r=f.run({captured:new Date(Date.now()-25*3600000).toISOString()})
  expect(r.status).toBe(1);expect(r.result).toMatchObject({passed:false,freshness:'stale',zipCrcPassed:true});expect(readFileSync(f.archive)).toEqual(before)
 })
 it('refuses unknown checksums, mismatched copies and same-file claims',()=>{
  const first=fixture();expect(first.run({hash:'0'.repeat(64)}).result.failureCode).toBe('SAVED_COPY_OR_SOURCE_DIGEST_MISMATCH')
  const second=fixture();expect(second.run({source:second.archive}).result.failureCode).toBe('DISTINCT_SAVED_COPY_REQUIRED')
 })
 it('retains missing-parent findings as aggregate issues without exposing private row contents',()=>{
  const secret='private-fixture-do-not-print'
  const f=fixture({'artifacts/documents.jsonl':JSON.stringify({_id:'artifact1',missionId:'missing',content:secret})})
  const r=f.run();expect(r.status).toBe(1);expect(r.result.relationshipIssues).toEqual({'artifacts:missing-mission':1});expect(r.stdout).not.toContain(secret)
 })
 it('rejects unsafe archive paths and duplicate registry entries',()=>{
  const a=fixture({'../private.txt':'fixture'});expect(a.run().result.failureCode).toBe('UNSAFE_OR_DUPLICATE_ARCHIVE_PATH')
  const b=fixture({'_tables/documents.jsonl':'{"name":"missions","id":1}\n{"name":"missions","id":2}\n'});expect(b.run().result.failureCode).toBe('EXPORT_TABLE_REGISTRY_MISMATCH')
 })
 it('rejects invalid document rows and missing table files',()=>{
  const a=fixture({'artifacts/documents.jsonl':'{"missionId":"mission1"}'});expect(a.run().result.failureCode).toBe('INVALID_OR_DUPLICATE_DOCUMENT_ID')
  const b=fixture({'_tables/documents.jsonl':'{"name":"missions","id":1}\n'});expect(b.run().result.failureCode).toBe('EXPORT_TABLE_REGISTRY_MISMATCH')
 })
 it('reports missing original private-media bytes rather than claiming a complete archive',()=>{
  const f=fixture({'_tables/documents.jsonl':'{"name":"missions","id":1}\n{"name":"artifacts","id":2}\n{"name":"privateMedia","id":3}\n','privateMedia/documents.jsonl':'{"_id":"media1","storageId":"file1"}\n'})
  expect(f.run().result).toMatchObject({passed:false,relationshipIssues:{'privateMedia:missing-original-file':1}})
 })
 it('checks archive integrity and never accepts a truncated ZIP merely because its hash was supplied',()=>{
  const f=fixture();const bytes=readFileSync(f.archive).subarray(0,60);writeFileSync(f.archive,bytes);writeFileSync(f.source,bytes)
  const hash=createHash('sha256').update(bytes).digest('hex')
  expect(f.run({hash}).result.failureCode).toBe('ARCHIVE_VERIFICATION_FAILED')
 })
 it('preserves existing reports and requires explicit timezone-aware capture provenance',()=>{
  const a=fixture();writeFileSync(a.report,'previous');expect(a.run().result.failureCode).toBe('REPORT_NOT_WRITTEN');expect(readFileSync(a.report,'utf8')).toBe('previous')
  const b=fixture();expect(b.run({captured:'2026-10-18T00:00:00'}).result.failureCode).toBe('CAPTURE_TIME_REQUIRES_TIMEZONE')
 })
 it('treats Convex _storage/documents.jsonl as file-storage metadata, not an unregistered table (regression)',()=>{
  const f=fixture({'_storage/documents.jsonl':JSON.stringify({_id:'kg2file1',sha256:'x',size:3})+'\n'}),r=f.run()
  expect(r.status).toBe(0);expect(r.result).toMatchObject({passed:true,tableCount:2,documentCount:2})
 })
})
