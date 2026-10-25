'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { ArrowRight, BookOpen, Check, ChevronRight, FileText, Fingerprint, LockKeyhole, Mail, Pause, Play, RotateCcw, ShieldCheck, SkipForward, X } from 'lucide-react';
import type { Decision } from './ui-types';
import type { ProvenanceField } from '../lib/kernel';
import './pipeline-stage.css';

const DURATION = 12;
const BEATS = [0, 2.8, 5.6, 8.8, 12];
const STEPS = ['Read the request', 'Resolve the source', 'Enforce the boundary', 'Record the outcome'];
const showValue = (value: unknown) => typeof value === 'string' ? value || '(empty)' : typeof value === 'number' ? value.toLocaleString('en-US') : JSON.stringify(value) ?? '(empty)';
const humanField = (field: string) => field.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');

function Field({ field, compact = false }: { field: ProvenanceField; compact?: boolean }) {
  return <div className={`ps-field ${field.authoritative ? 'ps-field-trusted' : 'ps-field-tainted'} ${compact ? 'ps-field-compact' : ''}`}>
    <span>{field.authoritative ? <ShieldCheck size={13} /> : <Mail size={13} />}{humanField(field.field)}</span>
    <strong title={showValue(field.value)}>{showValue(field.value)}</strong>
    {!compact && <small>{field.label} · {field.source}</small>}
  </div>;
}

/** A replay of a stored decision. Playback never re-runs a payment. */
export default function PipelineStage({ decision: d, onSelectMessage }: { decision: Decision; onSelectMessage?: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(true);
  const [reduced, setReduced] = useState(false);
  const fields = d.provenance || [];
  const trusted = fields.filter(field => field.authoritative);
  const tainted = fields.filter(field => field.label.startsWith('tainted:'));
  const requested = tainted.find(field => /requestedReceiver|receiver|recipient/.test(field.field));
  const claim = tainted.find(field => /Claim/.test(field.field)) || tainted[0];
  const checks = d.checks || [];
  const failed = checks.filter(check => !check.passed);
  const allowed = d.verdict === 'allow';
  const demo = d.mode === 'demo' || d.arena;
  const uncertain = d.status === 'failed';
  const pending = d.status === 'pending';
  const withheld = !allowed || ['held', 'blocked', 'rejected'].includes(d.status);
  const phase = elapsed >= 8.8 ? 3 : elapsed >= 5.6 ? 2 : elapsed >= 2.8 ? 1 : 0;
  const finished = elapsed >= DURATION;
  const resultTitle = withheld ? 'Execution withheld.' : uncertain ? 'Execution unconfirmed.' : pending ? 'Confirmation pending.' : demo ? 'Simulation recorded.' : 'Provider result recorded.';
  const resultExplanation = withheld ? 'The kernel did not authorize execution. Review the failed checks below.' : uncertain ? 'The provider response is uncertain. Reconcile this reserved action before retrying.' : pending ? 'A reservation is recorded. This is not confirmed settlement.' : demo ? 'An allowed plan reached the demo rail. No real money moved.' : `Stored status: ${d.status}. Provider status: ${d.rail?.status || 'unavailable'}.`;
  const story = [
    'A request enters as information. Every extracted field keeps its source label.',
    trusted.length ? `${trusted.length} execution ${trusted.length === 1 ? 'field resolves' : 'fields resolve'} against trusted records. The inbox cannot replace them.` : 'No authoritative execution field resolved. The message cannot create one.',
    requested ? 'The message-supplied destination hits the boundary. Its words carry no authority.' : 'Source, value and policy are checked together. A source label alone cannot grant authority.',
    `${resultTitle} ${demo ? 'This replay is a demo simulation.' : 'The stored provider state is shown exactly as recorded.'}`,
  ];

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { setReduced(media.matches); if (media.matches) { setElapsed(DURATION); setPlaying(false); } };
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const minimize = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setElapsed(minimize ? DURATION : 0); setPlaying(!minimize);
  }, [d.id]);

  useEffect(() => {
    if (!playing || reduced || finished) return;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now(); const change = (now - previous) / 1000 * speed; previous = now;
      setElapsed(value => Math.min(DURATION, value + change));
    }, 60);
    return () => window.clearInterval(timer);
  }, [playing, speed, reduced, finished]);

  useEffect(()=>{if(!finished||!playing||!loop||reduced)return;const timer=window.setTimeout(()=>setElapsed(0),1400);return()=>window.clearTimeout(timer)},[finished,playing,loop,reduced]);
  const replay = () => { setElapsed(0); setPlaying(!reduced); };
  const next = () => { setPlaying(false); setElapsed(BEATS.find(beat => beat > elapsed + 0.1) ?? DURATION); };
  const jump = (step: number) => { setPlaying(false); setElapsed(BEATS[step]); };
  const stageStyle = { '--ps-time': `-${elapsed}s` } as CSSProperties;
  const packetValue = requested ? showValue(requested.value) : claim ? showValue(claim.value) : 'Untrusted message';

  return <section className={`pipeline-stage ${playing && !finished ? 'ps-playing' : ''} ps-phase-${phase} ${allowed ? 'ps-authorized' : 'ps-withheld'} ${reduced ? 'ps-reduced' : ''}`} aria-label="Animated provenance pipeline">
    <div className="ps-topline"><span><span className="ps-live-dot" />THE AUTHORITY BOUNDARY</span><span>{demo ? 'DEMO REPLAY · NO REAL MONEY' : 'STORED DECISION REPLAY'}</span></div>
    <div className="ps-intro"><div><h2>Watch the words.<br /><em>Follow the authority.</em></h2><p>A message can ask. A trusted record can authorize. Watch this decision cross the difference.</p></div><div className="ps-legend"><span><i className="ps-violet-dot" />Untrusted information</span><span><i className="ps-green-dot" />Verified authority</span><span><LockKeyhole size={13} />Deterministic gate</span></div></div>

    <div className="ps-scroll" tabIndex={0} aria-label="Visual route from the message to the trusted destination">
      <div className="ps-canvas" style={stageStyle}>
        <div className="ps-grid" aria-hidden="true" />
        <svg className="ps-wires" viewBox="0 0 1000 520" preserveAspectRatio="none" fill="none" aria-hidden="true">
          <path className="ps-wire ps-wire-violet" d="M145 180 H630" />
          <path className="ps-wire ps-wire-violet ps-wire-drop" d="M145 180 V330 H415" />
          <path className="ps-wire ps-wire-green" d="M420 330 H815" />
          <path className="ps-wire ps-wire-out" d="M815 330 V225" />
          <circle cx="145" cy="180" r="4" className="ps-junction ps-junction-violet" />
          <circle cx="420" cy="330" r="4" className="ps-junction ps-junction-green" />
          <circle cx="815" cy="330" r="4" className="ps-junction ps-junction-green" />
        </svg>
        <svg className="ps-wires-compact" viewBox="0 0 1000 740" preserveAspectRatio="none" fill="none" aria-hidden="true"><path className="ps-wire ps-wire-violet" d="M240 185 H530" /><path className="ps-wire ps-wire-violet ps-wire-drop" d="M240 185 V480" /><path className="ps-wire ps-wire-green" d="M240 480 H805 V360" /></svg>

        <div className="ps-column-label ps-label-read"><span>01</span>READ</div>
        <div className="ps-column-label ps-label-resolve"><span>02</span>RESOLVE</div>
        <div className="ps-column-label ps-label-execute"><span>04</span>RECORD</div>

        <article className="ps-node ps-request"><div className="ps-node-icon ps-icon-violet"><Mail size={19} /></div><span className="ps-node-kicker">INCOMING MESSAGE</span><h3>{d.subject || 'Untitled request'}</h3><p>{d.counterparty || 'Unresolved sender'}</p><span className="ps-source-badge ps-source-violet">△ Information only</span></article>
        <div className="ps-extract"><span className="ps-mini-label">QUARANTINED EXTRACTION</span>{tainted.slice(0, 2).map(field => <Field key={field.field} field={field} compact />)}{!tainted.length && <p>No extracted fields recorded.</p>}<span className="ps-extract-note">The extractor proposes. It never signs.</span></div>

        <article className="ps-node ps-record"><div className="ps-node-icon ps-icon-green"><BookOpen size={20} /></div><span className="ps-node-kicker">CANONICAL LOOKUP</span><h3>{trusted.length ? 'Resolved from the book.' : 'No trusted match.'}</h3><p>{trusted[0]?.source || 'A canonical execution source is required.'}</p>{trusted.length ? <><Field field={trusted[0]} compact />{trusted.length > 1 && <p>+ {trusted.length - 1} more verified {trusted.length === 2 ? 'field' : 'fields'} in the evidence below</p>}</> : <span className="ps-source-badge ps-source-violet">Unresolved · no authority</span>}</article>

        <div className="ps-membrane" aria-label="Deterministic custody kernel"><div className="ps-membrane-cap">03</div><div className="ps-membrane-inner"><ShieldCheck size={28} /><span>CUSTODY KERNEL</span><i /><span className="ps-membrane-rule">SOURCE<br />VALUE<br />POLICY</span><LockKeyhole size={21} /></div><div className="ps-membrane-cap ps-membrane-bottom">NO MODEL</div></div>
        <div className="ps-rejection" aria-hidden="true"><X size={15} /><span>{requested ? 'PAYEE OVERRIDE' : 'TEXT AUTHORITY'}<strong>DENIED</strong></span></div>

        <div className="ps-moving-packet ps-packet-tainted" aria-hidden="true"><Mail size={13} /><span>{packetValue}</span><X size={13} /></div>
        {trusted[0] && <div className="ps-moving-packet ps-packet-trusted" aria-hidden="true"><ShieldCheck size={13} /><span>{showValue(trusted[0].value)}</span>{allowed ? <ArrowRight size={13} /> : <LockKeyhole size={13} />}</div>}

        <article className={`ps-node ps-result ${withheld || uncertain || pending ? 'ps-result-held' : ''}`}><div className="ps-node-icon ps-icon-green">{withheld || uncertain || pending ? <Fingerprint size={23} /> : <ShieldCheck size={23} />}</div><span className="ps-node-kicker">ACTUAL RECORDED OUTCOME</span><h3>{resultTitle}</h3><div className="ps-result-status">{d.status.replaceAll('_', ' ').toUpperCase()}<span>{d.verdict.toUpperCase()}</span></div><p>{resultExplanation}</p><div className="ps-result-reference"><FileText size={13} /><span>{d.rail?.reference || 'No rail reference recorded'}</span></div></article>

        <div className="ps-underlay-note"><span>UNTRUSTED TEXT</span><i /><span>DETERMINISTIC AUTHORITY</span></div>
      </div>
    </div>

    <div className="ps-narration" aria-live="polite" aria-atomic="true"><span className="ps-narration-number">0{phase + 1}</span><p key={phase}>{story[phase]}</p><span className="ps-replay-only">Replay only · no actions triggered</span></div>
    <div className="ps-playback"><div className="ps-controls"><button onClick={replay} title="Replay decision" aria-label="Replay decision"><RotateCcw size={16} /></button><button className="ps-play-button" disabled={reduced} onClick={() => { if(playing)setPlaying(false);else if(finished)replay();else setPlaying(true); }} aria-label={playing && (!finished||loop) ? 'Pause replay' : 'Play replay'}>{playing && (!finished||loop) ? <Pause size={16} /> : <Play size={16} />}<span>{playing && (!finished||loop) ? 'Pause' : 'Play'}</span></button><button onClick={next} aria-label="Next stage" title="Next stage"><SkipForward size={16} /></button><label className="ps-speed"><span>Speed</span><select value={speed} onChange={event => setSpeed(Number(event.target.value))} aria-label="Replay speed"><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></select></label><label className="ps-loop"><input type="checkbox" checked={loop} disabled={reduced} onChange={event=>setLoop(event.target.checked)}/>Loop</label></div><div className="ps-timeline" aria-label="Replay stages">{STEPS.map((label, index) => <button key={label} onClick={() => jump(index)} className={phase === index ? 'ps-step-current' : phase > index ? 'ps-step-done' : ''} aria-current={phase === index ? 'step' : undefined}><span>{phase > index ? <Check size={12} /> : String(index + 1).padStart(2, '0')}</span><strong>{label}</strong></button>)}</div></div>
    {reduced && <p className="ps-motion-note">Reduced motion is on. All evidence is visible; use the four stage buttons to explore the trace.</p>}

    <div className="ps-evidence"><details><summary><span><ShieldCheck size={16} />The kernel’s evidence</span><span>{checks.length - failed.length} passed · {failed.length} failed<ChevronRight size={15} /></span></summary><div className="ps-check-list">{checks.length ? checks.map(check => <div className={check.passed ? 'ps-check-pass' : 'ps-check-fail'} key={check.id}>{check.passed ? <Check size={15} /> : <X size={15} />}<span><strong>{check.label}</strong><p>{check.message}</p></span><b>{check.passed ? 'PASS' : 'FAIL'}</b></div>) : <p>No checks were recorded for this decision.</p>}</div></details><details><summary><span><BookOpen size={16} />Every field, with its source</span><span>{fields.length} fields<ChevronRight size={15} /></span></summary><div className="ps-field-list">{fields.map(field => <Field key={field.field} field={field} />)}</div></details></div>
    {onSelectMessage && <div className="ps-footer"><span>Trace {d.id} · {d.kind.replaceAll('_', ' ')}</span><button onClick={onSelectMessage}>Open the original message<ArrowRight size={14} /></button></div>}
  </section>;
}
