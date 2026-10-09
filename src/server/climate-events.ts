import { SupabaseClimateEventCatalog } from '../data/repositories/climate-event-catalog.ts';
import { EonetProvider } from '../data/providers/eonet.ts';
import { ClimateEventJob } from '../services/climate-event-job.ts';
import { BudgetedAssessmentModel } from '../services/assessment-discovery.ts';
import { DefaultClimateAssessmentService } from '../services/climate-assessment.ts';
import { supabaseConfig } from './config.ts';
import { createAssessmentServices } from './assessment.ts';
import { EventRequestBudget } from '../services/event-request-budget.ts';
import { SupabaseStudyDiscoveryRepository } from '../data/repositories/study-discovery.ts';
export function createEventCatalog(env:Record<string,string|undefined>) {return new SupabaseClimateEventCatalog(supabaseConfig(env));}
export function createEventJob(env:Record<string,string|undefined>) {
  const limit=Number(env.CLIMATE_EVENT_MAX_MODEL_CALLS??'6');
  // Six completions at ninety seconds plus retrieval fit the scheduled wall-time limit.
  const timeout=Math.min(Number(env.CLIMATE_ASSESSMENT_TIMEOUT_MS??'180000'),90000);
  const requests=new EventRequestBudget();
  const services=createAssessmentServices({...env,CLIMATE_ASSESSMENT_TIMEOUT_MS:String(timeout)},{fetch:requests.fetch,retries:0});
  const deadline=Date.now()+12*60*1000;
  const budget=new BudgetedAssessmentModel(services.model,limit,()=>Date.now()+timeout+15000<=deadline);
  const catalog=new SupabaseClimateEventCatalog(supabaseConfig(env),{fetch:requests.controlFetch,retries:0});
  return new ClimateEventJob(catalog,new EonetProvider(requests.fetch),new DefaultClimateAssessmentService(services.repository,services.retrieval,budget),budget,
    new SupabaseStudyDiscoveryRepository(supabaseConfig(env),{fetch:requests.controlFetch,retries:0}),()=>new Date(),()=>Date.now(),()=>requests.canStartAssessment);
}
