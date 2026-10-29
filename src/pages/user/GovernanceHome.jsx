import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../utils/api';
import './governance-home.css';

const unwrap = (response) => response?.data ?? response;
const repoName = (repo) => repo.repo_name || String(repo.repo_url || 'Repository').replace(/\/+$/, '').split('/').slice(-2).join('/');

function ReadinessRing({ ready, total }) {
  const percent = total ? Math.round((ready / total) * 100) : 0;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  return <div className="governance-readiness-ring" aria-label={`${percent}% of repositories ready`}>
    <svg viewBox="0 0 110 110" role="img">
      <circle cx="55" cy="55" r={radius} fill="none" stroke="rgba(148,163,184,.15)" strokeWidth="8" />
      <circle cx="55" cy="55" r={radius} fill="none" stroke="#5ee6a8" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${circumference * percent / 100} ${circumference}`} transform="rotate(-90 55 55)" />
    </svg>
    <div><strong>{percent}%</strong><span>READY</span></div>
  </div>;
}

export default function GovernanceHome() {
  const [repos, setRepos] = useState([]);
  const [statuses, setStatuses] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const ownedRepos = unwrap(await api.get('/my-repos')) || [];
        const statusPairs = await Promise.all(ownedRepos.map(async (repo) => {
          try {
            const status = unwrap(await api.get(`/${encodeURIComponent(repo.repo_id)}/status`));
            return [String(repo.repo_id), status?.status || 'UNKNOWN'];
          } catch { return [String(repo.repo_id), 'UNKNOWN']; }
        }));
        if (active) {
          setRepos(ownedRepos);
          setStatuses(Object.fromEntries(statusPairs));
        }
      } catch (err) {
        if (active) setError(err.message || 'Could not load your repositories.');
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, []);

  const readyCount = useMemo(() => repos.filter((repo) => statuses[String(repo.repo_id)] === 'READY').length, [repos, statuses]);
  const filteredRepos = useMemo(() => repos.filter((repo) => repoName(repo).toLowerCase().includes(query.toLowerCase())), [repos, query]);

  return <main className="governance-home">
    <section className="governance-home-hero">
      <div className="governance-home-copy">
        <div className="governance-home-eyebrow"><span className="governance-live-dot" /> THE REPOLENS GOVERNANCE PLATFORM</div>
        <h1>AI decisions.<br /><span>Under control.</span></h1>
        <p>Coordinate specialist agents, enforce policy at every step, and bring every repository decision back to evidence.</p>
        <div className="governance-home-actions">
          <Link to="/analyze" className="governance-primary-link">+ Add a repository <span>↗</span></Link>
          <span className="governance-home-proof">Policy enforced <i /> Auditable <i /> Human reviewed</span>
        </div>
      </div>
      <div className="governance-home-visual" aria-hidden="true">
        <div className="governance-orbit orbit-one" /><div className="governance-orbit orbit-two" />
        <div className="governance-core"><div className="governance-core-mark">R</div><span>POLICY<br />ENFORCEMENT</span></div>
        <div className="governance-node node-top">PEP <b>ALLOW</b></div>
        <div className="governance-node node-right">AGENTS <b>07 ACTIVE</b></div>
        <div className="governance-node node-bottom">CONSENSUS <b>VERIFIABLE</b></div>
      </div>
    </section>

    <section className="governance-home-summary">
      <div><span>REPOSITORIES</span><strong>{loading ? '—' : repos.length}</strong><small>Your governed workspace</small></div>
      <div><span>READY TO ANALYZE</span><strong>{loading ? '—' : readyCount}</strong><small>Static analysis available</small></div>
      <div><span>GOVERNANCE</span><strong className="summary-active">ACTIVE</strong><small>Every new run uses policy controls</small></div>
      <div className="governance-ring-card"><ReadinessRing ready={readyCount} total={repos.length} /><div><b>Repository readiness</b><small>Ready repositories can start a governed run.</small></div></div>
    </section>

    <section className="governance-repository-section">
      <div className="governance-section-heading">
        <div><div className="governance-home-eyebrow">YOUR WORKSPACE</div><h2>Governed repositories</h2><p>Choose a repository to launch or review its agent workflow.</p></div>
        <label className="governance-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a repository" /></label>
      </div>
      {error && <div className="governance-home-error" role="alert">{error}</div>}
      {loading ? <div className="governance-empty-state">Loading your repositories…</div> : filteredRepos.length === 0 ? <div className="governance-empty-state"><b>{repos.length ? 'No repositories match that search.' : 'Your governance workspace is ready.'}</b><span>{repos.length ? 'Try another repository name.' : 'Add a repository to begin its first governed analysis.'}</span>{!repos.length && <Link to="/analyze" className="governance-primary-link">Analyze a repository <span>↗</span></Link>}</div> :
        <div className="governance-repository-grid">{filteredRepos.map((repo) => {
          const id = String(repo.repo_id);
          const status = statuses[id] || 'UNKNOWN';
          return <article className="governance-repo-card" key={id}>
            <div className="governance-repo-top"><div className="governance-repo-icon">⌘</div><span className={`governance-status status-${status.toLowerCase()}`}><i />{status.replaceAll('_', ' ')}</span></div>
            <h3>{repoName(repo)}</h3><p>{repo.repo_url || 'Repository analysis and policy review'}</p>
            <div className="governance-repo-meta"><span>{repo.architecture_score != null ? `Health ${Math.round(repo.architecture_score)}%` : 'Governed analysis'}</span><span>{repo.latest_version ? `Snapshot ${repo.latest_version}` : 'No snapshot yet'}</span></div>
            <Link className="governance-repo-link" to={`/${encodeURIComponent(id)}/governance`}>{status === 'READY' ? 'Open control center' : 'View repository'} <span>→</span></Link>
          </article>;
        })}</div>}
    </section>
  </main>;
}
