import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../utils/api';

// The shared frontend API client base URL already includes the backend /api/v1 prefix.
const API_ROOT = '/governance';
const ANALYSES = [
  ['structure', 'Structure'], ['dependency', 'Dependencies'], ['dead-code', 'Dead code'],
  ['security', 'Security'], ['quality', 'Quality'], ['qa', 'Repository Q&A'],
];
const TERMINAL = new Set(['COMPLETED', 'ESCALATED', 'FAILED']);
const unwrap = (response) => response?.data ?? response;
const dateLabel = (value) => value ? new Date(value).toLocaleString() : '—';

const panel = { background: '#07150b', border: '2px solid #1a4528', padding: 18, marginBottom: 16 };
const button = { background: '#15803d', color: '#fff', border: '2px solid #22c55e', padding: '9px 13px', cursor: 'pointer', fontFamily: 'inherit' };
const mutedButton = { ...button, background: '#0b2111', borderColor: '#245b35' };

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
    <main style={{ maxWidth: 1160, margin: '0 auto', padding: '28px 22px 60px', color: '#d7eadb', fontFamily: "'VT323', monospace", fontSize: 19 }}>
      <header style={{ marginBottom: 22 }}>
        <div style={{ color: '#4ade80', fontFamily: "'Press Start 2P', monospace", fontSize: 10, lineHeight: 1.8 }}>GOVERNANCE CONSOLE</div>
        <p style={{ color: '#8aaa91', margin: '8px 0 0' }}>Run policy-governed agents, review consensus, and inspect the audit trail for this repository.</p>
      </header>

      {error && <div role="alert" style={{ ...panel, borderColor: '#b45353', color: '#fecaca' }}>{error}</div>}
      {notice && <div role="status" style={{ ...panel, borderColor: '#22c55e', color: '#86efac' }}>{notice}</div>}

      <section style={panel}>
        <h2 style={{ color: '#4ade80', fontSize: 25, margin: '0 0 12px' }}>Start governed analysis</h2>
        <p style={{ color: '#8aaa91', marginTop: 0 }}>The repository must be READY. Every task runs through the backend policy enforcement and audit pipeline.</p>
        <form onSubmit={startJob}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))', gap: 8, margin: '16px 0' }}>
            {ANALYSES.map(([value, label]) => (
              <label key={value} style={{ border: '1px solid #245b35', padding: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={selectedSet.has(value)} onChange={() => toggleType(value)} /> {label}
              </label>
            ))}
          </div>
          {selectedSet.has('qa') && <label style={{ display: 'block', marginBottom: 14 }}>
            Question for the Q&amp;A agent
            <textarea value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={4000} required rows={3} placeholder="Ask about this repository" style={{ display: 'block', width: '100%', marginTop: 6, boxSizing: 'border-box', background: '#020c06', color: '#d7eadb', border: '1px solid #245b35', padding: 10, font: 'inherit' }} />
          </label>}
          <button type="submit" disabled={busy || selected.length === 0} style={{ ...button, opacity: busy || selected.length === 0 ? 0.55 : 1 }}>{busy ? 'PLEASE WAIT…' : 'START ANALYSIS'}</button>
          {jobId && <button type="button" onClick={() => setJobId('')} style={{ ...mutedButton, marginLeft: 10 }}>CLEAR JOB</button>}
        </form>
      </section>

      {jobId && <>
        <section style={panel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <h2 style={{ color: '#4ade80', fontSize: 25, margin: 0 }}>Job status: {job?.status || 'Loading…'}</h2>
            <button type="button" disabled={busy} onClick={() => refresh(jobId).catch((err) => setError(err.message))} style={mutedButton}>REFRESH</button>
          </div>
          <div style={{ color: '#8aaa91', marginTop: 8 }}>Job <code>{jobId}</code>{job?.createdAt && ` · Started ${dateLabel(job.createdAt)}`}</div>
          {job?.error && <p role="alert" style={{ color: '#fca5a5' }}>{job.error}</p>}
          {job?.ragIndexingStatus && <p>RAG indexing: <strong>{job.ragIndexingStatus}</strong>{job.ragIndexingError && ` — ${job.ragIndexingError}`}</p>}
          {job?.tasks?.length > 0 && <div style={{ overflowX: 'auto', marginTop: 12 }}><table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead><tr>{['Analysis', 'Agent', 'Status', 'Error'].map((title) => <th key={title} style={{ borderBottom: '1px solid #245b35', padding: 8 }}>{title}</th>)}</tr></thead>
            <tbody>{job.tasks.map((task) => <tr key={task._id}><td style={{ padding: 8 }}>{task.type}</td><td style={{ padding: 8 }}>{task.assignedAgent}</td><td style={{ padding: 8 }}>{task.status}</td><td style={{ padding: 8, color: '#fca5a5' }}>{task.error || '—'}</td></tr>)}</tbody>
          </table></div>}
        </section>

        <section style={panel}>
          <h2 style={{ color: '#4ade80', fontSize: 25, margin: '0 0 12px' }}>Consensus and human review</h2>
          {decisions.length === 0 && <p style={{ color: '#8aaa91' }}>Consensus decisions appear here when the agents finish.</p>}
          {decisions.map((decision) => <article key={decision._id} style={{ borderTop: '1px solid #245b35', padding: '12px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}><strong>{decision.category || 'Job summary'} · {decision.target || 'Repository'}</strong><span>{decision.status} · Score {Number(decision.score || 0).toFixed(2)} · Agreement {Number(decision.agreement || 0).toFixed(2)}</span></div>
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
          <h2 style={{ color: '#4ade80', fontSize: 25, margin: '0 0 12px' }}>Findings ({findings.length})</h2>
          {findings.map((finding) => <article key={finding._id} style={{ borderTop: '1px solid #245b35', padding: '10px 0' }}>
            <strong>{finding.category || 'Finding'} · {finding.severity || 'info'} · {finding.target}</strong>
            <div>{finding.claim}</div>
            <div style={{ color: '#8aaa91', fontSize: 16 }}>Agent: {finding.agentId} · Review: {finding.reviewStatus || 'pending'}{finding.evidence?.length ? ` · Evidence: ${finding.evidence.map((item) => `${item.kind}: ${item.ref}`).join(', ')}` : ''}</div>
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
        <h2 style={{ color: '#4ade80', fontSize: 25, margin: '0 0 12px' }}>Agent registry ({agents.length})</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 8 }}>
          {agents.map((agent) => <div key={agent.agentId} style={{ background: '#020c06', padding: 10 }}><strong>{agent.agentId}</strong><div>{agent.role} · trust {agent.trustWeight}</div><div style={{ color: '#8aaa91' }}>{(agent.capabilities || []).join(', ')}</div></div>)}
        </div>
      </section>

      <section style={panel}>
        <h2 style={{ color: '#4ade80', fontSize: 25, margin: '0 0 12px' }}>Active policies ({policies.length})</h2>
        <p style={{ color: '#8aaa91', marginTop: 0 }}>Policy edits create a new version and require an ID in the backend Clerk administrator allowlist.</p>
        {policies.map((policy) => {
          const draft = policyDrafts[policy.policyId] || policy;
          return <article key={policy.policyId} style={{ borderTop: '1px solid #245b35', padding: '10px 0' }}>
            <strong>{policy.policyId} · v{policy.version} · {policy.effect}</strong>
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
