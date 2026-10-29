import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../utils/api';
import './governance.css';

// The shared frontend API client base URL already includes the backend /api/v1 prefix.
const API_ROOT = '/governance';
const ANALYSES = [
  ['structure', 'Structure'], ['dependency', 'Dependencies'], ['dead-code', 'Dead code'],
  ['security', 'Security'], ['quality', 'Quality'], ['qa', 'Repository Q&A'],
];
const TERMINAL = new Set(['COMPLETED', 'ESCALATED', 'FAILED']);
const unwrap = (response) => response?.data ?? response;
const dateLabel = (value) => value ? new Date(value).toLocaleString() : '—';

const panel = { background: 'linear-gradient(145deg, rgba(16,34,27,.94), rgba(10,23,18,.97))', border: '1px solid rgba(131,170,151,.18)', borderRadius: 18, padding: 22, marginBottom: 16, boxShadow: '0 16px 42px rgba(0,0,0,.16)' };
const button = { background: 'linear-gradient(135deg,#78f0ba,#45cd91)', color: '#07150f', border: '1px solid #63e6a9', borderRadius: 9, padding: '10px 15px', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 750 };
const mutedButton = { ...button, color: '#d9eee2', background: 'rgba(20,43,33,.9)', borderColor: 'rgba(131,170,151,.25)' };

export default function RepoGovernance() {
  const { repoId } = useParams();
  const storageKey = `repolens-governance-job:${repoId}`;
  const [selected, setSelected] = useState(['structure', 'dependency', 'dead-code', 'security', 'quality']);
  const [question, setQuestion] = useState('');
  const [jobId, setJobId] = useState(() => window.localStorage.getItem(storageKey) || '');
  const [job, setJob] = useState(null);
  const [findings, setFindings] = useState([]);
  const [decisions, setDecisions] = useState([]);
  const [audit, setAudit] = useState([]);
  const [violations, setViolations] = useState([]);
  const [agents, setAgents] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [integrity, setIntegrity] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [policyDrafts, setPolicyDrafts] = useState({});
  const tasks = job?.tasks || [];
  const finishedTasks = tasks.filter((task) => ['COMPLETED', 'REUSED'].includes(task.status)).length;
  const progress = tasks.length ? Math.round((finishedTasks / tasks.length) * 100) : 0;
  const escalatedCount = decisions.filter((decision) => decision.status === 'ESCALATED').length;
  const highRiskCount = findings.filter((finding) => ['HIGH', 'CRITICAL'].includes(finding.severity)).length;
  const scoreMean = decisions.length ? decisions.reduce((sum, item) => sum + Number(item.score || 0), 0) / decisions.length : 0;
  const agreementMean = decisions.length ? decisions.reduce((sum, item) => sum + Number(item.agreement || 0), 0) / decisions.length : 0;

  const loadReferenceData = useCallback(async () => {
    const [agentResult, policyResult] = await Promise.allSettled([
      api.get(`${API_ROOT}/agents`), api.get(`${API_ROOT}/policies`),
    ]);
    if (agentResult.status === 'fulfilled') setAgents(unwrap(agentResult.value) || []);
    if (policyResult.status === 'fulfilled') setPolicies(unwrap(policyResult.value) || []);
  }, []);

  const refresh = useCallback(async (id) => {
    if (!id) return;
    const [jobResult, findingsResult, decisionResult, auditResult, violationResult] = await Promise.allSettled([
      api.get(`${API_ROOT}/jobs/${encodeURIComponent(id)}`),
      api.get(`${API_ROOT}/jobs/${encodeURIComponent(id)}/findings`),
      api.get(`${API_ROOT}/jobs/${encodeURIComponent(id)}/decision`),
      api.get(`${API_ROOT}/audit?jobId=${encodeURIComponent(id)}`),
      api.get(`${API_ROOT}/violations?jobId=${encodeURIComponent(id)}`),
    ]);
    if (jobResult.status === 'rejected') throw jobResult.reason;
    const nextJob = unwrap(jobResult.value);
    setJob(nextJob);
    if (findingsResult.status === 'fulfilled') setFindings(unwrap(findingsResult.value) || []);
    if (decisionResult.status === 'fulfilled') setDecisions(unwrap(decisionResult.value)?.decisions || []);
    if (auditResult.status === 'fulfilled') setAudit(unwrap(auditResult.value) || []);
    if (violationResult.status === 'fulfilled') setViolations(unwrap(violationResult.value) || []);
    return nextJob;
  }, []);

  useEffect(() => { loadReferenceData(); }, [loadReferenceData]);
  useEffect(() => {
    window.localStorage.setItem(storageKey, jobId);
    setJob(null);
    setFindings([]);
    setDecisions([]);
    setAudit([]);
    setViolations([]);
    setError('');
    if (!jobId) return undefined;
    let active = true;
    let timer;
    const poll = async () => {
      try {
        const next = await refresh(jobId);
        if (active && !TERMINAL.has(next?.status)) timer = window.setTimeout(poll, 3000);
      } catch (err) {
        if (!active) return;
        setError(err.message || 'Could not load governance job.');
      }
    };
    poll();
    return () => { active = false; window.clearTimeout(timer); };
  }, [jobId, refresh, storageKey]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const toggleType = (type) => setSelected((current) => current.includes(type)
    ? current.filter((item) => item !== type) : [...current, type]);

  const startJob = async (event) => {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const body = { repo_id: repoId, analysis_types: selected };
      if (selectedSet.has('qa')) body.question = question.trim();
      const response = await api.post(`${API_ROOT}/jobs`, body);
      const created = unwrap(response);
      setJobId(String(created?._id || created?.id || ''));
      setNotice('Governed analysis started. Progress will refresh automatically.');
    } catch (err) { setError(err.message || 'Could not start governance analysis.'); }
    finally { setBusy(false); }
  };

  const decide = async (decisionId, approved) => {
    setBusy(true); setError(''); setNotice('');
    try {
      await api.post(`${API_ROOT}/decisions/${encodeURIComponent(decisionId)}/approve`, { approved });
      setNotice(approved ? 'Escalated decision approved.' : 'Escalated decision rejected.');
      await refresh(jobId);
    } catch (err) { setError(err.message || 'Could not record the human decision.'); }
    finally { setBusy(false); }
  };

  const verifyAudit = async () => {
    setBusy(true); setError('');
    try { setIntegrity(unwrap(await api.get(`${API_ROOT}/audit/verify`))); }
    catch (err) { setError(err.message || 'Audit verification failed.'); }
    finally { setBusy(false); }
  };

  const savePolicy = async (policy) => {
    setBusy(true); setError(''); setNotice('');
    try {
      const draft = policyDrafts[policy.policyId] || policy;
      const { policyId, version, _id, createdAt, updatedAt, ...body } = draft;
      const saved = unwrap(await api.put(`${API_ROOT}/policies/${encodeURIComponent(policy.policyId)}`, body));
      setPolicies((items) => [...items.filter((item) => item.policyId !== policy.policyId), saved]);
      setPolicyDrafts((items) => { const next = { ...items }; delete next[policy.policyId]; return next; });
      setNotice(`${policy.policyId} saved as version ${saved.version}.`);
    } catch (err) { setError(err.message || 'Policy update failed. Policy changes require administrator access.'); }
    finally { setBusy(false); }
  };

  return (
    <main className="gov-control" style={{ maxWidth: 1420, margin: '0 auto', padding: '30px clamp(16px,3vw,42px) 60px', color: '#e7f3ec', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', fontSize: 14 }}>
      <header className="gov-hero">
        <div className="gov-hero-copy">
          <div className="gov-eyebrow"><span /> TRUST &amp; OPERATIONS / REPOSITORY</div>
          <h1>Governance <span>control center</span></h1>
          <p>Specialist agents analyze the code. Policy guards every action. Consensus makes each result traceable to evidence.</p>
          <div className="gov-hero-tags"><span>Policy enforced</span><span>Human escalation</span><span>Auditable decisions</span></div>
        </div>
        <div className="gov-hero-visual" aria-hidden="true"><div className="gov-visual-orbit" /><div className="gov-visual-ring" /><div className="gov-visual-center"><b>R</b><span>GOVERNED<br />ANALYSIS</span></div><div className="gov-visual-pill gov-pill-top">PEP <b>ACTIVE</b></div><div className="gov-visual-pill gov-pill-side">AGENTS <b>{agents.length || 7} ONLINE</b></div></div>
      </header>

      <section className="gov-kpis">
        <div><span>ACTIVE SPECIALISTS</span><strong>{agents.length || '—'}<small> agents</small></strong><i>Structure · Security · Quality · more</i></div>
        <div><span>ANALYSIS PROGRESS</span><strong>{job ? `${progress}%` : '—'}</strong><i>{job ? `${finishedTasks} of ${tasks.length} tasks finished` : 'Start a governed run below'}</i></div>
        <div><span>HIGH RISK FINDINGS</span><strong className={highRiskCount ? 'gov-alert-number' : ''}>{highRiskCount}</strong><i>Reviewed by the Critic before consensus</i></div>
        <div><span>NEEDS HUMAN REVIEW</span><strong className={escalatedCount ? 'gov-alert-number' : ''}>{escalatedCount}</strong><i>Escalated decisions awaiting action</i></div>
      </section>

      {error && <div role="alert" className="gov-message gov-error">{error}</div>}
      {notice && <div role="status" className="gov-message gov-notice">{notice}</div>}

      <section style={panel}>
        <div className="gov-section-head"><div><div className="gov-eyebrow">NEW ANALYSIS</div><h2>Put this repository under review</h2><p>Choose the specialists for this run. High-risk findings are Critic-reviewed before consensus.</p></div><span className="gov-readiness-note">READY REPOSITORY REQUIRED</span></div>
        <form onSubmit={startJob}>
          <div className="gov-agent-picker">
            {ANALYSES.map(([value, label]) => (
              <label key={value} className={`gov-agent-option${selectedSet.has(value) ? ' selected' : ''}`}>
                <input type="checkbox" checked={selectedSet.has(value)} onChange={() => toggleType(value)} /><span className="gov-check" />
                <span className="gov-agent-glyph">{value === 'security' ? '◈' : value === 'qa' ? '?' : value === 'structure' ? '⌘' : value === 'quality' ? '✳' : value === 'dependency' ? '⤳' : '⌁'}</span><span>{label}</span>
              </label>
            ))}
          </div>
          {selectedSet.has('qa') && <label style={{ display: 'block', marginBottom: 14 }}>
            Question for the Q&amp;A agent
            <textarea value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={4000} required rows={3} placeholder="Ask about this repository" style={{ display: 'block', width: '100%', marginTop: 6, boxSizing: 'border-box', background: '#020c06', color: '#d7eadb', border: '1px solid #245b35', padding: 10, font: 'inherit' }} />
          </label>}
          <div className="gov-form-footer"><span className="gov-pipeline-note"><i /> PEP → SPECIALISTS → CRITIC → CONSENSUS → AUDIT</span><button type="submit" disabled={busy || selected.length === 0} style={{ ...button, opacity: busy || selected.length === 0 ? 0.55 : 1 }}>{busy ? 'Starting…' : 'Start governed analysis'} <span>→</span></button></div>
          {jobId && <button type="button" onClick={() => setJobId('')} style={{ ...mutedButton, marginLeft: 10 }}>CLEAR JOB</button>}
        </form>
      </section>

      {jobId && <>
        <section style={panel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <h2 className="gov-section-title">Run activity <span className={`gov-job-badge ${job?.status === 'FAILED' ? 'failed' : ''}`}>{job?.status || 'Loading…'}</span></h2>
            <button type="button" disabled={busy} onClick={() => refresh(jobId).catch((err) => setError(err.message))} style={mutedButton}>REFRESH</button>
          </div>
          <div className="gov-job-meta">Run <code>{jobId}</code>{job?.createdAt && ` · Started ${dateLabel(job.createdAt)}`}</div>
          {job?.error && <p role="alert" style={{ color: '#fca5a5' }}>{job.error}</p>}
          {tasks.length > 0 && <div className="gov-progress-wrap"><div className="gov-progress-label"><span>Agent workflow</span><b>{progress}%</b></div><div className="gov-progress-track"><span style={{ width: `${progress}%` }} /></div></div>}
          {job?.ragIndexingStatus && <div className="gov-rag-state"><span>RAG KNOWLEDGE INDEX</span><strong className={`rag-${job.ragIndexingStatus.toLowerCase()}`}>{job.ragIndexingStatus}</strong>{job.ragIndexingError && <small>{job.ragIndexingError}</small>}</div>}
          {job?.tasks?.length > 0 && <div style={{ overflowX: 'auto', marginTop: 12 }}><table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead><tr>{['Analysis', 'Agent', 'Status', 'Error'].map((title) => <th key={title} style={{ borderBottom: '1px solid #245b35', padding: 8 }}>{title}</th>)}</tr></thead>
            <tbody>{job.tasks.map((task) => <tr key={task._id}><td style={{ padding: 8 }}>{task.type}</td><td style={{ padding: 8 }}>{task.assignedAgent}</td><td style={{ padding: 8 }}>{task.status}</td><td style={{ padding: 8, color: '#fca5a5' }}>{task.error || '—'}</td></tr>)}</tbody>
          </table></div>}
        </section>

        <section style={panel}>
          <div className="gov-section-head"><div><div className="gov-eyebrow">DECISION INTELLIGENCE</div><h2>Consensus and human review</h2><p>Weighted agent findings, agreement, dissent, and escalation in one place.</p></div></div>
          {decisions.length > 0 && <div className="gov-consensus-overview">
            <div className="gov-score-ring" style={{ '--score': `${Math.round(scoreMean * 100)}%` }}><div><b>{Math.round(scoreMean * 100)}</b><span>RISK</span></div></div>
            <div className="gov-consensus-bars"><div><span>Mean risk score</span><b>{scoreMean.toFixed(2)}</b><i><em style={{ width: `${scoreMean * 100}%` }} /></i></div><div><span>Agent agreement</span><b>{agreementMean.toFixed(2)}</b><i><em style={{ width: `${agreementMean * 100}%` }} /></i></div></div>
            <div className="gov-consensus-count"><strong>{decisions.length}</strong><span>decisions</span><small>{escalatedCount ? `${escalatedCount} need review` : 'No human action pending'}</small></div>
          </div>}
          {decisions.length === 0 && <p style={{ color: '#8aaa91' }}>Consensus decisions appear here when the agents finish.</p>}
          {decisions.map((decision) => <article key={decision._id} style={{ borderTop: '1px solid #245b35', padding: '12px 0' }}>
            <div className="gov-decision-card"><div className="gov-decision-title"><span className="gov-decision-category">{decision.category || 'Job summary'}</span><strong>{decision.target || 'Repository'}</strong><span className={`gov-decision-status decision-${decision.status?.toLowerCase()}`}>{decision.status}</span></div>
              <div className="gov-decision-metrics"><span>Risk <b>{Number(decision.score || 0).toFixed(2)}</b><i><em style={{ width: `${Math.max(0, Math.min(100, Number(decision.score || 0) * 100))}%` }} /></i></span><span>Agreement <b>{Number(decision.agreement || 0).toFixed(2)}</b><i><em style={{ width: `${Math.max(0, Math.min(100, Number(decision.agreement || 0) * 100))}%` }} /></i></span></div>
            </div>
            {decision.provenance && <div style={{ color: '#8aaa91', marginTop: 5 }}>Provenance: {JSON.stringify(decision.provenance)}</div>}
            {decision.status === 'ESCALATED' && <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button disabled={busy} onClick={() => decide(decision._id, true)} style={button}>APPROVE</button>
              <button disabled={busy} onClick={() => decide(decision._id, false)} style={{ ...button, background: '#7f1d1d', borderColor: '#ef4444' }}>REJECT</button>
            </div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 12, marginTop: 10 }}>
              {[['Supporting findings', decision.findings || []], ['Dissent', decision.dissent || []]].map(([title, items]) => <div key={title} style={{ background: '#020c06', padding: 10 }}><strong>{title} ({items.length})</strong>{items.map((finding) => <p key={finding._id} style={{ margin: '7px 0', color: '#a8c5ad' }}>{finding.title || finding.summary || finding.category}: {finding.description || finding.message || ''}</p>)}</div>)}
            </div>
          </article>)}
        </section>

        <section style={panel}>
          <div className="gov-section-head"><div><div className="gov-eyebrow">EVIDENCE REGISTER</div><h2>Agent findings <span className="gov-count-badge">{findings.length}</span></h2><p>Claims retain their source references and Critic review state.</p></div></div>
          {findings.map((finding) => <article className="gov-finding-card" key={finding._id}>
            <div className="gov-finding-top"><strong>{finding.category || 'Finding'} <span>· {finding.target}</span></strong><span className={`gov-severity severity-${finding.severity?.toLowerCase() || 'low'}`}>{finding.severity || 'LOW'}</span></div>
            <div>{finding.claim}</div>
            <div className="gov-finding-meta"><span>{finding.agentId}</span><span>Critic: {finding.reviewStatus || 'pending'}</span>{finding.evidence?.length > 0 && <span>{finding.evidence.length} evidence reference{finding.evidence.length === 1 ? '' : 's'}</span>}</div>
            {finding.evidence?.length > 0 && <div className="gov-evidence-list">{finding.evidence.map((item, index) => <code key={`${item.kind}-${item.ref}-${index}`}>{item.kind} · {item.ref}</code>)}</div>}
          </article>)}
          {findings.length === 0 && <p style={{ color: '#8aaa91' }}>No findings are available yet.</p>}
        </section>

        <section style={panel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <h2 style={{ color: '#4ade80', fontSize: 25, margin: 0 }}>Audit trail ({audit.length})</h2>
            <button type="button" disabled={busy} onClick={verifyAudit} style={mutedButton}>VERIFY HASH CHAIN</button>
          </div>
          {integrity && <p role="status" style={{ color: integrity.valid ? '#86efac' : '#fca5a5' }}>Chain {integrity.valid ? 'verified' : 'failed'}{integrity.checked !== undefined && ` · ${integrity.checked} records checked`}{integrity.error && ` · ${integrity.error}`}</p>}
          <div style={{ overflowX: 'auto', marginTop: 12 }}><table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead><tr>{['Seq', 'Time', 'Actor', 'Event', 'Action', 'Policies', 'Decision', 'Reason'].map((title) => <th key={title} style={{ borderBottom: '1px solid #245b35', padding: 8 }}>{title}</th>)}</tr></thead>
            <tbody>{audit.map((entry) => <tr key={entry._id}><td style={{ padding: 8 }}>{entry.seq}</td><td style={{ padding: 8 }}>{dateLabel(entry.ts)}</td><td style={{ padding: 8 }}>{entry.actor || '—'}</td><td style={{ padding: 8 }}>{entry.event || '—'}</td><td style={{ padding: 8 }}>{entry.action || '—'}</td><td style={{ padding: 8 }}>{(entry.policyIds || []).join(', ') || '—'}</td><td style={{ padding: 8 }}>{entry.decision}</td><td style={{ padding: 8 }}>{entry.reason || '—'}</td></tr>)}</tbody>
          </table></div>
          {violations.length > 0 && <p style={{ color: '#fca5a5' }}>{violations.length} denied, redacted, or escalated policy events are included in this audit.</p>}
        </section>
      </>}

      <section style={panel}>
        <div className="gov-section-head"><div><div className="gov-eyebrow">SPECIALIST NETWORK</div><h2>Agent roster <span className="gov-count-badge">{agents.length}</span></h2><p>Role-based analysis with explicit capabilities and trust weighting.</p></div></div>
        <div className="gov-agent-grid">
          {agents.map((agent) => <div className="gov-agent-card" key={agent.agentId}><div className="gov-agent-card-top"><span>{agent.agentId?.slice(0, 1).toUpperCase()}</span><i />ACTIVE</div><strong>{agent.agentId}</strong><div>{agent.role}</div><div className="gov-trust-meter"><span>Trust weight</span><b>{Number(agent.trustWeight || 1).toFixed(2)}</b><i><em style={{ width: `${Math.min(100, Number(agent.trustWeight || 1) / 1.5 * 100)}%` }} /></i></div><div className="gov-agent-capabilities">{(agent.capabilities || []).slice(0, 3).map((capability) => <span key={capability}>{capability.replaceAll('_', ' ')}</span>)}</div></div>)}
        </div>
      </section>

      <section style={panel}>
        <div className="gov-section-head"><div><div className="gov-eyebrow">POLICY-AS-CODE</div><h2>Enforcement library <span className="gov-count-badge">{policies.length}</span></h2><p>Versioned rules govern delegation, evidence, privacy, budgets, and review. Changes require an administrator.</p></div></div>
        {policies.map((policy) => {
          const draft = policyDrafts[policy.policyId] || policy;
          return <article className="gov-policy-row" key={policy.policyId}>
            <div className="gov-policy-meta"><strong>{policy.policyId}</strong><span>v{policy.version}</span><b className={`effect-${policy.effect?.toLowerCase()}`}>{policy.effect}</b></div>
            <div>{policy.description}</div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 6 }}>
              <input type="checkbox" checked={Boolean(draft.enabled)} onChange={(event) => setPolicyDrafts((items) => ({ ...items, [policy.policyId]: { ...draft, enabled: event.target.checked } }))} /> Enabled
            </label>
            {draft.enabled !== policy.enabled && <button type="button" disabled={busy} onClick={() => savePolicy(policy)} style={{ ...mutedButton, marginLeft: 12 }}>SAVE NEW VERSION</button>}
          </article>;
        })}
      </section>
    </main>
  );
}
