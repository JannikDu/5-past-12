import { createEvidenceServices } from '../src/server/evidence.ts';
import { EvidenceError } from '../src/domain/evidence.ts';
import { SupabaseEvidenceRepository } from '../src/data/repositories/supabase-evidence.ts';
import { supabaseConfig } from '../src/server/config.ts';
const [command, owner = crypto.randomUUID(), budgetText = '20'] = process.argv.slice(2);
try {
  if (command === 'status') console.info(JSON.stringify(await new SupabaseEvidenceRepository(supabaseConfig(process.env)).rebuildStatus()));
  else {
    const { rebuild } = createEvidenceServices(process.env);
    if (command === 'abort') { await rebuild.abort(owner); console.info(JSON.stringify({ status: 'ready', aborted: true })); }
    else if (command === 'start' || command === 'resume') {
      console.info(JSON.stringify({ command, owner }));
      console.info(JSON.stringify(await rebuild.run(command, owner, Number(budgetText))));
    } else throw new EvidenceError('validation', 'Usage: evidence:rebuild start|status|resume|abort [owner UUID] [source budget]');
  }
} catch (error) { console.error(error instanceof EvidenceError ? `${error.code}: ${error.message}` : 'Rebuild failed; inspect status, then resume or abort explicitly'); process.exitCode = 1; }
