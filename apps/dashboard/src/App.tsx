import { AnimatePresence, motion } from 'motion/react';
import {
  Activity, ArrowUpRight, Check, ChevronRight, CircleAlert, DatabaseZap,
  ExternalLink, FileSearch, GitPullRequest, Layers3, LockKeyhole,
  RefreshCw, ShieldCheck, TerminalSquare, X
} from 'lucide-react';
import { useEffect, useState } from 'react';
type EventRecord = { sequence: number; type: string; at: string; payload: Record<string, unknown> };
type Diagnosis = { testName: string; state: string; visibleSummary: string | null; nextAction: string | null };
type RepairAttempt = {
  attempt: number; state: string; reasonCode: string | null; patchSha256: string | null;
  targetedExitCodes: number[] | null; fullSuiteExitCode: number | null; visibleSummary: string;
};
type LiveIncident = {
  incidentId: string; state: string; repository: string; workflow: string; sourceSha: string;
  diagnoses: Diagnosis[];
  repair: { state: string; branchName: string | null; pullRequest: { number: number; url: string } | null; attempts: RepairAttempt[] } | null;
  events: EventRecord[];
};
type View = 'home' | 'console' | 'runbook' | 'security';
type StageState = 'complete' | 'active' | 'waiting' | 'blocked';
type Stage = { id: string; title: string; eventTypes: string[]; eyebrow: string; description: string; boundary: string };

const stages: Stage[] = [
  { id: 'capture', title: 'Capture', eventTypes: ['workflow.failure.detected'], eyebrow: 'SIGNED INTAKE', description: 'A failed workflow enters only after its GitHub signature and repository scope are accepted.', boundary: 'Untrusted or duplicate deliveries do not create a second repair.' },
  { id: 'evidence', title: 'Seal evidence', eventTypes: ['evidence.ingested', 'failure.clustered'], eyebrow: 'EVIDENCE VAULT', description: 'Safe evidence metadata is persisted before diagnosis work is published.', boundary: 'The console never receives raw logs or secret-like content.' },
  { id: 'diagnosis', title: 'Diagnose', eventTypes: ['diagnosis.proposed'], eyebrow: 'CAUSAL MAP', description: 'Codex returns a structured, evidence-linked diagnosis rather than a free-form chat answer.', boundary: 'A diagnosis cannot mark an incident repaired.' },
  { id: 'validate', title: 'Patch and validate', eventTypes: ['repair.attempt.recorded'], eyebrow: 'SEALED SANDBOX', description: 'A proposed diff must survive path policy, focused tests, and the complete suite in a network-sealed Docker workspace.', boundary: 'Repeated patches, protected paths, and budget overrun stop the loop.' },
  { id: 'deliver', title: 'Broker delivery', eventTypes: ['pull_request.opened'], eyebrow: 'IDEMPOTENT DELIVERY', description: 'Only validated file content crosses into the GitHub write broker.', boundary: 'The sandbox never holds a GitHub write credential.' }
];

const terminalStates = new Set(['NEEDS_REVIEW', 'VALIDATION_FAILED', 'BUDGET_EXHAUSTED']);

function safeView(value: string): View {
  return ['home', 'console', 'runbook', 'security'].includes(value) ? value as View : 'home';
}

function useGlassInteractions() {
  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-glass-tilt]') : null;
      if (!target) return;
      const bounds = target.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
      const y = Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height));
      target.style.setProperty('--mouse-x', `${x * 100}%`);
      target.style.setProperty('--mouse-y', `${y * 100}%`);
      target.style.setProperty('--tilt-x', `${(0.5 - y) * 4}deg`);
      target.style.setProperty('--tilt-y', `${(x - 0.5) * 5}deg`);
    };
    const onLeave = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-glass-tilt]') : null;
      if (!target || target.contains(event.relatedTarget as Node | null)) return;
      target.style.removeProperty('--mouse-x');
      target.style.removeProperty('--mouse-y');
      target.style.removeProperty('--tilt-x');
      target.style.removeProperty('--tilt-y');
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerout', onLeave, { passive: true });
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerout', onLeave);
    };
  }, []);
}
export function App() {
  const [view, setView] = useState<View>(() => safeView(window.location.hash.replace('#', '')));
  const [incident, setIncident] = useState<LiveIncident | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inspectedStage, setInspectedStage] = useState<number | null>(null);
  const apiOrigin = (import.meta.env.VITE_API_ORIGIN ?? '').replace(/\/+$/, '');
  const apiPath = (path: string) => `${apiOrigin}${path}`;

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch(apiPath('/api/v1/dashboard/incidents/latest'), { headers: { accept: 'application/json' } });
      if (response.status === 404) {
        setIncident(null);
        setError(null);
        return;
      }
      if (!response.ok) throw new Error(`API returned ${response.status}`);
      setIncident(await response.json() as LiveIncident);
      setError(null);
    } catch {
      setError('The local CI Doctor API is not reachable. The interface is showing no synthetic run.');
      setIncident(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const timer = window.setInterval(() => { void load(); }, 2_500);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const stream = new EventSource(apiPath('/api/v1/dashboard/stream'));
    stream.onmessage = () => { void load(); };
    stream.addEventListener('incident.accepted', () => { void load(); });
    return () => stream.close();
  }, []);
  useEffect(() => {
    const onHashChange = () => setView(safeView(window.location.hash.replace('#', '')));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const go = (next: View) => {
    window.location.hash = next;
    setView(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <main className={`app-shell app-shell--${view}`}>
            <ScrollVideo />
<div className="cosmic-blob blob-cyan" aria-hidden="true" />
      <div className="cosmic-blob blob-violet" aria-hidden="true" />
      <div className="cosmic-blob blob-amber" aria-hidden="true" />
      <div className="noise-layer" aria-hidden="true" />
      <header className="site-nav">
        <button className="brand-button" onClick={() => go('home')} aria-label="CI Doctor home">
          <span className="brand-sigil"><ShieldCheck size={18} /></span>
          <span><b>CI DOCTOR</b><small>verified autonomy</small></span>
        </button>
        <nav aria-label="Primary navigation">
          {(['home', 'console', 'runbook', 'security'] as View[]).map((item) => (
            <button key={item} className={view === item ? 'nav-selected' : ''} onClick={() => go(item)}>{item}</button>
          ))}
        </nav>
        <button className="connection-chip" onClick={() => void load()} aria-label="Refresh CI Doctor connection">
          <span className={`status-dot ${incident ? 'online' : error ? 'offline' : 'pending'}`} />
          {loading ? 'SYNCING' : incident ? 'LIVE DATA' : error ? 'API OFFLINE' : 'NO INCIDENT'}
          <RefreshCw size={13} />
        </button>
      </header>

      {error && <section className="api-notice" role="status"><CircleAlert size={16}/><span>{error}</span><button onClick={() => void load()}>Retry connection</button></section>}

      <AnimatePresence mode="wait">
        {view === 'home' && <Landing key="home" incident={incident} loading={loading} onConsole={() => go('console')} onRunbook={() => go('runbook')} onInspect={setInspectedStage} />}
        {view === 'console' && <Console key="console" incident={incident} loading={loading} onInspect={setInspectedStage} onRefresh={() => void load()} />}
        {view === 'runbook' && <Runbook key="runbook" incident={incident} onInspect={setInspectedStage} onConsole={() => go('console')} />}
        {view === 'security' && <Security key="security" incident={incident} onInspect={setInspectedStage} onConsole={() => go('console')} />}
      </AnimatePresence>

      <AnimatePresence>
        {inspectedStage !== null && <StageSheet stageIndex={inspectedStage} incident={incident} onClose={() => setInspectedStage(null)} />}
      </AnimatePresence>
    </main>
  );
}

function ScrollVideo() {
  return <video className="accretion-video" autoPlay muted loop playsInline preload="auto" aria-hidden="true">
    <source src={`${import.meta.env.BASE_URL}assets/cosmic-transitions.mp4`} type="video/mp4" />
  </video>;
}
function Landing({ incident, loading, onConsole, onRunbook, onInspect }: { incident: LiveIncident | null; loading: boolean; onConsole: () => void; onRunbook: () => void; onInspect: (stage: number) => void }) {
  const stageIndex = currentStage(incident);
  const flightStage = Math.min(4, Math.max(1, stageIndex + 1));
  const eventCount = incident?.events.length ?? 0;
  const status = incident?.state ?? (loading ? 'CONNECTING' : 'AWAITING_EVENT');
  const flightLabels = ['HERO VIEW / SIGNAL LOCKED', 'GRAVITATIONAL WARP / LENSING PEAK', 'CINEMATIC FLY-THROUGH / EVENT HORIZON', 'AMBIENT MATRIX / EVIDENCE FIELD'];

  return (
    <motion.section className="home-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <section className="hero-journey">
        <div className="hero-sticky">
          <div className="cosmic-hud cosmic-hud-top"><span>STATE {String(flightStage).padStart(2, '0')} / {flightLabels[flightStage - 1]}</span><b>{humanize(status)}</b></div>
          <div className="cosmic-hud cosmic-hud-bottom"><span className="status-dot online" /><span>{incident ? `${incident.repository} / ${incident.workflow}` : 'Waiting for a signed GitHub failure'}</span><small>SCROLL DRIVEN</small></div>
          <ol className="chapter-rail" aria-label="Cinematic workflow chapters">
            {['Failure intake', 'Evidence seal', 'Sandbox proof', 'Broker delivery'].map((label, index) => <li key={label} className={index + 1 === flightStage ? 'chapter-active' : index + 1 < flightStage ? 'chapter-complete' : ''}><span>{String(index + 1).padStart(2, '0')}</span><b>{label}</b></li>)}
          </ol>
          <div className="hero-grid">
            <div className="hero-copy">
              <p className="eyebrow"><span /> CI DOCTOR / INCIDENT CONTROL PLANE</p>
              <h1>Give CI failures<br /><em>a path to proof.</em></h1>
              <p className="hero-lede">A real, event-driven repair system: signed failure in, evidence-bound diagnosis, sealed validation, reviewable pull request out.</p>
              <div className="hero-actions">
                <button className="button-primary" onClick={onConsole}>Enter live console <ArrowUpRight size={16}/></button>
                <button className="button-secondary" onClick={onRunbook}>Read the safety map</button>
              </div>
              <dl className="hero-metrics">
                <div><dt>Incident</dt><dd>{incident ? compact(incident.incidentId) : loading ? 'syncing' : 'none'}</dd></div>
                <div><dt>Recorded events</dt><dd>{eventCount}</dd></div>
                <div><dt>Write authority</dt><dd>broker only</dd></div>
              </dl>
            </div>

          </div>
<motion.article key={flightStage} className="flight-narrative" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .28 }}>
            <span>STATE {String(flightStage).padStart(2, '0')} / {flightLabels[flightStage - 1]}</span>
            {flightStage === 1 && <><h2>Signed failure.<br />A real case begins.</h2><p>GitHub sends a verified CI failure; CI Doctor records the event before any agent work starts.</p></>}
            {flightStage === 2 && <><h2>Evidence enters<br />the gravity well.</h2><p>Logs, diff context, and safe source evidence are sealed into an immutable diagnostic bundle.</p></>}
            {flightStage === 3 && <><h2>Proposal meets<br />a sealed sandbox.</h2><p>Codex can propose a constrained repair. Docker independently applies and validates it without network or GitHub credentials.</p></>}
            {flightStage === 4 && <><h2>Proof crosses<br />the authority boundary.</h2><p>Only recorded passing validation can reach the idempotent GitHub pull-request broker.</p></>}
          </motion.article>
          <div className="scroll-prompt"><span>SCROLL TO TRACE THE AUTHORITY BOUNDARIES</span><i /></div>
        </div>
        <div className="journey-spacer" aria-hidden="true">
          {[1, 2, 3, 4].map((step) => <div key={step} className={`flight-section flight-${step}`} />)}
        </div>
      </section>

      <section className="journey-section" data-glass-tilt>
        <div className="section-label"><span>01</span><p>THE SIGNAL BECOMES A CASE</p></div>
        <div className="journey-copy"><h2>Every transition<br />has a witness.</h2><p>CI Doctor never advances because an agent says it is done. It advances only when an append-only event or recorded command result says so.</p></div>
        <StageRail incident={incident} activeIndex={stageIndex} onInspect={onInspect} />
      </section>

      <section className="authority-slab" data-glass-tilt>
        <div><p className="eyebrow"><span /> CLEAR SEPARATION OF POWERS</p><h2>The model can propose.<br />It cannot publish.</h2></div>
        <div className="authority-path">
          <article data-glass-tilt><span>01</span><b>Codex</b><p>Structured diagnosis and constrained diff proposal.</p></article>
          <article data-glass-tilt><span>02</span><b>Docker</b><p>Network-sealed patch and test verification.</p></article>
          <article data-glass-tilt><span>03</span><b>GitHub broker</b><p>Idempotent PR creation from validated file content only.</p></article>
        </div>
      </section>
    </motion.section>
  );
}

function Console({ incident, loading, onInspect, onRefresh }: { incident: LiveIncident | null; loading: boolean; onInspect: (stage: number) => void; onRefresh: () => void }) {
  const [selectedDiagnosis, setSelectedDiagnosis] = useState(0);
  const stageIndex = currentStage(incident);
  const selected = incident?.diagnoses[Math.min(selectedDiagnosis, Math.max(0, (incident?.diagnoses.length ?? 1) - 1))];
  const attempts = incident?.repair?.attempts ?? [];

  if (!incident) {
    return <EmptyState title={loading ? 'Synchronizing the live event ledger' : 'No live incident is recorded'} copy={loading ? 'The console is waiting for the API response.' : 'Trigger a real failed workflow. This interface deliberately does not substitute a fabricated incident.'} onRefresh={onRefresh} />;
  }

  return (
    <motion.section className="console-page" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
      <header className="console-header">
        <div><p className="eyebrow"><span /> LIVE INCIDENT / {humanize(incident.state)}</p><h1>{incident.repository}</h1><p className="console-subline">{incident.workflow} <i /> {incident.incidentId}</p></div>
        <div className="console-actions">
          <button className="refresh-button" onClick={onRefresh}><RefreshCw size={15} /> Refresh data</button>
          {incident.repair?.pullRequest ? <button className="pr-button" onClick={() => window.open(incident.repair?.pullRequest?.url, '_blank', 'noopener,noreferrer')}><GitPullRequest size={16}/>Open PR #{incident.repair.pullRequest.number}<ExternalLink size={13}/></button> : <span className="locked-pr"><LockKeyhole size={14}/>PR locked until validation</span>}
        </div>
      </header>

      <section className="status-ribbon">
        <Metric label="Workflow state" value={humanize(incident.state)} tone={incident.state} />
        <Metric label="Evidence events" value={String(incident.events.length)} tone="positive" />
        <Metric label="Diagnoses" value={String(incident.diagnoses.length)} tone="neutral" />
        <Metric label="Repair attempts" value={String(attempts.length)} tone={incident.repair?.state ?? 'neutral'} />
      </section>

      <section className="console-layout">
        <div className="stage-column glass-frame">
          <div className="panel-heading"><div><p className="eyebrow">AUTONOMOUS RUN</p><h2>Inspect recorded stages</h2></div><Layers3 size={18}/></div>
          <StageRail incident={incident} activeIndex={stageIndex} onInspect={onInspect} compact />
        </div>
        <div className="diagnosis-panel glass-frame">
          <div className="panel-heading"><div><p className="eyebrow">EXPLAINABLE DIAGNOSIS</p><h2>Evidence, not a hidden chain of thought</h2></div><FileSearch size={18}/></div>
          {incident.diagnoses.length > 1 && <div className="diagnosis-tabs">{incident.diagnoses.map((diagnosis, index) => <button key={`${diagnosis.testName}-${index}`} onClick={() => setSelectedDiagnosis(index)} className={index === selectedDiagnosis ? 'tab-active' : ''}>{String(index + 1).padStart(2, '0')}</button>)}</div>}
          <article className="diagnosis-card">
            <span>{selected?.testName ?? 'Awaiting diagnosis record'}</span>
            <p>{selected?.visibleSummary ?? 'No safe diagnosis summary is available yet.'}</p>
            <footer><b>Next action</b><code>{selected?.nextAction ?? 'PENDING'}</code></footer>
          </article>
          <p className="guardrail-note"><LockKeyhole size={14}/>Only safe evidence summaries appear here. Raw CI logs and hidden model reasoning remain outside the UI.</p>
        </div>
      </section>

      <section className="validation-card glass-frame">
        <div className="validation-heading"><div><p className="eyebrow"><span /> SANDBOX VALIDATION LEDGER</p><h2>A patch has to earn its way to GitHub.</h2></div><TerminalSquare size={20}/></div>
        {attempts.length === 0 ? <p className="empty-copy">No repair attempt has been recorded. The policy and sandbox gates remain closed until one exists.</p> : <div className="attempt-grid">{attempts.map((attempt) => <article key={attempt.attempt} className={`attempt-card attempt-${attempt.state.toLowerCase()}`}><header><span>ATTEMPT {String(attempt.attempt).padStart(2, '0')}</span><b>{humanize(attempt.state)}</b></header><p>{attempt.visibleSummary}</p><dl><div><dt>Path policy</dt><dd>{attempt.reasonCode ? humanize(attempt.reasonCode) : 'accepted'}</dd></div><div><dt>Focused tests</dt><dd>{exitSummary(attempt.targetedExitCodes)}</dd></div><div><dt>Full suite</dt><dd>{exitValue(attempt.fullSuiteExitCode)}</dd></div></dl></article>)}</div>}
      </section>

      <EventLedger events={incident.events} />
    </motion.section>
  );
}

function Runbook({ incident, onInspect, onConsole }: { incident: LiveIncident | null; onInspect: (stage: number) => void; onConsole: () => void }) {
  return <motion.section className="runbook-page" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
    <div className="runbook-intro"><p className="eyebrow"><span /> THE JOB, NOT A CHAT</p><h1>A bounded repair loop with real consequences.</h1><p>Each stage is independently inspectable, has its own authority, and stops at a hard safety boundary.</p><button className="button-primary" onClick={onConsole}>Open current incident <ArrowUpRight size={16}/></button></div>
    <div className="runbook-map">{stages.map((stage, index) => <button key={stage.id} className="runbook-node" onClick={() => onInspect(index)}><span>{String(index + 1).padStart(2, '0')}</span><div><small>{stage.eyebrow}</small><b>{stage.title}</b><p>{stage.description}</p></div><ChevronRight size={18}/></button>)}</div>
    <section className="runbook-footnote glass-frame"><Activity size={18}/><p>{incident ? `The current incident has ${incident.events.length} persisted events. Select a stage to inspect only its safe, recorded evidence.` : 'No incident is being simulated. Once GitHub sends a signed failure, its persisted event trail will appear here.'}</p></section>
  </motion.section>;
}

function Security({ incident, onInspect, onConsole }: { incident: LiveIncident | null; onInspect: (stage: number) => void; onConsole: () => void }) {
  const facts = [
    ['Evidence boundary', 'Raw logs are redacted before persistence and encrypted as artifacts.'],
    ['Execution boundary', 'Untrusted checkout code runs only in a disposable Docker sandbox with no network.'],
    ['Write boundary', 'GitHub credentials live in an idempotent broker, never in the sandbox or model context.'],
    ['Autonomy boundary', 'Protected paths, repeated patches, time budgets, and non-zero test exits stop the loop.']
  ];
  return <motion.section className="security-page" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
    <div className="security-orb" aria-hidden="true"><span /><i /><b /></div>
    <div className="security-copy"><p className="eyebrow"><span /> SECURITY IS THE PRODUCT</p><h1>Useful autonomy needs a small blast radius.</h1><p>CI Doctor is designed so a model can do consequential work without receiving unrestricted code execution or GitHub write authority.</p><div className="security-actions"><button className="button-primary" onClick={() => onInspect(3)}>Inspect sandbox gate</button><button className="button-secondary" onClick={onConsole}>Open live ledger</button></div></div>
    <div className="security-grid">{facts.map(([title, copy], index) => <article key={title} className="security-fact glass-frame"><span>{String(index + 1).padStart(2, '0')}</span><h2>{title}</h2><p>{copy}</p></article>)}</div>
  </motion.section>;
}

function StageRail({ incident, activeIndex, onInspect, compact = false }: { incident: LiveIncident | null; activeIndex: number; onInspect: (stage: number) => void; compact?: boolean }) {
  return <div className={`stage-rail ${compact ? 'stage-rail-compact' : ''}`}>{stages.map((stage, index) => {
    const state = stageState(incident, index, activeIndex);
    const events = eventsForStage(incident?.events ?? [], stage);
    return <button key={stage.id} className={`stage-node is-${state}`} data-glass-tilt onClick={() => onInspect(index)} aria-label={`Inspect ${stage.title}: ${state}`}>
      <span className="stage-marker">{state === 'complete' ? <Check size={13} /> : String(index + 1).padStart(2, '0')}</span>
      <span className="stage-text"><small>{state}</small><b>{stage.title}</b><i>{events.length ? `${events.length} recorded event${events.length === 1 ? '' : 's'}` : state === 'active' ? 'work in progress' : 'not recorded'}</i></span>
      <ChevronRight size={16}/>
    </button>;
  })}</div>;
}

function StageSheet({ stageIndex, incident, onClose }: { stageIndex: number; incident: LiveIncident | null; onClose: () => void }) {
  const stage = stages[stageIndex]!;
  const activeIndex = currentStage(incident);
  const state = stageState(incident, stageIndex, activeIndex);
  const events = eventsForStage(incident?.events ?? [], stage);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return <motion.div className="sheet-backdrop" role="presentation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
    <motion.article className="stage-sheet glass-frame" role="dialog" aria-modal="true" aria-labelledby="stage-sheet-title" initial={{ y: 26, scale: .985 }} animate={{ y: 0, scale: 1 }} exit={{ y: 20, scale: .985 }} onMouseDown={(event) => event.stopPropagation()}>
      <button className="sheet-close" onClick={onClose} aria-label="Close stage inspector"><X size={20}/></button>
      <p className="eyebrow"><span /> {stage.eyebrow}</p>
      <div className="sheet-state"><span className={`status-dot ${state === 'complete' ? 'online' : state === 'blocked' ? 'offline' : 'pending'}`} />{state}</div>
      <h2 id="stage-sheet-title">{stage.title}</h2>
      <p className="sheet-description">{stage.description}</p>
      <div className="hard-boundary"><LockKeyhole size={16}/><div><small>HARD BOUNDARY</small><b>{stage.boundary}</b></div></div>
      <section className="recorded-section"><header><span>RECORDED SAFE ARTIFACTS</span><b>{events.length}</b></header>{events.length ? <div className="sheet-events">{events.map((event) => <article key={event.sequence}><span>{String(event.sequence).padStart(3, '0')}</span><div><b>{event.type}</b><small>{new Date(event.at).toLocaleString()}</small><code>{JSON.stringify(event.payload)}</code></div></article>)}</div> : <p className="empty-copy">{incident ? 'This stage has no recorded event for the current incident yet.' : 'No live incident is currently available. This is a capability description, not a simulated artifact.'}</p>}</section>
    </motion.article>
  </motion.div>;
}

function EventLedger({ events }: { events: EventRecord[] }) {
  return <section className="event-ledger glass-frame"><div className="panel-heading"><div><p className="eyebrow">APPEND-ONLY EVENT LEDGER</p><h2>What the system actually recorded</h2></div><DatabaseZap size={18}/></div>{events.length ? <div className="ledger-list">{events.map((event) => <article key={event.sequence}><span>{String(event.sequence).padStart(3, '0')}</span><b>{event.type}</b><time>{new Date(event.at).toLocaleTimeString()}</time><code>{JSON.stringify(event.payload)}</code></article>)}</div> : <p className="empty-copy">No safe events are available for this incident.</p>}</section>;
}

function EmptyState({ title, copy, onRefresh }: { title: string; copy: string; onRefresh: () => void }) {
  return <motion.section className="empty-state glass-frame" initial={{ opacity: 0 }} animate={{ opacity: 1 }}><Activity size={24}/><h1>{title}</h1><p>{copy}</p><button className="button-primary" onClick={onRefresh}><RefreshCw size={15}/>Refresh connection</button></motion.section>;
}

function Metric({ label, value, tone }: { label: string; value: string; tone: string }) {
  return <article className={`metric-card tone-${tone.toLowerCase()}`}><span>{label}</span><b>{value}</b></article>;
}

function eventsForStage(events: EventRecord[], stage: Stage) { return events.filter((event) => stage.eventTypes.includes(event.type)); }
function currentStage(incident: LiveIncident | null) {
  if (!incident) return -1;
  let highest = -1;
  stages.forEach((stage, index) => { if (eventsForStage(incident.events, stage).length) highest = index; });
  if (incident.state === 'PATCHING' && highest < 3) return 3;
  return highest;
}
function stageState(incident: LiveIncident | null, index: number, activeIndex: number): StageState {
  if (!incident) return 'waiting';
  if (eventsForStage(incident.events, stages[index]!).length) return 'complete';
  if (terminalStates.has(incident.state) && index >= Math.max(0, activeIndex)) return 'blocked';
  return index === activeIndex ? 'active' : 'waiting';
}
function humanize(value: string) { return value.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function compact(value: string) { return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value; }
function exitSummary(value: number[] | null) { return value ? value.every((code) => code === 0) ? `${value.length}/${value.length} passed` : value.join(', ') : 'not recorded'; }
function exitValue(value: number | null) { return value === null ? 'not recorded' : value === 0 ? 'passed' : `exit ${value}`; }