import { motion, AnimatePresence } from 'motion/react';
import { Check, ChevronRight, ExternalLink, FileCode2, GitPullRequest, LockKeyhole, ShieldCheck, TerminalSquare } from 'lucide-react';
import { lazy, Suspense, useEffect, useState } from 'react';
import { incidentProof } from './incident-proof';

const IncidentCore = lazy(() => import('./IncidentCore').then((module) => ({ default: module.IncidentCore })));

const stages = [
  ['Failure detected', '4 independent CI signatures clustered'],
  ['Evidence sealed', 'Logs redacted and encrypted at rest'],
  ['Diagnosis formed', 'Bounded hypotheses tied to evidence'],
  ['Repair validated', 'Focused tests + complete suite in Docker'],
  ['PR opened', 'GitHub Actions check passed']
] as const;

export function App() {
  const [stage, setStage] = useState(4);
  const [selectedFailure, setSelectedFailure] = useState(1);
  useEffect(() => {
    const timer = window.setInterval(() => setStage((current) => current === 4 ? 0 : current + 1), 4200);
    return () => window.clearInterval(timer);
  }, []);

  const failure = incidentProof.failures[selectedFailure]!;
  return (
    <main className="shell">
      <div className="ambient ambient-one" /><div className="ambient ambient-two" />
      <nav className="topbar">
        <div className="brand"><span className="brand-mark"><ShieldCheck size={17} /></span><span>CI DOCTOR</span><small>incident command</small></div>
        <div className="top-status"><span className="pulse" />LIVE PROOF <span className="separator" /> GitHub verified</div>
        <button className="repo-chip" onClick={() => window.open(incidentProof.pullRequest.url, '_blank', 'noopener,noreferrer')}>
          <GitPullRequest size={15} /> PR #{incidentProof.pullRequest.number}<ExternalLink size={13} />
        </button>
      </nav>

      <section className="hero-grid">
        <div className="hero-copy">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <p className="eyebrow"><span /> INCIDENT RESOLVED</p>
            <h1>CI failed.<br /><em>The doctor shipped</em><br />the cure.</h1>
            <p className="lede">An evidence-bound repair loop diagnosed four independent failures, validated every fix in a sealed sandbox, then opened a PR with a real green check.</p>
          </motion.div>
          <div className="hero-facts">
            <div><strong>{incidentProof.validation.focused}</strong><span>Focused tests</span></div>
            <div><strong>{incidentProof.validation.fullSuite}</strong><span>Full suite</span></div>
            <div><strong>0</strong><span>Secrets exposed</span></div>
          </div>
        </div>
        <div className="core-card glass"><div className="core-label"><span>REPAIR SIGNAL</span><b>HEALTHY</b></div><Suspense fallback={<div className="core-loading">Loading secure incident core…</div>}><IncidentCore /></Suspense><div className="core-footer"><span className="pulse" />GitHub Actions · passed <Check size={15} /></div></div>
      </section>

      <section className="command-grid">
        <div className="timeline-card glass">
          <div className="section-heading"><div><p className="eyebrow">AUTONOMOUS RUN</p><h2>From red to green</h2></div><span className="mono">{incidentProof.incidentId}</span></div>
          <div className="timeline">
            {stages.map(([title, description], index) => <button key={title} onClick={() => setStage(index)} className={`stage ${index === stage ? 'active' : ''} ${index < stage ? 'complete' : ''}`}>
              <span className="stage-dot">{index < stage ? <Check size={12} /> : String(index + 1).padStart(2, '0')}</span>
              <span><b>{title}</b><small>{description}</small></span><ChevronRight size={16} />
            </button>)}
          </div>
        </div>

        <div className="evidence-card glass">
          <div className="section-heading"><div><p className="eyebrow">EVIDENCE-BOUND PATCH</p><h2>Four root causes</h2></div><FileCode2 size={19} /></div>
          <div className="failure-tabs">{incidentProof.failures.map((item, index) => <button key={item.label} className={index === selectedFailure ? 'selected' : ''} onClick={() => setSelectedFailure(index)}>{String(index + 1).padStart(2, '0')}</button>)}</div>
          <AnimatePresence mode="wait"><motion.div key={failure.label} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.22 }} className="patch-preview">
            <div><span className="mono">{failure.label}</span><p>{failure.detail}</p></div>
            <pre><i>+</i>{failure.patch}</pre>
          </motion.div></AnimatePresence>
          <div className="guardrail"><LockKeyhole size={15} /><span>Only <b>src/**</b> and <b>test/**</b> could change. CI configuration was protected.</span></div>
        </div>
      </section>

      <section className="proof-strip glass">
        <div className="proof-title"><TerminalSquare size={18} /><span><b>Validation ledger</b><small>{incidentProof.validation.sandbox}</small></span></div>
        <div className="ledger-item"><span>Base</span><b className="mono">{incidentProof.sourceSha}</b></div>
        <div className="ledger-line" /><div className="ledger-item"><span>Repair</span><b className="mono success">{incidentProof.repairSha}</b></div>
        <div className="ledger-line" /><div className="ledger-item"><span>Result</span><b className="success">PR #{incidentProof.pullRequest.number} · CHECK PASSED</b></div>
      </section>
    </main>
  );
}
