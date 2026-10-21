import { createFileRoute } from '@tanstack/react-router'
import { useAction, useMutation, useQuery } from 'convex/react'
import { useState } from 'react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { MissionControl } from '../components/mission-control'
import { PortfolioIntelligence } from '../components/portfolio-intelligence'

export const Route = createFileRoute('/')({ component: App })
type Agent = { name: string; role: string; icon: string; state: 'Working' | 'Ready' | 'Guarded'; progress: number; note: string }
const starterAgents: Agent[] = [
  { name: 'Vision Architect', role: 'Mission mapping', icon: '◈', state: 'Working', progress: 0, note: 'Waiting for a mission run.' },
  { name: 'Research Oracle', role: 'Evidence & market', icon: '◎', state: 'Working', progress: 0, note: 'Waiting for a mission run.' },
  { name: 'Systems Engineer', role: 'Architecture', icon: '⌘', state: 'Ready', progress: 0, note: 'Waiting for a mission run.' },
  { name: 'Builder Agent', role: 'Code & tests', icon: '▣', state: 'Ready', progress: 0, note: 'Waiting for a mission run.' },
  { name: 'Creative Director', role: 'Brand & media', icon: '✦', state: 'Working', progress: 0, note: 'Waiting for a mission run.' },
  { name: 'Critic Agent', role: 'Verification', icon: '△', state: 'Guarded', progress: 0, note: 'Waiting for a mission run.' },
]

function App() {
  const [mission, setMission] = useState('Create a new AI venture that turns creative intent into measurable digital products.')
  const [running, setRunning] = useState(false)
  const [autonomy, setAutonomy] = useState('Approval required')
  const [budget, setBudget] = useState(100)
  const [approved, setApproved] = useState(false)
  const [agents, setAgents] = useState(starterAgents)
  const [evidence, setEvidence] = useState('No mission has been created yet. Forge a mission to begin the governed planning flow.')
  const [missionId, setMissionId] = useState<Id<'missions'> | null>(null)
  const [researchQuery, setResearchQuery] = useState('current market opportunities for small AI products')
  const [researching, setResearching] = useState(false)
  const [synthesizing, setSynthesizing] = useState(false)
  const [researchSynthesis, setResearchSynthesis] = useState('')
  const [generating, setGenerating] = useState(false)
  const [artifactName, setArtifactName] = useState('Mission Blueprint')
  const [githubNote, setGithubNote] = useState('GitHub Actions is the free delivery executor.')
  const [targetRepo, setTargetRepo] = useState('eugenemcmillian3-tech/nexus-forge-')
  const [targetBranch, setTargetBranch] = useState('main')
  const [deliveryBusy, setDeliveryBusy] = useState(false)
  const createMission = useMutation(api.missions.create)
  const approveMission = useMutation(api.missions.approve)
  const orchestrate = useAction(api.forge.orchestrate)
  const search = useAction(api.research.search)
  const synthesizeResearch = useAction(api.research.synthesize)
  const generateArtifact = useAction(api.artifacts.generate)
  const approveArtifact = useMutation(api.artifacts.approve)
  const verifyArtifact = useMutation(api.artifacts.verify)
  const remember = useMutation(api.memory.remember)
  const prepareDelivery = useMutation(api.delivery.prepare)
  const approveDelivery = useMutation(api.delivery.approve)
  const executeDelivery = useAction(api.delivery.executeApproved)
  const deliveryRows = useQuery(api.delivery.list, missionId ? { missionId } : 'skip')
  const liveAgentRuns = useQuery(api.forge.listRuns, missionId ? { missionId } : 'skip')
  const researchRows = useQuery(api.research.list, missionId ? { missionId } : 'skip')
  const artifactRows = useQuery(api.artifacts.list, missionId ? { missionId } : 'skip')
  const completion = liveAgentRuns?.length ? Math.round(liveAgentRuns.reduce((sum, agent) => sum + agent.progress, 0) / liveAgentRuns.length) : 0
  const visibleAgents = liveAgentRuns?.length ? liveAgentRuns.map(run => ({ name: run.agent, role: run.role, icon: starterAgents.find(a => a.name === run.agent)?.icon ?? '◌', state: run.status === 'complete' ? 'Ready' as const : run.status === 'running' ? 'Working' as const : 'Guarded' as const, progress: run.progress, note: run.note })) : agents

  const launchMission = async () => {
    setRunning(true)
    try { const id = await createMission({ title: 'NEXUS Forge Mission', mission, autonomy, budget, ownerKey: 'local-workspace' }); setMissionId(id); setApproved(false); setEvidence(`Mission ${id} created as DRAFT. Human approval is required before execution.`) }
    catch (error) { setEvidence(error instanceof Error ? error.message : 'The mission could not be created.') }
    finally { setRunning(false) }
  }
  const runCouncilPlanning = async () => {
    if (!missionId) return
    setRunning(true)
    try { const result = await orchestrate({ missionId, mission }); setEvidence(`Council plan complete: ${result.summary}`); await remember({ ownerKey: 'local-workspace', missionId, category: 'lesson', key: 'latest-orchestration', value: result.summary, confidence: 0.9, source: 'NEXUS Council' }) }
    catch (error) { setEvidence(error instanceof Error ? error.message : 'The council planning run could not complete.') }
    finally { setRunning(false) }
  }
  const approveCurrentMission = async () => {
    if (!missionId) return
    try { await approveMission({ id: missionId, approved: true }); setApproved(true); setEvidence(`Human approval recorded for mission ${missionId}. Execution remains a separate explicit action.`) }
    catch (error) { setEvidence(error instanceof Error ? error.message : 'Approval could not be recorded.') }
  }
  const runResearch = async () => {
    if (!missionId || !researchQuery.trim()) return
    setResearching(true)
    try { const result = await search({ missionId, query: researchQuery.trim(), deepResearch: false }); setEvidence(`Research complete: ${result.citations.length} cited source(s). ${result.result.slice(0, 280)}`) }
    catch (error) { setEvidence(error instanceof Error ? error.message : 'Research failed.') }
    finally { setResearching(false) }
  }
  const synthesizeResearchDossier = async () => {
    if (!missionId) return
    setSynthesizing(true)
    try {
      const result = await synthesizeResearch({ missionId, ownerKey: 'local-workspace' })
      setResearchSynthesis(result.synthesis)
      setEvidence(`Research synthesis saved to outcome memory from ${result.sourceCount} research node(s).`)
    } catch (error) {
      setEvidence(error instanceof Error ? error.message : 'Research synthesis failed.')
    } finally {
      setSynthesizing(false)
    }
  }
  const forgeArtifact = async () => {
    if (!missionId) return
    setGenerating(true)
    try { const result = await generateArtifact({ missionId, mission, artifactType: 'web-app', artifactName }); setEvidence(`Artifact created: ${result.artifactId}. It must pass verification before human approval.`) }
    catch (error) { setEvidence(error instanceof Error ? error.message : 'Artifact generation failed.') }
    finally { setGenerating(false) }
  }
  return <main className="min-h-screen nexus-shell">
    <header className="topbar"><div className="brand-lockup"><div className="brand-mark">N</div><div><div className="brand-name">NEXUS FORGE</div><div className="brand-sub">MANIFESTED INTELLIGENCE OS</div></div></div><div className="top-actions"><span className="live-pill"><span className="pulse-dot" /> CORE ONLINE</span><button className="ghost-button" onClick={() => setGithubNote('Free mode: GitHub Actions handles build/test; no paid Macaly GitHub integration is required.')}>Free resources</button><button className="profile-button">NF</button></div></header>
    <section className="hero-grid"><div className="hero-copy"><div className="eyebrow"><span /> INTENT → OUTCOME ENGINE</div><h1>Manifest<br/><em>intention</em> into reality.</h1><p className="hero-text">A governed AI council that researches, reasons, creates, builds, measures and improves—while you retain ownership and control.</p><div className="hero-actions"><button className="primary-button" onClick={() => document.getElementById('mission')?.scrollIntoView({ behavior: 'smooth' })}>Start a mission <span>↗</span></button><button className="secondary-button" onClick={() => document.getElementById('council')?.scrollIntoView({ behavior: 'smooth' })}>View the council <span>◌</span></button></div><div className="proof-row"><span>● HUMAN CONTROL</span><span>◉ VERIFIED ARTIFACTS</span><span>◇ OUTCOME MEMORY</span></div></div><div className="orbital-card"><div className="orbit orbit-one"><span>INTENT</span></div><div className="orbit orbit-two"><span>REASON</span></div><div className="orbit orbit-three"><span>CREATE</span></div><div className="core-orb"><strong>NEXUS</strong><small>FORGE CORE</small><i /></div><div className="orbit-label label-top">GENERATE</div><div className="orbit-label label-right">VERIFY</div><div className="orbit-label label-bottom">LEARN</div><div className="orbit-label label-left">ACT</div></div></section>
    <section className="stats-strip"><div><strong>{completion}%</strong><span>Agent completion</span></div><div><strong>06</strong><span>Agents in council</span></div><div><strong>{researchRows?.length ?? 0}</strong><span>Research nodes</span></div><div><strong>{artifactRows?.length ?? 0}</strong><span>Artifacts</span></div><div><strong>∞</strong><span>Learning potential</span></div></section>
    <section id="mission" className="workspace"><div className="workspace-head"><div><div className="section-kicker">CONTROL PLANE / 001</div><h2>Mission Console</h2></div><div className="status-chip"><span className="pulse-dot" /> {running ? 'ORCHESTRATING' : approved ? 'APPROVED — EXECUTION GATED' : 'READY TO MANIFEST'}</div></div><div className="console-grid"><div className="mission-card glass-card"><div className="card-top"><span className="number-badge">01</span><span>OUTCOME CONTRACT</span><span className="verified">● VERIFIED SCHEMA</span></div><label htmlFor="mission-text">MISSION</label><textarea id="mission-text" value={mission} onChange={event => setMission(event.target.value)} disabled={!!missionId} /><div className="field-grid"><div><label>SUCCESS METRIC</label><div className="fake-input">Production-ready artifact <span>⌄</span></div></div><div><label>AUTHORITY</label><select value={autonomy} onChange={event => setAutonomy(event.target.value)} disabled={!!missionId}><option>Draft only</option><option>Approval required</option><option>Narrow auto-execution</option></select></div></div><div className="budget-row"><div><label>SPEND CAP</label><strong>${budget}</strong></div><input type="range" min="10" max="500" value={budget} onChange={event => setBudget(Number(event.target.value))} disabled={!!missionId}/></div><div className="contract-footer"><span>Evidence: tests · live URL · analytics · human review</span><div className="hero-actions"><button className="primary-button small" onClick={() => void launchMission()} disabled={!!missionId || running}>{running && !missionId ? 'Creating…' : 'Forge this mission ↗'}</button>{missionId && <button className="secondary-button small" onClick={() => void runCouncilPlanning()} disabled={!approved || running}>{running ? 'Planning…' : 'Run approved council pass'}</button>}</div></div></div><div className="side-card glass-card"><div className="card-top"><span className="number-badge">02</span><span>GUARDRAILS</span></div><Guard label="Human approval gates" text="Required for high-impact actions"/><Guard label="Scoped capabilities" text="Agents cannot expand permissions"/><Guard label="Kill switch" text="Stop a project or connector instantly"/><div className="approval-box"><span>AUTHORITY LEVEL</span><strong>{autonomy}</strong>{missionId ? <button onClick={() => void approveCurrentMission()} className={approved ? 'approved-button' : 'secondary-button'} disabled={approved}>{approved ? '✓ Mission approved' : 'Review & approve mission'}</button> : <button className="secondary-button" disabled>Forge a mission first</button>}</div></div></div></section>
    <section id="council" className="workspace dark-section"><div className="workspace-head"><div><div className="section-kicker">INTELLIGENCE LAYER / 002</div><h2>Council Workspace</h2></div><span className="status-chip">{running ? '● LIVE' : '● STANDBY'}</span></div><div className="council-layout"><div className="agent-list">{visibleAgents.map(agent => <article className="agent-card" key={agent.name}><div className="agent-icon">{agent.icon}</div><div className="agent-main"><div className="agent-title"><strong>{agent.name}</strong><span className={`state ${agent.state.toLowerCase()}`}>{agent.state}</span></div><small>{agent.role}</small><div className="progress"><span style={{ width: `${agent.progress}%` }}/></div><p>{agent.note}</p></div></article>)}</div><div className="evidence-panel"><div className="panel-title"><span>LIVE EVIDENCE STREAM</span><span className="live-pill">● LIVE</span></div><div className="evidence-item"><span className="time">NOW</span><div><b>Orchestrator</b><p>{evidence}</p></div><span className="score">0.90</span></div><div className="decision-line"><span>ORCHESTRATOR DECISION</span><strong>{running ? 'Generating governed plan' : approved ? 'Plan may proceed to explicit execution' : 'Awaiting human approval'}</strong></div></div></div></section>
    <section className="workspace"><div className="workspace-head"><div><div className="section-kicker">RESEARCH + MEMORY / 003</div><h2>Evidence Intelligence</h2></div><span className="muted">Research is server-side, cited, persisted and reusable.</span></div><div className="console-grid"><div className="glass-card research-card"><label>RESEARCH QUERY</label><input value={researchQuery} onChange={event => setResearchQuery(event.target.value)} /><div className="hero-actions"><button className="primary-button small" disabled={!missionId || researching} onClick={() => void runResearch()}>{researching ? 'Researching…' : 'Research current web ↗'}</button><button className="secondary-button small" disabled={!missionId || !researchRows?.length || synthesizing} onClick={() => void synthesizeResearchDossier()}>{synthesizing ? 'Synthesizing…' : 'Synthesize dossier ↗'}</button></div>{researchSynthesis && <div className="evidence-item"><span className="time">SYNTHESIS</span><div><b>Decision-ready research synthesis</b><p className="whitespace-pre-wrap">{researchSynthesis}</p></div><span className="score">SAVED</span></div>}{researchRows?.slice(0, 3).map(row => <div className="evidence-item" key={row._id}><span className="time">WEB</span><div><b>{row.query}</b><p>{row.result.slice(0, 220)}</p></div><span className="score">{row.citations.length} src</span></div>)}</div><div className="glass-card research-card"><label>OUTCOME MEMORY</label><p>Mission outcomes are saved as concise, scoped memories instead of raw transcripts.</p><div className="guard-item"><span>◎</span><div><strong>Latest orchestration</strong><small>{missionId ? 'Persisted to Forge core' : 'Run a mission to create memory'}</small></div><b className="on">ON</b></div><div className="guard-item"><span>◎</span><div><strong>GitHub / build / deploy</strong><small>{githubNote}</small></div><b className="on">FREE</b></div></div></div></section>
    <section className="workspace artifact-section"><div className="workspace-head"><div><div className="section-kicker">MANIFESTATION GRAPH / 004</div><h2>Artifact Forge</h2></div><span className="muted">Generation creates a real stored artifact; verification and human approval remain separate gates.</span></div><div className="glass-card research-card"><div className="field-grid"><div><label>ARTIFACT NAME</label><input value={artifactName} onChange={event => setArtifactName(event.target.value)} /></div><div><label>AUTHORITY</label><div className="fake-input">Human approval required</div></div></div><button className="primary-button small" disabled={!missionId || generating} onClick={() => void forgeArtifact()}>{generating ? 'Forging…' : 'Generate artifact ↗'}</button>{artifactRows?.map(row => <article className="artifact-card glass-card" key={row._id}><div className="artifact-id">AI</div><div className="artifact-content"><span className={row.status === 'ready' || row.status === 'verified' ? 'verified' : 'warning'}>{row.status === 'awaiting_approval' ? 'AWAITING VERIFICATION' : row.status.toUpperCase()}</span><h3>{row.name}</h3><p>{row.content.slice(0, 320)}</p>{row.status === 'awaiting_approval' ? <div className="hero-actions"><button className="secondary-button" onClick={async () => { const result = await verifyArtifact({ id: row._id }); setEvidence(`Artifact verification: ${Math.round(result.score * 100)}% — ${result.passed ? 'passed; approval is now available.' : 'failed; revise or regenerate the artifact.'}`) }}>Verify artifact</button><button className="secondary-button" disabled={row.status !== 'verified'} onClick={async () => { await approveArtifact({ id: row._id, approved: true }); setEvidence(`Artifact approved: ${row.name}. It can now enter delivery preparation.`) }}>Approve artifact</button><button className="ghost-button" onClick={async () => { await approveArtifact({ id: row._id, approved: false }); setEvidence(`Artifact rejected: ${row.name}.`) }}>Reject</button></div> : row.status === 'verified' ? <div className="hero-actions"><span className="status-chip">Verified — ready for human approval</span><button className="secondary-button" onClick={async () => { await approveArtifact({ id: row._id, approved: true }); setEvidence(`Artifact approved: ${row.name}. It can now enter delivery preparation.`) }}>Approve artifact</button></div> : <span className="text-button">Artifact cleared for governed delivery.</span>}</div></article>)}</div><div className="graph-card glass-card"><div className="graph-copy"><div className="section-kicker">CLOSED LOOP</div><h3>Idea → Manifested Outcome</h3><p>Intent connects to plans, research, artifacts, evidence, decisions and memory—not a chat transcript.</p></div><div className="graph-flow"><span>INTENT</span><i>→</i><span>RESEARCH</span><i>→</i><span>REASON</span><i>→</i><span>CREATE</span><i>→</i><span>VERIFY</span><i>→</i><span>APPROVE</span><i>→</i><span>DELIVER</span><i>→</i><span>MEASURE</span><i>↻</i></div></div></section>
    <section className="workspace delivery-section"><div className="workspace-head"><div><div className="section-kicker">DELIVERY CONTROL / 005</div><h2>GitHub → Build → Test</h2></div><span className="muted">$0 GitHub Actions route · artifact commit + workflow dispatch.</span></div><div className="console-grid"><div className="glass-card research-card"><div className="field-grid"><div><label>GITHUB TARGET</label><input value={targetRepo} onChange={event => setTargetRepo(event.target.value)} /></div><div><label>BRANCH</label><input value={targetBranch} onChange={event => setTargetBranch(event.target.value)} /></div></div><p>Only verified and human-approved artifacts can enter external delivery.</p><button className="primary-button small" disabled={!missionId || !artifactRows?.some(a => a.status === 'ready') || deliveryBusy} onClick={async () => { const ready = artifactRows?.find(a => a.status === 'ready'); if (!missionId || !ready) return; setDeliveryBusy(true); try { await prepareDelivery({ missionId, artifactId: ready._id, target: targetRepo, branch: targetBranch }); setGithubNote('Delivery request prepared. Waiting for explicit delivery approval.') } catch (error) { setEvidence(error instanceof Error ? error.message : 'Delivery preparation failed.') } finally { setDeliveryBusy(false) } }}>{deliveryBusy ? 'Preparing…' : 'Prepare governed delivery ↗'}</button></div><div className="glass-card research-card"><div className="panel-title"><span>DELIVERY PIPELINE</span><span className="live-pill">● GATED</span></div>{deliveryRows?.slice(0, 3).map(row => <div className="delivery-row" key={row._id}><div><strong>{row.target}</strong><small>{row.branch} · {row.status}</small><p>{row.evidence}</p></div>{row.stage === 'approval' ? <button className="secondary-button" onClick={async () => { try { await approveDelivery({ id: row._id, approved: true }); setGithubNote('Delivery approved. External GitHub execution is now a separate explicit action.') } catch (error) { setEvidence(error instanceof Error ? error.message : 'Delivery approval failed.') } }}>Approve delivery</button> : row.stage === 'github' ? <div className="hero-actions"><button className="secondary-button" onClick={async () => { setDeliveryBusy(true); try { const result = await executeDelivery({ id: row._id }); setGithubNote(`GitHub Actions dispatched. Artifact committed to ${result.artifactPath}.`); setEvidence(`External delivery started: ${result.workflowUrl}`) } catch (error) { setEvidence(error instanceof Error ? error.message : 'GitHub delivery failed to start.') } finally { setDeliveryBusy(false) } }} disabled={deliveryBusy}>{deliveryBusy ? 'Dispatching…' : 'Execute GitHub delivery ↗'}</button><a className="ghost-button" href="https://github.com/eugenemcmillian3-tech/nexus-forge-/actions" target="_blank" rel="noreferrer">Open Actions</a></div> : row.stage === 'test' ? <span className="status-chip">Build + test evidence received. Production deployment integration remains separate.</span> : <span className="status-chip">{row.stage}</span>}</div>)}</div></div></section>
    <PortfolioIntelligence ownerKey="local-workspace" onSelect={id => { const next = id as Id<'missions'>; setMissionId(next); setApproved(false); document.getElementById('mission')?.scrollIntoView({ behavior: 'smooth' }); setEvidence(`Mission ${id} selected from portfolio history. Review its approval state before execution.`) }} />
    <MissionControl missionId={missionId} />
    <section className="pricing-section"><div className="section-kicker">OUTCOME ECONOMY</div><h2>Start free. Pay when the work creates value.</h2><p>Use the core mission workspace without a subscription. Upgrade only for heavier execution.</p><div className="pricing-grid"><div><strong>FREE</strong><span>$0</span><small>Mission drafts · basic council · exportable blueprints</small></div><div className="featured-price"><strong>FORGE RUN</strong><span>$9+</span><small>Verified build, tests, artifacts and outcome evidence</small></div><div><strong>AUTONOMOUS SPRINT</strong><span>$49+</span><small>Time-boxed multi-agent execution with spend cap</small></div></div></section><footer><div className="brand-name">NEXUS FORGE</div><span>Manifested Intelligence · Human governed · Evidence first</span><span>Built to evolve, not to pretend.</span></footer>
  </main>
}
function Guard({ label, text }: { label: string; text: string }) { return <div className="guard-item"><span>◎</span><div><strong>{label}</strong><small>{text}</small></div><b className="on">ON</b></div> }
