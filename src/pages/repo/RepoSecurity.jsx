import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../utils/api';
import './security.css';

const TYPES = [
  { label: 'Secrets', countKey: 'secrets', type: 'SECRET', icon: '◆' },
  { label: 'Dependency CVEs', countKey: 'dependencies', type: 'CVE', icon: '⚒' },
  { label: 'Malicious patterns', countKey: 'malicious', type: 'MALICIOUS_PATTERN', icon: '◈' },
  { label: 'Code practice', countKey: 'sast', type: 'BAD_PRACTICE', icon: '▤' },
  { label: 'License issues', countKey: 'licenses', type: 'LICENSE_ISSUE', icon: '§' },
];
const SEVERITIES = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const severityColor = { CRITICAL: '#ef665c', HIGH: '#f1a64a', MEDIUM: '#e5c85b', LOW: '#82c879' };
const typeIcon = { SECRET: '◆', CVE: '⚒', MALICIOUS_PATTERN: '◈', BAD_PRACTICE: '▤', LICENSE_ISSUE: '§' };

export default function RepoSecurity() {
  const { repoId } = useParams();
  const [findings, setFindings] = useState([]);
  const [summary, setSummary] = useState(null);
  const [filter, setFilter] = useState('ALL');
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => { fetchSecurityData(); }, [repoId]);

  const fetchSecurityData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [summaryRes, findingsRes] = await Promise.all([
        api.get(`/repos/${repoId}/security/summary`),
        api.get(`/repos/${repoId}/security/findings?limit=100`),
      ]);
      setSummary(summaryRes.data);
      setFindings(findingsRes.data.findings);
    } catch (err) {
      setError(err.message || 'Security scan could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  const filteredFindings = (findings || []).filter((finding) =>
    (filter === 'ALL' || finding.type === filter)
      && (severityFilter === 'ALL' || finding.severity === severityFilter));
  const byType = summary?.by_type || {};
  const issueTypeCount = Object.values(byType).reduce((total, value) => total + (Number(value) || 0), 0);
  const trustScore = Number(summary?.trust_score) || 0;
  const trustColor = trustScore < 30 ? severityColor.CRITICAL : trustScore < 60 ? severityColor.HIGH : trustScore < 80 ? severityColor.MEDIUM : severityColor.LOW;

  if (loading) return <main className="mc-security"><div className="security-loading"><span className="security-pickaxe">⚒</span><b>Checking the perimeter…</b><div className="security-xp"><i /></div><small>Gathering security findings</small></div></main>;

  return <main className="mc-security">
    <header className="security-hero">
      <div className="security-hero-copy">
        <div className="security-eyebrow"><span /> REPOSITORY WATCHTOWER · SECURITY QUEST</div>
        <h1>Security <em>analysis</em></h1>
        <p>Inspect the project’s weak points, sort findings by threat level, and see what needs attention first.</p>
      </div>
      <div className="security-hero-mark" aria-hidden="true"><span>⚔</span><small>SCOUT<br />REPORT</small></div>
      {summary && <div className="security-hero-score" style={{ '--score-color': trustColor }}><span>REPO DEFENSE</span><strong>{summary.trust_score ?? '—'}<small>/100</small></strong><div className="security-xp"><i style={{ width: `${Math.max(0, Math.min(trustScore, 100))}%` }} /></div><small>Security trust score</small></div>}
    </header>

    {error && <div className="security-error" role="alert"><span>⚠</span><div><b>Could not load the watchtower report</b><small>{error}</small></div><button type="button" onClick={fetchSecurityData}>Retry scan</button></div>}

    {summary && <section className="security-metrics" aria-label="Security summary">
      <article className="security-metric"><span className="metric-glyph">◆</span><small>CRITICAL THREATS</small><strong className="threat-critical">{summary.critical_vulnerabilities ?? 0}</strong><span>Immediate review</span></article>
      <article className="security-metric"><span className="metric-glyph">⚒</span><small>FINDINGS</small><strong>{summary.total_findings ?? findings.length}</strong><span>Across the repository</span></article>
      <article className="security-metric"><span className="metric-glyph">▦</span><small>ISSUE CLASSES</small><strong>{issueTypeCount}</strong><span>Signals grouped by type</span></article>
      <article className="security-metric defense-metric" style={{ '--score-color': trustColor }}><span className="metric-glyph">⬟</span><small>DEFENSE LEVEL</small><strong>{trustScore >= 80 ? 'FORTIFIED' : trustScore >= 60 ? 'GUARDED' : trustScore >= 30 ? 'EXPOSED' : 'AT RISK'}</strong><span>Based on the trust score</span></article>
    </section>}

    {summary && <section className="security-type-section">
      <div className="security-section-title"><div><span className="security-eyebrow">CHOOSE A TARGET</span><h2>Threat map</h2></div><span>Filter findings by issue class</span></div>
      <div className="security-type-grid">{TYPES.map((item) => <button type="button" key={item.type} className={`security-type-tile ${filter === item.type ? 'is-selected' : ''}`} onClick={() => setFilter(filter === item.type ? 'ALL' : item.type)} aria-pressed={filter === item.type}>
        <span className="type-glyph">{item.icon}</span><span className="type-name">{item.label}</span><b>{byType[item.countKey] || 0}</b><small>{filter === item.type ? 'TARGET SELECTED' : 'VIEW SIGNALS'} <i>→</i></small>
      </button>)}</div>
    </section>}

    <section className="security-findings-section">
      <div className="security-section-title findings-heading"><div><span className="security-eyebrow">FIELD NOTES</span><h2>Findings <span className="findings-count">{filteredFindings.length}</span></h2></div>
        <div className="security-severity-filters" aria-label="Filter by severity">{SEVERITIES.map((severity) => <button type="button" key={severity} className={severityFilter === severity ? 'is-active' : ''} onClick={() => setSeverityFilter(severity)}>{severity !== 'ALL' && <i style={{ background: severityColor[severity] }} />}{severity}</button>)}</div>
      </div>
      {filteredFindings.length === 0 ? <div className="security-empty"><span>✓</span><b>{findings.length ? 'No signals match these filters.' : 'The watchtower is clear.'}</b><small>{findings.length ? 'Choose another issue class or severity.' : 'No security findings were returned for this repository.'}</small></div> : <div className="security-finding-list">{filteredFindings.map((finding, index) => <article key={finding._id || `${finding.type}-${index}`} className="security-finding" style={{ '--finding-color': severityColor[finding.severity] || '#82c879' }}>
        <div className="finding-severity-block"><span>{typeIcon[finding.type] || '⌕'}</span><small>{finding.severity || 'INFO'}</small></div>
        <div className="finding-main"><div className="finding-kicker"><span>{(finding.type || 'Finding').replaceAll('_', ' ')}</span>{finding.file_path && <code>{finding.file_path}{finding.line_number ? `:${finding.line_number}` : ''}</code>}</div><h3>{finding.title || 'Untitled finding'}</h3><p>{finding.description || 'No additional description was provided.'}</p></div>
        <span className="finding-index">#{String(index + 1).padStart(2, '0')}</span>
      </article>)}</div>}
    </section>

    {summary?.top_findings?.length > 0 && <section className="security-quest-board"><div className="quest-board-heading"><span>⚒</span><div><small>PRIORITY QUESTS</small><h2>Best next moves</h2></div><b>{summary.top_findings.length} TASKS</b></div><div className="quest-list">{summary.top_findings.map((finding, index) => <div className="quest-row" key={`${finding.title}-${index}`}><span className="quest-number">{String(index + 1).padStart(2, '0')}</span><span>{finding.title}</span><b style={{ color: severityColor[finding.severity] || '#82c879' }}>{finding.severity}</b></div>)}</div></section>}
  </main>;
}
