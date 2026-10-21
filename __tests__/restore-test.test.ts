// @vitest-environment node
import {afterEach,describe,it,expect} from 'vitest'
import {execFileSync,spawnSync} from 'node:child_process'
import {mkdtempSync,readFileSync,writeFileSync,chmodSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'

const wf=readFileSync(resolve('.github/workflows/nexus-forge-restore-test.yml'),'utf8')
const folders:string[]=[]
afterEach(()=>{for(const p of folders.splice(0))rmSync(p,{recursive:true,force:true})})
function tmp(){const d=mkdtempSync(join(tmpdir(),'nexus-restore-'));folders.push(d);return d}
function section(text:string,start:string,end?:string){
 const i=text.indexOf(start);expect(i).toBeGreaterThan(-1)
 const j=end?text.indexOf(end,i+start.length):-1
 return text.slice(i,j>-1?j:undefined)
}
function zip(path:string,entries:Record<string,string>){
 execFileSync('python3',['-c','import json,sys,zipfile; x=json.load(sys.stdin); z=zipfile.ZipFile(sys.argv[1],"w",compression=zipfile.ZIP_DEFLATED); [z.writestr(k,v) for k,v in x.items()]; z.close()',path],{input:JSON.stringify(entries)})
}
const jl=(...ids:string[])=>ids.map(id=>JSON.stringify({_id:id})).join('\n')+'\n'
function compare(exp:Record<string,string>,act:Record<string,string>){
 const d=tmp(),e=join(d,'e.zip'),a=join(d,'a.zip');zip(e,exp);zip(a,act)
 const p=spawnSync('python3',[resolve('scripts/compare-restore.py'),'--expected',e,'--actual',a,'--report',join(d,'r.json')],{encoding:'utf8'})
 return{status:p.status,result:JSON.parse(p.stdout.trim().split('\n').pop()||'{}')}
}
const base={'_tables/documents.jsonl':jl('x'),'_storage/documents.jsonl':jl('s1'),'missions/documents.jsonl':jl('m1','m2'),'artifacts/documents.jsonl':jl('a1')}

describe('restore comparison',()=>{
 it('passes when tables, counts and document IDs match, ignoring export metadata',()=>{
  const r=compare(base,{...base,'_storage/documents.jsonl':jl('other')})
  expect(r.status).toBe(0);expect(r.result).toMatchObject({passed:true,expectedTables:2,actualTables:2,expectedDocuments:3,actualDocuments:3})
 })
 it('fails on a missing table',()=>{
  const {['artifacts/documents.jsonl']:_,...rest}=base
  expect(compare(base,rest).result).toMatchObject({passed:false,missingTables:['artifacts']})
 })
 it('fails on an extra table left behind in the target',()=>{
  expect(compare(base,{...base,'stale/documents.jsonl':jl('z')}).result).toMatchObject({passed:false,extraTables:['stale']})
 })
 it('fails on a per-table count mismatch',()=>{
  expect(compare(base,{...base,'missions/documents.jsonl':jl('m1')}).result.countMismatches).toEqual({missions:{expected:2,actual:1}})
 })
 it('fails when counts match but document IDs differ',()=>{
  expect(compare(base,{...base,'missions/documents.jsonl':jl('m1','m3')}).result).toMatchObject({passed:false,idSetMismatches:['missions']})
 })
 it('refuses a corrupt snapshot',()=>{
  const d=tmp(),e=join(d,'e.zip'),a=join(d,'a.zip');zip(e,base);writeFileSync(a,'not a zip')
  const p=spawnSync('python3',[resolve('scripts/compare-restore.py'),'--expected',e,'--actual',a,'--report',join(d,'r.json')],{encoding:'utf8'})
  expect(p.status).toBe(1);expect(p.stdout).toContain('SNAPSHOT_NOT_ZIP')
 })
})

describe('restore-test workflow safety',()=>{
 it('is manual-only and defaults to not confirmed',()=>{
  const on=section(wf,'on:','permissions:')
  expect(on).toMatch(/workflow_dispatch:/);expect(on).not.toMatch(/\n\s+(push|pull_request|schedule):/)
  expect(on).toMatch(/confirm_restore_test:[\s\S]*type: boolean[\s\S]*default: false/)
 })
 it('never references the production deploy key or --prod',()=>{
  expect(wf).not.toContain('secrets.CONVEX_DEPLOY_KEY');expect(wf).not.toMatch(/--prod\b/)
  expect(wf).toContain('CONVEX_DEPLOY_KEY: ${{ secrets.CONVEX_RESTORE_TEST_DEPLOY_KEY }}')
  expect(wf).not.toMatch(/continue-on-error|\|\|\s*true/)
 })
 const guard=section(wf,'- name: Guard isolated non-production target','- name: Set up Node.js')
 const body=guard.split('run: |')[1].split('\n').map(l=>l.replace(/^ {10}/,'')).join('\n')
 function run(over:Record<string,string>){
  const bin=tmp();writeFileSync(join(bin,'aws'),'#!/bin/sh\nexit 0\n');chmodSync(join(bin,'aws'),0o755)
  const env={PATH:bin+':'+(process.env.PATH??''),CONFIRM_RESTORE_TEST:'true',CONVEX_DEPLOY_KEY:'dev:quick-rabbit-810|fixture-not-a-secret',TARGET_DEPLOYMENT:'quick-rabbit-810',PRODUCTION_DEPLOYMENT:'tame-rat-826',ARCHIVE_KEY:'nexus-forge/live/live-2026-10-21T211023Z-run-39676545535-1.zip',EXPECTED_SHA256:'c'.repeat(64),AWS_ACCESS_KEY_ID:'x',AWS_SECRET_ACCESS_KEY:'x',BACKUP_S3_BUCKET:'nexus-forge-backups',BACKUP_S3_ENDPOINT:'https://ref.storage.supabase.co/storage/v1/s3',AWS_REGION:'us-west-2',...over}
  return spawnSync('bash',['-c',body],{env,encoding:'utf8'})
 }
 it('accepts only a dev key for exactly the named non-production target, without printing it',()=>{
  const ok=run({});expect(ok.status).toBe(0);expect(ok.stdout).not.toContain('fixture-not-a-secret')
 })
 it('refuses production keys, production targets, mismatched or preview keys and missing keys',()=>{
  expect(run({CONVEX_DEPLOY_KEY:'prod:tame-rat-826|k'}).status).toBe(1)
  expect(run({CONVEX_DEPLOY_KEY:'prod:quick-rabbit-810|k'}).status).toBe(1)
  expect(run({TARGET_DEPLOYMENT:'tame-rat-826',CONVEX_DEPLOY_KEY:'dev:tame-rat-826|k'}).status).toBe(1)
  expect(run({CONVEX_DEPLOY_KEY:'dev:other-deploy-123|k'}).status).toBe(1)
  expect(run({CONVEX_DEPLOY_KEY:'preview:team:project|k'}).status).toBe(1)
  expect(run({CONVEX_DEPLOY_KEY:''}).status).toBe(1)
  expect(run({CONFIRM_RESTORE_TEST:'false'}).status).toBe(1)
  expect(run({EXPECTED_SHA256:'abc'}).status).toBe(1)
  expect(run({ARCHIVE_KEY:'../etc/passwd'}).status).toBe(1)
 })
 it('snapshots the target before importing and always returns it after an import starts',()=>{
  expect(wf.indexOf('- name: Snapshot the target before restoring')).toBeLessThan(wf.indexOf('- name: Restore backup into the isolated target'))
  const ret=section(wf,'- name: Return the target to its pre-test state')
  expect(ret).toContain("if: always() && steps.restore.outputs.started == 'true'")
  expect(ret).toContain('import --replace-all --yes "$WORK/pre-restore.zip"');expect(ret).toContain('compare-restore.py')
 })
 it('verifies the downloaded archive digest before importing and compares after',()=>{
  const dl=section(wf,'- name: Download and verify the backup archive','- name: Snapshot the target')
  expect(dl).toContain('"$SHA" != "$EXPECTED_SHA256"')
  const cmp=section(wf,'- name: Compare restored target with the backup','- name: Return the target')
  expect(cmp).toContain('compare-restore.py');expect(cmp).toContain('check-recovery-point.py')
 })
})
