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

## Status

Early development / MVP.

## Development checks

Use Node.js 24 and the pnpm version specified in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm build
```

ESLint uses the recommended JavaScript, TypeScript, Astro, React, and React Hooks
rule sets. Generated files are excluded, and lint warnings fail the check.

GitHub Actions runs lint and build on pushes and pull requests.

## License

MIT License. See `LICENSE`.
