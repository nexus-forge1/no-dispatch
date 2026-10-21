// @vitest-environment node
import {describe,it,expect} from 'vitest'
import {readFileSync,writeFileSync,mkdtempSync,chmodSync,rmSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {resolve,join} from 'node:path'
import {tmpdir} from 'node:os'

const backup=readFileSync(resolve('.github/workflows/nexus-forge-backup-capture.yml'),'utf8')

function section(text:string,start:string,end?:string){
 const i=text.indexOf(start);expect(i).toBeGreaterThan(-1)
 const j=end?text.indexOf(end,i+start.length):-1
 return text.slice(i,j>-1?j:undefined)
}

describe('verified backup workflow gating',()=>{
 it('is manual-only with a boolean confirmation that defaults to false',()=>{
  const on=section(backup,'on:','permissions:')
  expect(on).toMatch(/workflow_dispatch:/);expect(on).not.toMatch(/\n\s+(push|pull_request|schedule):/)
  expect(on).toMatch(/confirm_live_export:[\s\S]*type: boolean[\s\S]*default: false/)
 })
 it('runs the live capture job only when confirmation is true',()=>{
  expect(section(backup,'  capture-verify-store:','runs-on:')).toContain('if: ${{ inputs.confirm_live_export == true }}')
 })
 it('makes an unconfirmed dispatch fail visibly instead of looking like a backup',()=>{
  const guard=section(backup,'  confirmation-required:','  capture-verify-store:')
  expect(guard).toContain('if: ${{ inputs.confirm_live_export != true }}')
  expect(guard).toContain('No backup was taken');expect(guard).toMatch(/exit 1/)
  expect(guard).not.toMatch(/CONVEX|BACKUP_S3|aws /)
 })
 it('never weakens failure handling',()=>{
  expect(backup).not.toMatch(/continue-on-error/)
  expect(backup).not.toMatch(/\|\|\s*true/)
  expect(backup).toMatch(/permissions:\n  contents: read\n/)
 })
 it('detects missing configuration (regression: escaped indirect expansion never fired)',()=>{
  expect(backup).not.toContain('\\${!name')
  const check=section(backup,'- name: Require explicitly configured private backup destination','- name: Set up Node.js')
  const body=check.split('run: |')[1].split('\n').map(l=>l.replace(/^ {10}/,'')).join('\n')
  const env={PATH:process.env.PATH??'',CONFIRM_LIVE_EXPORT:'true',BACKUP_S3_ACCESS_KEY_ID:'x',BACKUP_S3_SECRET_ACCESS_KEY:'x',BACKUP_S3_BUCKET:'bucket',BACKUP_S3_REGION:'r'}
  const missing=spawnSync('bash',['-c',body],{env,encoding:'utf8'})
  expect(missing.status).toBe(1);expect(missing.stdout).toContain('missing: CONVEX_DEPLOY_KEY')
  const ok=spawnSync('bash',['-c',body],{env:{...env,CONVEX_DEPLOY_KEY:'fixture-not-a-secret'},encoding:'utf8'})
  expect(ok.status).toBe(0);expect(ok.stdout).not.toContain('fixture-not-a-secret')
  const unconfirmed=spawnSync('bash',['-c',body],{env:{...env,CONVEX_DEPLOY_KEY:'k',CONFIRM_LIVE_EXPORT:'false'},encoding:'utf8'})
  expect(unconfirmed.status).toBe(1)
  const path=spawnSync('bash',['-c',body],{env:{...env,CONVEX_DEPLOY_KEY:'k',BACKUP_S3_BUCKET:'bucket/sub'},encoding:'utf8'})
  expect(path.status).toBe(1)
 })
 it('accepts only the exact Supabase S3 endpoint form and forces path-style addressing',()=>{
  const check=section(backup,'- name: Require explicitly configured private backup destination','- name: Set up Node.js')
  const body=check.split('run: |')[1].split('\n').map(l=>l.replace(/^ {10}/,'')).join('\n')
  const bin=mkdtempSync(join(tmpdir(),'fake-aws-')),log=join(bin,'calls.log')
  writeFileSync(join(bin,'aws'),`#!/bin/sh\necho "$@" >> "${log}"\n`);chmodSync(join(bin,'aws'),0o755)
  const env={PATH:bin+':'+(process.env.PATH??''),CONFIRM_LIVE_EXPORT:'true',CONVEX_DEPLOY_KEY:'k',BACKUP_S3_ACCESS_KEY_ID:'x',BACKUP_S3_SECRET_ACCESS_KEY:'x',BACKUP_S3_BUCKET:'nexus-backups',BACKUP_S3_REGION:'us-east-1'}
  const run=(endpoint:string)=>spawnSync('bash',['-c',body],{env:{...env,BACKUP_S3_ENDPOINT:endpoint},encoding:'utf8'})
  expect(run('https://abcdefghijklmnop.storage.supabase.co/storage/v1/s3').status).toBe(0)
  expect(readFileSync(log,'utf8')).toContain('configure set default.s3.addressing_style path')
  expect(run('https://abcdefghijklmnop.supabase.co/storage/v1/s3').status).toBe(0)
  for(const bad of ['https://abcdefghijklmnop.storage.supabase.co/storage/v1/s3/','https://abcdefghijklmnop.storage.supabase.co','https://abcdefghijklmnop.storage.supabase.co/storage/v1/s3/nexus-backups','http://abcdefghijklmnop.storage.supabase.co/storage/v1/s3'])
   expect(run(bad).status).toBe(1)
  rmSync(bin,{recursive:true,force:true})
 })
 it('disables flexible checksum headers that Supabase Storage rejects',()=>{
  expect(backup).toContain('AWS_REQUEST_CHECKSUM_CALCULATION: when_required')
  expect(backup).toContain('AWS_RESPONSE_CHECKSUM_VALIDATION: when_required')
  expect(backup).not.toMatch(/--checksum-algorithm/)
 })
 it('treats only Not Found as a free destination key',()=>{
  const upload=section(backup,'- name: Upload archive to private S3-compatible storage','- name: Independently retrieve saved archive and verify exact bytes')
  expect(upload).toContain("elif ! grep -Eq '\\(404\\)|Not Found|NoSuchKey'")
  const pattern="\\(404\\)|Not Found|NoSuchKey"
  const grep=(msg:string)=>spawnSync('grep',['-Eq',pattern],{input:msg}).status
  expect(grep('An error occurred (404) when calling the HeadObject operation: Not Found')).toBe(0)
  expect(grep('An error occurred (403) when calling the HeadObject operation: Forbidden')).toBe(1)
  expect(grep('Could not connect to the endpoint URL')).toBe(1)
 })
 it('retrieves independently and compares against values fixed before upload',()=>{
  const upload=section(backup,'- name: Upload archive to private S3-compatible storage','- name: Independently retrieve saved archive and verify exact bytes')
  expect(upload.indexOf('SOURCE_SHA=')).toBeLessThan(upload.indexOf('put-object'))
  expect(upload).toMatch(/head-object[\s\S]*already exists/)
  const retrieve=section(backup,'- name: Independently retrieve saved archive and verify exact bytes','- name: Verify ZIP structure')
  expect(retrieve).toContain('mktemp -d');expect(retrieve).toContain('get-object');expect(retrieve).toContain('backup-receipt.py compare')
  expect(retrieve).toContain('--remote-bytes')
 })
 it('validates the stored receipt and report after upload',()=>{
  const last=section(backup,'- name: Independently retrieve and validate stored receipt and report')
  expect(last).toContain('backup-receipt.py validate');expect(last).toMatch(/get-object[\s\S]*receipt\.json/)
 })
})

describe('no-dispatch coverage retained from the original workflow',()=>{
 it('keeps the ZIP, table, relationship and freshness verifier on the retrieved copy',()=>{
  const v=section(backup,'- name: Verify ZIP structure, tables, relationships and freshness','- name: Upload verification report')
  expect(v).toContain('scripts/check-recovery-point.py');expect(v).toContain('--archive "$RETRIEVED_PATH"');expect(v).toContain('--captured-at')
 })
 it('keeps the byte-for-byte cmp and signed s3api retrieval for Supabase',()=>{
  const r=section(backup,'- name: Independently retrieve saved archive and verify exact bytes','- name: Verify ZIP structure')
  expect(r).toContain('cmp --silent');expect(r).toContain('s3api get-object');expect(r).not.toMatch(/ s3 cp "s3:/)
 })
 it('keeps the existing object layout so earlier captures stay discoverable',()=>{
  expect(backup).toContain('ARCHIVE_KEY="nexus-forge/live/$CAPTURE_KEY.zip"')
  expect(backup).toContain('report_key=$ARCHIVE_KEY.verification.json')
  expect(backup).toContain('receipt_key=nexus-forge/receipts/$CAPTURE_KEY.json')
 })
 it('writes and uploads the receipt only on success',()=>{
  const w=section(backup,'- name: Write receipt only after capture and retrieval checks pass','- name: Independently retrieve and validate')
  expect(w).toContain('if: success()');expect(w).toContain('backup-receipt.py build')
 })
})
