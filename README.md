# 5 Past 12

> **The crisis isn't coming. It's happening now.**

5 Past 12 is an open-source, non-commercial climate information platform. Its goal is to make the consequences of climate change visible, understandable, and personally relevant through current events, regional context, scientific evidence, and AI-assisted explanation.

The project is designed as a public-interest information service. It is not intended to monetize users, attention, data, or access.

## Why 5 Past 12?

Climate change is already affecting communities around the world, yet its consequences are often presented as isolated headlines, abstract future projections, or highly technical scientific findings. This makes it difficult to understand how individual events connect to the broader climate crisis, what is happening nearby, and how strong the scientific evidence actually is.

5 Past 12 aims to provide a single, visual source of information that connects:

- current and recent climate-related disasters,
- regional climate relevance,
- scientifically supported climate attribution,
- primary research and source material,
- practical protection measures,
- and pathways for civic and societal action.

## Core Functionality

### MVP

- Interactive globe or global map as the primary landing experience
- Current and recently occurred climate-related events
- Regional filtering based on a user-entered location or region
- Event detail pages explaining impacts, causes, and climate relevance
- Scientific evidence linked directly to user-facing claims
- AI-generated explanations grounded exclusively in retrieved evidence
- Clear separation between scientific sources and supplementary news context

### Target

- Regional climate indicators beyond individual disasters
- “Why this matters to you” explanations based on the selected region
- Practical preparedness guidance for relevant hazards
- Action pathways for civic, community, political, and economic engagement
- Evidence confidence and attribution labels where supported by source material

## Evidence First

5 Past 12 follows a strict evidence policy:

- AI must not create climate claims that cannot be supported by retrieved evidence.
- Events must not be published as climate-impact events when no sufficiently supported connection to climate change can be established.
- News may provide context, but it must not replace scientific evidence for climate attribution.
- Scientific claims should remain traceable to their source and, where possible, to the relevant passage.

AI is used as a translation and synthesis layer — never as the source of truth.

## Privacy

5 Past 12 is intended to be a public information website, not a user-retention product:

- no user accounts,
- no persistent personal profiles,
- no automatic location tracking,
- region selection is entered manually,
- personal data collection should be avoided wherever possible.

## Non-Commercial Commitment

5 Past 12 is intended to remain an open-source public-good project.

It should not introduce:

- paid access,
- subscriptions,
- advertising,
- monetization of user attention,
- sale of user data,
- or commercial access tiers.

Future development should preserve this social-good mission.

## Hackathon

Built for **ForgeHacks 2026 — Climate Track**.

Prompt:

> Build an AI-powered solution that helps people understand environmental changes, prepare for climate impacts, use resources wisely, or create resilient systems.

## Evidence backend

Climate Central and WWA evidence ingestion, hybrid retrieval, immutable citations,
manual rebuilds, and a four-hour scheduled Worker are implemented separately from
the frontend. Setup and commands: [evidence operating guide](docs/evidence.md).
Executed checks and pending live acceptance: [implementation report](docs/evidence-implementation.md).

Event detail also displays persisted AI-assisted climate assessments with separate
**Human Influence** and **Evidence Strength** indicators, cited findings, direct
and indirect publication groups, and uncertainty. Assessments use four retrieval
perspectives and Featherless generation plus independent passage review. The
existing evidence Worker serves saved results and protects explicit generation;
page loads never run the LLM. Setup, additive migration, and demonstration command:
[climate assessment guide](docs/climate-assessment.md).
Executed checks, applied migration, live results, and remaining acceptance work:
[assessment implementation report](docs/climate-assessment-implementation.md).
`pnpm climate:discover` searches sequentially for validated direct or indirect
findings among events from the last three years, with explicit call limits,
progressive results, preview reports, and resume support. Publication metadata
prioritizes candidates; scientific claims still require retrieved passages.

The production globe defaults to saved climate connections. The existing evidence
Worker selects stored attribution studies and finds matching real events from
the last three years every ten minutes, assessing eligible events progressively with bounded model and HTTP
request budgets. Source ingestion retains its four-hour schedule. The frontend
Worker forwards only saved reads through its EVIDENCE service binding; secrets
remain in the backend. `pnpm climate:update --refresh-only` performs discovery
without generation. Production verification and limitations are recorded in the
assessment implementation report linked above.


## Self-Hosting & Deployment

**5 Past 12** is hosted exclusively for the hackathon jury at [5-past-12.jannik-ea0.workers.dev](https://5-past-12.jannik-ea0.workers.dev). Access requires a verified email address with the `@forgehacks.dev` domain.

**Privacy Notice:** Cloudflare, as the hosting and access provider, may process technical data such as IP addresses and device information. The 5 Past 12 application itself does not independently collect or store personal data.

The project can also be deployed independently using Cloudflare Workers, Supabase, and Featherless AI.

### Requirements

- Node.js 24 and pnpm
- Cloudflare account (Workers)
- Supabase project (PostgreSQL)
- Featherless AI API key

### Setup

1. Clone the repository and install dependencies:

   ```bash
   git clone <repository-url>
   cd <repository-directory>
   pnpm install --frozen-lockfile
   ```

2. Copy `.env.example` to `.env` and configure the required credentials and service URLs.

3. Set up the Supabase database and apply the required migrations.

4. Deploy the Evidence Worker and configure its environment variables, secrets, and scheduled ingestion jobs.

5. Deploy the frontend to Cloudflare Workers and configure the service binding to the Evidence Worker.

For detailed backend setup, migrations, and operational commands, see:
- [Evidence Operating Guide](docs/evidence.md)
- [Climate Assessment Guide](docs/climate-assessment.md)

### Local Preview

To explore the frontend locally:

```bash
pnpm dev
```

The application includes a **Demo Mode** with fictional example events and simulated evidence assessments, allowing reviewers to explore the interface without configuring the complete backend.

**Note:** Demo data is synthetic and must not be interpreted as real scientific attribution. Live evidence collection and AI-assisted assessments require the configured backend services.

## License

MIT License. See `LICENSE`.
