import type { ClimateAssessment } from '../domain/climate-assessment.ts';
import { DataKind, type ClimateEvent } from '../domain/climate-event.ts';

/** Display-only scenarios, deliberately separate from validated scientific assessments. */
export interface DemoClimateAssessment extends Pick<ClimateAssessment,
  'eventId' | 'summary' | 'immediateCause' | 'climateConnection' | 'humanInfluence' | 'evidenceStrength' | 'uncertainties'> {
  evidenceType: 'direct' | 'indirect' | 'none';
  evidenceScenario: string;
}

export const demoAssessments: readonly DemoClimateAssessment[] = [
  {
    eventId: 'demo:california', humanInfluence: 'medium', evidenceStrength: 'medium',
    summary: 'A fictional wildfire scenario with a plausible human contribution to fire weather.',
    immediateCause: 'An assumed ignition coincides with dry vegetation and strong winds.',
    climateConnection: 'In this scenario, a warmer and drier background increases fuel dryness, making the fire easier to spread.',
    evidenceType: 'indirect',
    evidenceScenario: 'Simulated regional research and local fuel observations support an indirect connection, without attributing this particular fire.',
    uncertainties: ['Ignition and land management also affect the outcome.', 'No event-specific contribution is quantified in this scenario.'],
  },
  {
    eventId: 'demo:atlantic', humanInfluence: 'low', evidenceStrength: 'medium',
    summary: 'A fictional storm scenario with relevant research but limited support for human influence on this storm.',
    immediateCause: 'An assumed tropical disturbance develops over warm ocean water.',
    climateConnection: 'The scenario explores additional moisture from a warmer ocean as a possible contribution to rainfall; the storm track remains unexplained.',
    evidenceType: 'indirect',
    evidenceScenario: 'Simulated ocean observations and comparable-storm research provide context, but only weak support for a contribution to this event.',
    uncertainties: ['Ocean conditions alone do not explain storm formation or track.', 'The strength of the evidence differs from the inferred human contribution.'],
  },
  {
    eventId: 'demo:brazil', humanInfluence: 'medium', evidenceStrength: 'medium',
    summary: 'A fictional flood scenario with an indirect connection between background warming and heavy rainfall.',
    immediateCause: 'Assumed persistent rainfall saturates the catchment and causes rivers to overflow.',
    climateConnection: 'In this scenario, increased atmospheric moisture contributes to intense rainfall, while local exposure determines flood impacts.',
    evidenceType: 'indirect',
    evidenceScenario: 'Simulated regional rainfall research and catchment observations support a qualified connection rather than direct event attribution.',
    uncertainties: ['Drainage, soil saturation and land use influence flooding.', 'The share of rainfall attributable to warming is unspecified.'],
  },
  {
    eventId: 'demo:europe', humanInfluence: 'high', evidenceStrength: 'high',
    summary: 'A fictional heatwave scenario illustrating strong event-specific attribution.',
    immediateCause: 'An assumed persistent high-pressure system traps hot air over the region.',
    climateConnection: 'A simulated attribution comparison finds that human-caused warming strongly increases the heatwave intensity.',
    evidenceType: 'direct',
    evidenceScenario: 'A fictional same-event attribution study compares the heatwave in a warmed climate with a world without human-caused warming.',
    uncertainties: ['This attribution study is invented for the demo and has no real publication.', 'A strong contribution does not mean warming is the only cause.'],
  },
  {
    eventId: 'demo:east-africa', humanInfluence: 'low', evidenceStrength: 'low',
    summary: 'A fictional drought scenario illustrating a possible contribution with limited evidence.',
    immediateCause: 'Assumed successive rainfall deficits leave soils and water stores depleted.',
    climateConnection: 'In this scenario, additional evaporative demand may worsen water stress, but its contribution remains weakly supported.',
    evidenceType: 'indirect',
    evidenceScenario: 'Sparse simulated regional observations provide limited support; no direct drought attribution is included.',
    uncertainties: ['Natural rainfall variability and water use remain relevant.', 'Limited observations prevent a stronger conclusion.'],
  },
  {
    eventId: 'demo:south-asia', humanInfluence: 'none', evidenceStrength: 'none',
    summary: 'A fictional flood scenario showing how an assessment looks when no suitable evidence is available.',
    immediateCause: 'The scenario assumes heavy monsoon rainfall; contributing factors have not been assessed.',
    climateConnection: null,
    evidenceType: 'none',
    evidenceScenario: 'No applicable evidence is supplied in this scenario, so neither an influence nor an evidence level above none is assigned.',
    uncertainties: ['Missing evidence does not establish that climate influence is physically absent.', 'This example demonstrates an evidence gap rather than a negative attribution finding.'],
  },
  {
    eventId: 'demo:australia', humanInfluence: 'none', evidenceStrength: 'low',
    summary: 'A fictional wildfire scenario with general background research but no established event-specific influence.',
    immediateCause: 'An assumed ignition and windy conditions drive a vegetation fire.',
    climateConnection: 'The scenario includes a general warming-and-fuel-dryness mechanism, without evidence that it contributed to this fire.',
    evidenceType: 'indirect',
    evidenceScenario: 'Simulated general mechanism research illustrates why background knowledge alone cannot establish attribution for a particular event.',
    uncertainties: ['There are no event-specific fuel or climate observations in this scenario.', 'None means influence is not established, rather than physically absent.'],
  },
  {
    eventId: 'demo:greenland', humanInfluence: 'high', evidenceStrength: 'high',
    summary: 'A fictional ice-loss scenario illustrating strong evidence for a human contribution.',
    immediateCause: 'Assumed sustained warm air and ocean conditions accelerate ice loss.',
    climateConnection: 'A simulated event-specific analysis identifies a strong contribution from human-caused warming to the ice-loss episode.',
    evidenceType: 'direct',
    evidenceScenario: 'An invented attribution analysis combines fictional local observations with a comparison against a climate without human influence.',
    uncertainties: ['The observations and analysis are fictional and cannot support a real climate claim.', 'Short-term weather and ocean variability still contribute in the scenario.'],
  },
];

export function getDemoAssessment(event: ClimateEvent): DemoClimateAssessment | null {
  if (event.provenance.dataKind !== DataKind.Demo || event.provenance.provider !== 'demo') return null;
  return demoAssessments.find(assessment => assessment.eventId === event.id) ?? null;
}
