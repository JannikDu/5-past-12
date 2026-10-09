import { useEffect, useState } from 'react';
import { parseAssessment, type AssessmentCitation, type AssessmentLevel, type AssessmentRead, type ClimateAssessment } from '../domain/climate-assessment.ts';
import { DataKind, type ClimateEvent } from '../domain/climate-event.ts';
import { getDemoAssessment, type DemoClimateAssessment } from '../data/demo-assessments.ts';
import { eventFingerprint } from '../services/assessment-context.ts';

const meanings: Record<'humanInfluence' | 'evidenceStrength', Record<AssessmentLevel, string>> = {
  humanInfluence: {
    none: 'No anthropogenic contribution can be established from the available evidence. This does not mean influence is physically absent.',
    low: 'A possible anthropogenic contribution with weak support for this event.',
    medium: 'A plausible anthropogenic contribution supported by relevant research, without strong event-specific quantification.',
    high: 'Strong, explicit event-specific evidence supports anthropogenic influence.',
  },
  evidenceStrength: {
    none: 'No suitable attribution evidence was established in the available knowledge base.',
    low: 'General mechanisms, regional research, or weakly comparable events provide limited indirect support.',
    medium: 'Relevant indirect evidence or event-specific research with significant limitations.',
    high: 'Strong event-specific attribution research with sufficiently supported findings.',
  },
};
const relationship = { direct_attribution: 'Event-specific attribution', event_context: 'Observed event context', analogue_attribution: 'Comparable event attribution', general_context: 'Regional research or physical mechanism' };
const claimLabel = { direct_finding: 'Reported scientific finding', supported_synthesis: 'Supported synthesis', general_mechanism: 'General mechanism' };

function AssessmentLevels({ humanInfluence, evidenceStrength }: Pick<ClimateAssessment, 'humanInfluence' | 'evidenceStrength'>) {
  const levels = { humanInfluence, evidenceStrength };
  return <>
    <div className="ca-levels">
      {(['humanInfluence', 'evidenceStrength'] as const).map(key => <div className={`ca-level ca-level-${key}`} key={key}>
        <h3>{key === 'humanInfluence' ? 'Human Influence' : 'Evidence Strength'}</h3>
        <strong className={`ca-level-value ca-level-${levels[key]}`}>{levels[key]}</strong>
        <p>{meanings[key][levels[key]]}</p>
      </div>)}
    </div>
    <p className="ed-footnote">These levels are not quantified probabilities. Evidence strength describes scientific support and applicability.</p>
  </>;
}

function DemoAssessmentContents({ assessment }: { assessment: DemoClimateAssessment }) {
  return <>
    <p className="ca-notice" role="status">Simulated climate connection. All explanations and evidence scenarios below are fictional examples, not validated scientific findings.</p>
    <AssessmentLevels humanInfluence={assessment.humanInfluence} evidenceStrength={assessment.evidenceStrength} />
    <p className="ca-summary">{assessment.summary}</p>
    <h3>Immediate cause · simulated</h3><p>{assessment.immediateCause}</p>
    <h3>Climate Connection · simulated</h3><p>{assessment.climateConnection ?? 'No climate connection is assigned in this fictional scenario. Missing evidence does not establish that influence is physically absent.'}</p>
    <div className="ca-scientific-evidence">
      <h3>Evidence scenario · simulated</h3>
      <span className="ca-relation">{assessment.evidenceType === 'direct' ? 'Direct attribution example' : assessment.evidenceType === 'indirect' ? 'Indirect connection example' : 'Missing evidence example'}</span>
      <p>{assessment.evidenceScenario}</p>
      <p className="ed-footnote">No real study, source passage, or citation is attached to this demo.</p>
    </div>
    <h3>Uncertainties &amp; Limitations</h3>
    <ul className="ca-limitations">{assessment.uncertainties.map(uncertainty => <li key={uncertainty}>{uncertainty}</li>)}</ul>
    <p className="ed-footnote">Fictional demo assessment · Prepared locally for the prototype.</p>
  </>;
}

type Finding = { statement: string; citation: AssessmentCitation };
export function evidenceGroups(assessment: ClimateAssessment, direct: boolean) {
  const groups = new Map<string, { source: AssessmentCitation; findings: Finding[] }>();
  const directPublications = new Set(assessment.claims.flatMap(c => c.citations.filter(s => s.relation === 'direct_attribution').map(s => s.sourceId)));
  for (const claim of assessment.claims) for (const citation of claim.citations) {
    // A publication appears once. Contextual findings in an event-specific study
    // retain their individual relationship labels within its source entry.
    if (directPublications.has(citation.sourceId) !== direct) continue;
    const group = groups.get(citation.sourceId) ?? { source: citation, findings: [] };
    if (!group.findings.some(f => f.statement === claim.statement && f.citation.passage === citation.passage && f.citation.relation === citation.relation))
      group.findings.push({ statement: claim.statement, citation });
    groups.set(citation.sourceId, group);
  }
  return [...groups.values()];
}
function SourceEvidence({ assessment, direct }: { assessment: ClimateAssessment; direct: boolean }) {
  const groups = evidenceGroups(assessment, direct);
  return <div className="ca-evidence-group">
    <h4 className="ca-evidence-heading">{direct ? 'Direct Evidence' : 'Indirect Evidence'}</h4>
    {!groups.length && <p className="ed-empty">{direct
      ? 'No direct event-specific attribution evidence was found in the available knowledge base.'
      : 'No applicable indirect scientific evidence was established.'}</p>}
    {!direct && !!groups.length && <p className="ed-footnote">These findings explain possible connections; they do not establish attribution for this specific event.</p>}
    {groups.map(({ source, findings }) => <article className="ca-source" id={`evidence-${source.sourceId}`} key={source.sourceId}>
      <h5>{source.sourceTitle}</h5>
      <p className="ca-source-meta">{source.publisher}{source.publishedAt && <> · <time dateTime={source.publishedAt}>{new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(source.publishedAt))}</time></>}</p>
      {findings.map(({ statement, citation }) => <div className="ca-source-finding" key={JSON.stringify([citation.chunkId, statement, citation.passage, citation.relation])}>
        <span className="ca-relation">{relationship[citation.relation]}</span>
        {direct && citation.relation !== 'direct_attribution' && <p className="ed-footnote">This contextual finding is indirect support within a study that also investigates this event.</p>}
        <p>{statement}</p><blockquote>{citation.passage}</blockquote>
      </div>)}
      <a className="ca-source-link" href={source.sourceUrl} target="_blank" rel="noopener noreferrer">View source <span aria-hidden="true">↗</span><span className="ed-sr-only"> (opens in a new tab)</span></a>
    </article>)}
  </div>;
}
export function AssessmentContents({ assessment, stale, generationFailed = false }: { assessment: ClimateAssessment; stale: boolean; generationFailed?: boolean }) {
  return <>
    {generationFailed && <p className="ca-notice" role="status">The most recent reassessment failed. This is the last validated saved assessment.</p>}
    {stale && <p className="ca-notice" role="status">This saved assessment is outdated because the event, evidence corpus, or assessment policy changed. Reassessment is needed; passages below refer to the retained source versions.</p>}
    <AssessmentLevels humanInfluence={assessment.humanInfluence} evidenceStrength={assessment.evidenceStrength} />
    {assessment.status === 'insufficient_evidence' && <p className="ca-notice">Insufficient scientific evidence to assess this event. Missing evidence does not establish zero climate influence.</p>}
    <p className="ca-summary">{assessment.summary}</p>
    <h3>Immediate cause</h3><p>{assessment.immediateCause ?? 'The immediate cause has not been established by the retrieved scientific evidence.'}</p>
    <h3>Climate Connection</h3><p>{assessment.climateConnection ?? 'No event-specific climate connection was established from the available evidence.'}</p>
    {!!assessment.claims.length && <><h3>Scientific Findings</h3><ol className="ed-findings ca-findings">{assessment.claims.map(claim => <li key={`${claim.statement}-${claim.type}`}>
      <span className="ca-relation">{claimLabel[claim.type]}</span><p><strong>{claim.statement}</strong></p><p>{claim.explanation}</p>
      <ul className="ca-claim-links">{[...new Map(claim.citations.map(c => [c.sourceId, c])).values()].map(c => <li key={c.sourceId}>
        <a href={`#evidence-${c.sourceId}`}>{c.sourceTitle}</a>
      </li>)}</ul>
      {!!claim.limitations.length && <ul className="ca-limitations">{[...new Set(claim.limitations)].map(limit => <li key={limit}>{limit}</li>)}</ul>}
    </li>)}</ol></>}
    <div className="ca-scientific-evidence"><h3>Scientific Evidence</h3><SourceEvidence assessment={assessment} direct /><SourceEvidence assessment={assessment} direct={false} /></div>
    <h3>Uncertainties &amp; Limitations</h3><ul className="ca-limitations">{[...new Set(assessment.uncertainties)].map(uncertainty => <li key={uncertainty}>{uncertainty}</li>)}</ul>
    <p className="ed-footnote">AI-assisted assessment · <time dateTime={assessment.assessedAt}>{new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(assessment.assessedAt))}</time> · {assessment.model}. Follow the scientific sources to check the findings.</p>
  </>;
}
type PanelState = AssessmentRead | { kind: 'loading' | 'error' };
export function AssessmentState({ state }: { state: PanelState }) {
  if (state.kind === 'available') return <AssessmentContents assessment={state.assessment} stale={state.stale} generationFailed={state.generationFailed} />;
  const messages = {
    loading: 'Loading saved climate assessment…',
    unavailable: 'Assessment not yet available. Scientific assessment is pending; no influence or evidence level has been assigned.',
    invalid_citations: 'The saved assessment has missing or invalid citations and cannot be displayed. A new assessment is needed.',
    error: 'The climate assessment could not be loaded. No unverified scientific result is displayed.',
    generation_failed: 'Assessment generation failed. No validated assessment is available; no scientific result or attribution level has been invented.',
  };
  return <><div className="ca-levels">{['Human Influence', 'Evidence Strength'].map(label => <div className="ca-level" key={label}><h3>{label}</h3><strong className="ca-level-value ca-level-unavailable">Unavailable</strong></div>)}</div>
    <p className="ca-notice" role="status">{messages[state.kind]}</p>
    <div className="ca-scientific-evidence"><h3>Direct Evidence</h3><p className="ed-empty">Event-specific attribution has not been verified for display.</p><h3>Indirect Evidence</h3><p className="ed-empty">Scientific passages will appear when a validated assessment is available.</p></div></>;
}
export default function ClimateAssessmentPanel({ event, apiUrl }: { event: ClimateEvent; apiUrl: string }) {
  const isDemo = event.provenance.dataKind === DataKind.Demo;
  const demoAssessment = getDemoAssessment(event);
  const [state, setState] = useState<PanelState>({ kind: 'loading' }); const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load(): Promise<PanelState> {
      if (event.provenance.dataKind === DataKind.Demo) return { kind: 'unavailable' };
      const base = new URL(apiUrl || '/', window.location.origin);
      if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('Invalid assessment endpoint');
      const url = new URL('/api/climate-assessments', base);
      url.searchParams.set('eventId', event.id); url.searchParams.set('eventFingerprint', await eventFingerprint(event));
      const response = await fetch(url, { signal: controller.signal, credentials: 'same-origin' }); if (!response.ok) throw new Error('Assessment unavailable');
      const value: unknown = await response.json();
      if (!value || typeof value !== 'object' || !('kind' in value)) throw new Error('Invalid response');
      if (value.kind === 'unavailable' || value.kind === 'invalid_citations' || value.kind === 'generation_failed') return { kind: value.kind };
      if (value.kind !== 'available' || !('assessment' in value) || !('stale' in value) || typeof value.stale !== 'boolean') throw new Error('Invalid assessment');
      const assessment = parseAssessment(value.assessment); if (assessment.eventId !== event.id) throw new Error('Mismatched event');
      const generationFailed = 'generationFailed' in value && value.generationFailed === true;
      return { kind: 'available', assessment, stale: value.stale, generationFailed };
    }
    load().then(result => { if (!controller.signal.aborted) setState(result); }).catch(() => { if (!controller.signal.aborted) setState({ kind: 'error' }); });
    return () => controller.abort();
  }, [event, apiUrl, attempt]);
  return <section className="ed-section ca-assessment" aria-labelledby="assessment-title" aria-busy={!isDemo && state.kind === 'loading'}>
    <div className="ed-section-heading"><span aria-hidden="true">02</span><h2 id="assessment-title">{isDemo ? 'Simulated Climate Assessment' : 'Climate Assessment'}</h2></div>
    <div className="ca-content">{demoAssessment ? <DemoAssessmentContents assessment={demoAssessment} /> : <AssessmentState state={isDemo ? { kind: 'unavailable' } : state} />}
      {!isDemo && state.kind === 'error' && <button type="button" className="ed-retry" onClick={() => setAttempt(a => a + 1)}>Retry loading assessment</button>}
    </div>
  </section>;
}
