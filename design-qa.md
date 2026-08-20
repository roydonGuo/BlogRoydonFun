# Project Gallery Design QA

- source visual truth path: `UI.html`
- source screenshot: `output/design-qa/source-ui.png`
- implementation URL: `http://127.0.0.1:4174/projects/`
- implementation screenshots: `output/design-qa/implementation-projects.png`, `output/design-qa/implementation-modal-final.png`, `output/design-qa/implementation-mobile.png`
- desktop viewport: 1280 × 720 CSS px
- mobile viewport: 390 × 844 CSS px
- source pixels: 1280 × 720 at deviceScaleFactor 1
- implementation pixels: 1280 × 720 at deviceScaleFactor 1
- density normalization: none required
- states: default project grid, category filtered, project modal, second carousel slide, Escape close, mobile layout

## Findings

No actionable P0, P1, or P2 differences remain.

- Fonts and typography: the implementation uses the site's bundled PingFang family while preserving the reference hierarchy, optical weight, compact labels, and display-title wrapping. This is an intentional integration improvement over the prototype's system-font fallback.
- Spacing and layout rhythm: the split introduction/archive composition, three-column masonry density, card radii, gaps, and elevation match the reference. The VitePress navigation remains above the composition by design.
- Colors and visual tokens: black, white, soft blue, brand blue, border opacity, backdrop blur, and dark-mode-compatible surfaces map to the existing VitePress theme tokens.
- Image quality and asset fidelity: the implementation reuses the reference Unsplash subjects with responsive `object-fit: cover` cropping and descriptive alt text. No placeholder or code-drawn image substitutes are present.
- Copy and content: reference headlines, labels, project summaries, metadata, links, and carousel captions are preserved; counts now derive from the actual six-item data set.

## Focused comparison evidence

- Full view: source and implementation were compared side by side at 1280 × 720. The implementation intentionally includes the production VitePress navigation, while the project composition preserves the reference split layout and visual hierarchy.
- Modal: source and implementation modal states were compared at 1280 × 720. The initial implementation was taller than the reference; the modal was corrected to a 1060 × 548 desktop target and recaptured in `implementation-modal-final.png`.
- Mobile: `implementation-mobile.png` confirms the split layout collapses to a single column at 390px without horizontal overflow, clipped controls, or unreadable text.

## Comparison history

1. P2 — modal height and visual weight differed from the reference (`1100 × 650` implementation target versus `1060 × 548` reference target).
2. Fix — changed the desktop modal dimensions to `min(1060px, 94vw)` by `min(548px, 86vh)`.
3. Post-fix evidence — `output/design-qa/implementation-modal-final.png`; no remaining actionable P0/P1/P2 mismatch.

## Interaction and console verification

- Category filtering: passed for Full Stack and AI Experiment.
- Time-order toggle: rendered and keyboard-accessible.
- Project modal: opened from card and focused the close control.
- Carousel: next slide changed image and counter from 01/03 to 02/03.
- Keyboard: Escape closed the modal; Left/Right handlers are registered for carousel navigation.
- External links: GitHub and project-site actions render as semantic anchors.
- Console: no implementation runtime errors observed during the verified flows.

## Follow-up polish

- P3: replace the six sample project records and generic image URLs with final repository metadata and owned screenshots when those assets are available.

final result: passed
