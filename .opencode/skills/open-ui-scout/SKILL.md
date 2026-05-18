---
name: open-ui-scout
description: Select coherent open-source frontend UI resources before implementation. Use when Codex, Claude Code, Cursor, Windsurf, Gemini CLI, or another coding agent needs to build or redesign frontend UI, choose component libraries, select dashboard or landing page blocks, plan AI chat UI, editor or canvas workspaces, mobile UI, icons, design tokens, motion, charts, forms, or vibe coding visual direction from GitHub resources without defaulting to one style or one UI library.
---

# Open UI Scout

A frontend UI selection and generation skill for AI coding agents.

Open UI Scout helps an agent understand a frontend request, infer the page type and visual mood, select suitable open-source GitHub UI resources, and generate consistent, production-ready UI code.

This skill is designed for vibe coding. It should not blindly generate generic dark AI dashboards, and it should not lock every style to a fixed library.

> Understand the page first. Pick the right open-source UI resources next. Then generate consistent frontend code.

## Purpose

Open UI Scout turns vague frontend requests into a small, coherent UI resource selection and implementation direction. It is a decision workflow, not a fixed recommendation list.

## Resource Pool Size

This version includes **707 unique GitHub repositories** across 16 resource groups.

Before installing or copying from any repository, verify that the repository exists, is actively maintained enough for the task, has a suitable license, and matches the current project stack.

## Installation

For Claude Code, install this file at:

```text
.claude/skills/open-ui-scout/SKILL.md
```

For Codex or other coding agents, keep a repository-level entry such as `AGENTS.md` that points agents to this skill before frontend UI work. A public copy can also live at repository root as `SKILL.md`.

---

## When to Use This Skill

Use this skill when the user asks for any of the following:

- Build a frontend page or component.
- Redesign a page.
- Make a UI more beautiful.
- Choose a UI library.
- Find GitHub open-source UI resources.
- Create a landing page, login page, dashboard, workspace, editor UI, AI chat UI, settings page, pricing page, mobile page, docs page, or onboarding flow.
- Change the visual mood of an interface, such as warm, literary, minimal, playful, premium, enterprise, academic, or tech-like.

Do not use this skill for backend-only tasks, database-only tasks, pure algorithm work, or non-UI refactoring unless the user explicitly asks for UI design or frontend implementation.

---

## Core Philosophy

Do not start from a library. Start from the user's intent.

A UI request should be understood through five dimensions:

1. Page type
2. Product context
3. Visual mood
4. Technical stack
5. Production constraints

The same page type can require very different UI choices.

Examples:

- A login page for an AI SaaS product may need a premium tech style.
- A login page for a diary app may need a warm cozy style.
- A login page for a research tool may need a calm minimal style.
- A login page for an enterprise admin system may need a formal and reliable style.

Never use fixed mappings such as:

- Tech = Magic UI
- Warm = daisyUI
- Dashboard = Tremor

Instead, treat libraries as candidates and score them against the actual request.

---

## Required Workflow

### Step 0: Understand the Request Before Choosing Resources

Before selecting any UI source, identify:

- page type and primary workflow
- product context and audience
- visual mood and words the user used to imply it
- current or requested technical stack
- production constraints such as accessibility, responsiveness, licensing, bundle cost, delivery speed, design-system compatibility, and maintainability

If key information is missing, infer conservatively from the product context. Ask a clarifying question when the missing answer would materially change the UI stack, implementation, or visual direction.

### Step 1: Inspect the Current Project

If working inside an existing repository, inspect:

- `package.json`
- framework: React, Next.js, Vue, Nuxt, Svelte, Solid, Astro, etc.
- styling: Tailwind CSS, CSS Modules, SCSS, styled-components, Emotion, vanilla CSS
- existing UI libraries
- existing icon libraries
- existing design tokens or theme files
- `components.json` if shadcn/ui is used
- `tailwind.config.*`
- `app/`, `pages/`, `src/`, `components/`, `features/`, `modules/`, `lib/`
- current component naming patterns
- current folder conventions

Do not introduce a new UI ecosystem if the project already has a clear one, unless the user explicitly wants a redesign or a new system.

Do not add a large UI library for a single isolated component. Prefer copying or adapting a small compatible pattern, using the existing stack, or writing the component directly.

If there is no project context, default to:

- React or Next.js
- Tailwind CSS
- shadcn/ui as the base UI when suitable
- lucide-react as the default icon set
- Motion or Framer Motion only when motion is useful

### Step 2: Classify the Page Type

Classify the request into one or more page types:

- `landing_page`
- `login_page`
- `signup_page`
- `onboarding`
- `dashboard`
- `admin_panel`
- `workspace`
- `editor_workspace`
- `canvas_editor`
- `ai_chat`
- `agent_workspace`
- `settings_page`
- `profile_page`
- `pricing_page`
- `billing_page`
- `project_list`
- `file_upload`
- `data_table`
- `analytics_page`
- `mobile_h5`
- `portfolio`
- `blog`
- `docs`
- `marketing_section`
- `empty_state`
- `error_page`
- `loading_state`

If the page type is unclear, infer the most likely type from the product description. Avoid asking clarifying questions unless the missing information would strongly change the implementation.

### Step 3: Classify the Visual Mood

Infer the intended mood. The user may describe it directly or indirectly.

Use this style ambiguity rule:

1. If the user explicitly names a style, follow that style.
2. If the user does not name a style but the product context strongly implies one, infer the mood and state the assumption in the selection summary.
3. If the user does not name a style and multiple moods would be plausible, ask a clarifying question or offer 2-3 concise directions for the user to choose from before committing to resources.

Supported mood labels:

- `ai_tech`
- `premium_saas`
- `enterprise`
- `warm_cozy`
- `editorial`
- `calm_minimal`
- `playful_pastel`
- `retro`
- `portfolio_designer`
- `academic_clean`
- `creator_tool`
- `developer_tool`
- `mobile_native`
- `luxury`
- `cute`
- `serious_productive`

Do not default to `ai_tech`. Many users do not want a cyber, neon, black-purple interface.

If the user says only “beautiful”, “modern”, “高级”, “舒服”, “文艺”, or “温馨”, infer the product context before selecting resources.

### Step 4: Select Candidate Resources

Select candidates from the GitHub resource pool.

Use at most three sources per task:

1. One base UI system
2. One page-pattern or business-component source
3. One style-enhancement source

If the task is very small, use only the existing project stack and avoid adding dependencies.

Do not mix multiple full UI systems. A good selection is usually one base UI system plus one pattern source or one enhancement source.

### Step 4.5: Verify Resource Fitness

Before installing, copying, or strongly recommending any GitHub resource, verify or explicitly mark as needing verification:

- repository exists at the stated owner/name
- license is compatible with the user's project and distribution model
- maintenance status is acceptable for the task
- package or source code matches the current framework and styling stack
- dependency cost is justified by the value it adds
- accessibility and keyboard behavior are acceptable for interactive UI

If a repository has moved, is archived, lacks a clear license, or looks inactive, prefer a healthier alternative or present it as inspiration only.

### Step 5: Score Candidate Libraries

Score each candidate from 0 to 5:

```yaml
scoring:
  tech_stack_match: 0-5
  page_type_match: 0-5
  visual_mood_match: 0-5
  copy_paste_friendliness: 0-5
  production_readiness: 0-5
  maintenance_activity: 0-5
  license_clarity: 0-5
  dependency_cost: 0-5
  style_conflict_risk: 0-5
  accessibility_support: 0-5
```

Prefer candidates with:

- high stack match
- high visual mood match
- low style conflict risk
- low dependency cost
- good copy-paste friendliness
- clear license
- active maintenance

Do not install or recommend a library only because it looks cool.

### Step 6: Make a Short Design Decision

Before writing code, produce a concise decision summary unless the user only wants code.

```text
Page type:
Mood:
Current stack:
Base UI:
Supporting resources:
Why this selection:
Dependency risk:
Implementation direction:
```

### Step 7: Generate the UI

When generating code:

- Keep the implementation consistent with the selected UI sources.
- Prefer existing project conventions.
- Avoid unnecessary dependencies.
- Make the UI responsive.
- Include loading, empty, error, disabled, hover, focus, and active states when relevant.
- Use semantic HTML where possible.
- Keep components reasonably small.
- Use accessible labels for forms and controls.
- Avoid overly clever animation.
- Avoid mixing too many visual systems.
- Do not copy large copyrighted templates verbatim.
- Use open-source GitHub resources as inspiration or compatible dependencies.

---

## Anti-Patterns

Avoid these mistakes:

1. Do not default every UI to black-purple AI tech style.
2. Do not use glow, neon, grid backgrounds, or 3D effects unless they match the request.
3. Do not mix Ant Design, MUI, shadcn/ui, daisyUI, and HeroUI in one page.
4. Do not introduce a large UI library for one button or card.
5. Do not use landing-page animations inside dense dashboards.
6. Do not make enterprise admin pages look like startup landing pages.
7. Do not make warm cozy pages look cyberpunk.
8. Do not make editorial pages into card-heavy dashboards.
9. Do not overuse gradients.
10. Do not sacrifice readability for aesthetics.
11. Do not ignore mobile responsiveness.
12. Do not ignore accessibility.
13. Do not generate visual-only UI without real states and interactions.
14. Do not invent library APIs without checking or following known patterns.
15. Do not claim a GitHub library supports a feature unless it has been inspected or is already known.

---

## Style Modes

### AI Tech

Use for AI tools, developer tools, generation pages, product launch pages, futuristic SaaS, model dashboards, and agent workspaces.

Visual traits: crisp layout, dark or clean white background, subtle grid, gradient accents, glass cards only when appropriate, sparing glow, smooth motion, sharp hierarchy.

Candidate sources: `shadcn-ui/ui`, `magicuidesign/magicui`, `DavidHDev/react-bits`, `ibelick/motion-primitives`, `imskyleen/animate-ui`, `kokonut-labs/kokonutui`, `tremorlabs/tremor`.

Avoid: too much neon, random 3D, unreadable glowing text, heavy animation in productivity UI.

### Premium SaaS

Use for SaaS dashboards, pricing, team workspaces, product settings, usage, billing, and customer-facing tools.

Visual traits: clean white or neutral background, strong spacing, subtle borders, polished cards, refined tables, calm accent color, reliable layout.

Candidate sources: `shadcn-ui/ui`, `tremorlabs/tremor`, `keenthemes/reui`, `shadcn/originui`, `mantinedev/mantine`, `heroui-inc/heroui`, `TailAdmin/free-nextjs-admin-dashboard`.

### Enterprise

Use for admin systems, internal tools, CRM, permission systems, data-heavy management, finance, and operations tools.

Visual traits: high information density, reliable tables and filters, conservative colors, clear navigation, predictable component behavior, strong form validation.

Candidate sources: `ant-design/ant-design`, `ant-design/pro-components`, `ant-design/ant-design-pro`, `mui/material-ui`, `mui/mui-x`, `palantir/blueprint`, `cloudscape-design/components`, `fluentui/fluentui`, `elastic/eui`, `mantinedev/mantine`.

### Warm Cozy

Use for companion apps, diary apps, study tools, mental wellness, family products, lightweight personal tools, and onboarding pages.

Visual traits: cream, beige, peach, rose, amber, large rounded cards, soft shadows, friendly copy, gentle icons, calm transitions, soft empty states.

Candidate sources: `shadcn-ui/ui`, `markmead/hyperui`, `merakiuilabs/merakiui`, `saadeghi/daisyui`, `htmlstreamofficial/preline`, `phosphor-icons/core`, `lucide-icons/lucide`.

### Editorial

Use for portfolio, blog, design showcase, brand story, case study, publication-style pages, art, and culture products.

Visual traits: large whitespace, serif headlines, thin dividers, image-first layout, low saturation, magazine-like hierarchy, fewer cards, stronger typography.

Candidate sources: `shadcn-ui/ui`, `tailark/blocks`, `shadcnblocks/shadcn-ui-blocks`, `markmead/hyperui`, `htmlstreamofficial/preline`, `ibelick/nim`, `fontsource/fontsource`.

### Calm Minimal

Use for notes, knowledge base, research tools, document workspaces, project management, and quiet productivity apps.

Visual traits: off-white, stone, zinc, neutral, subtle border, minimal shadow, small icons, low motion, clear typography, restrained interactions.

Candidate sources: `shadcn-ui/ui`, `radix-ui/primitives`, `radix-ui/colors`, `shadcn/originui`, `mantinedev/mantine`, `lucide-icons/lucide`, `radix-ui/icons`.

### Playful Pastel

Use for student tools, check-in apps, lightweight mobile apps, planning apps, cute personal products, and casual learning tools.

Visual traits: pastel colors, rounded 2xl or 3xl cards, sticker-like icons, soft contrast, friendly copy, small delightful motion.

Candidate sources: `saadeghi/daisyui`, `markmead/hyperui`, `merakiuilabs/merakiui`, `phosphor-icons/core`, `htmlstreamofficial/preline`, `konstaui/konsta`.

### Retro

Use for music sites, game pages, creative portfolios, cultural products, and experimental landing pages.

Visual traits: grain, vintage colors, bolder typography, poster-like layout, playful spacing, strong visual character.

Candidate sources: `shadcn-ui/ui`, `DavidHDev/react-bits`, `nolly-studio/cult-ui`, `saadeghi/daisyui`, `tailwindlabs/tailwindcss`.

### Academic Clean

Use for research tools, paper management, lab websites, technical documentation, dataset portals, and experiment dashboards.

Visual traits: clean layout, readable typography, restrained color, clear tables, precise charts, minimal decoration.

Candidate sources: `shadcn-ui/ui`, `radix-ui/primitives`, `tremorlabs/tremor`, `recharts/recharts`, `apache/echarts`, `mantinedev/mantine`, `fontsource/fontsource`.

---

## Page-Type Recipes

These are not fixed mappings. They are starting points. Always rescore candidates against the actual task.

### Login or Signup Page

Consider:

- Base UI: `shadcn-ui/ui`, `mantinedev/mantine`, `heroui-inc/heroui`, `ant-design/ant-design`
- Warm style: `markmead/hyperui`, `merakiuilabs/merakiui`, `saadeghi/daisyui`
- Tech style: `magicuidesign/magicui`, `ibelick/motion-primitives`
- Enterprise style: `ant-design/ant-design`, `mui/material-ui`

Include:

- form validation
- loading state
- error state
- disabled submit state
- password visibility if password exists
- OAuth buttons if requested
- responsive layout

### Dashboard or Admin

Consider:

- Base UI: `shadcn-ui/ui`, `mantinedev/mantine`, `ant-design/ant-design`, `mui/material-ui`
- Data UI: `tremorlabs/tremor`, `tanstack/table`, `mui/mui-x`, `ag-grid/ag-grid`
- Templates: `TailAdmin/free-nextjs-admin-dashboard`, `tabler/tabler`, `ant-design/ant-design-pro`

Include:

- sidebar or top navigation
- filters
- data loading state
- empty state
- table density
- chart readability
- responsive collapse behavior

### Landing Page

Consider:

- Blocks: `tailark/blocks`, `shadcnblocks/shadcn-ui-blocks`, `markmead/hyperui`, `htmlstreamofficial/preline`
- Motion: `magicuidesign/magicui`, `DavidHDev/react-bits`, `ibelick/motion-primitives`
- Base: `shadcn-ui/ui`

Include:

- strong hero
- clear value proposition
- product visual
- feature blocks
- social proof if useful
- CTA
- responsive mobile hero

### Editor or Canvas Workspace

Consider:

- UI shell: `shadcn-ui/ui`
- Canvas engine: `tldraw/tldraw`, `fabricjs/fabric.js`, `konvajs/konva`, `xyflow/xyflow`, `excalidraw/excalidraw`
- Panels: `bvaughn/react-resizable-panels`, `bokuweb/react-rnd`, `dnd-kit/docs`

Include:

- left toolbar
- center canvas
- right properties panel
- top command bar
- zoom controls
- layer list if relevant
- keyboard shortcuts if relevant

### AI Chat or Agent Workspace

Consider:

- Base: `shadcn-ui/ui`
- Chat UI: `ibelick/prompt-kit`, `Yonom/assistant-ui`, `vercel/ai-chatbot`
- Motion: `ibelick/motion-primitives`

Include:

- message list
- composer
- tool call state
- loading or streaming state
- empty state
- retry action
- attachment support if relevant

---

## GitHub Resource Pool

The lists below are candidate sources. They are not commands to install everything.

Use the scoring process to choose a small, coherent subset for the task.

### Meta Indexes And Discovery

Count: 22

```text
birobirobiro/awesome-shadcn-ui
bytefer/awesome-shadcn-ui
shadcn-ui/awesome-shadcn-ui
aniftyco/awesome-tailwindcss
dalisoft/awesome-ui-libraries
awesomelistsio/awesome-ui-components
anubhavsrivastava/awesome-ui-component-library
brillout/awesome-react-components
brillout/awesome-frontend-libraries
enaqx/awesome-react
vuejs/awesome-vue
sveltejs/awesome-svelte
sindresorhus/awesome
requestly/awesome-frontend-resources
hevar/awesome-react-tailwindcss-ui-components
tvoma/awesome-tailwind-ui
donnemartin/system-design-primer
codecrafters-io/build-your-own-x
marmelab/awesome-rest
gothinkster/realworld
dkhamsing/open-source-ios-apps
pcqpcq/open-source-android-apps
```

### React Next Base Ui Systems

Count: 56

```text
shadcn-ui/ui
radix-ui/primitives
radix-ui/themes
mui/base-ui
tailwindlabs/headlessui
ariakit/ariakit
reach/reach-ui
adobe/react-spectrum
chakra-ui/chakra-ui
chakra-ui/ark
heroui-inc/heroui
nextui-org/nextui
mantinedev/mantine
mui/material-ui
ant-design/ant-design
ant-design/pro-components
react-bootstrap/react-bootstrap
reactstrap/reactstrap
semantic-org/Semantic-UI-React
primefaces/primereact
rsuite/rsuite
grommet/grommet
palantir/blueprint
cloudscape-design/components
fluentui/fluentui
carbon-design-system/carbon
Shopify/polaris
patternfly/patternfly-react
elastic/eui
segmentio/evergreen
tamagui/tamagui
jquense/react-widgets
jaredpalmer/formik
react-hook-form/react-hook-form
downshift-js/downshift
floating-ui/floating-ui
reactjs/react-modal
JedWatson/react-select
react-datepicker/react-datepicker
Hacker0x01/react-datepicker
wojtekmaj/react-calendar
gpbl/react-day-picker
react-component/field-form
react-component/picker
react-component/table
react-component/tree
react-component/select
react-component/upload
react-component/dialog
react-component/tooltip
react-component/drawer
react-component/menu
react-component/dropdown
react-component/slider
react-component/tabs
react-component/steps
```

### Shadcn Ecosystem Registries Blocks

Count: 53

```text
shadcn-ui/ui
shadcn-ui/registry-template
shadcn-ui/taxonomy
birobirobiro/awesome-shadcn-ui
bytefer/awesome-shadcn-ui
serafimcloud/21st
shadcn/originui
origin-space/originui
keenthemes/reui
shadcnblocks/shadcn-ui-blocks
shadcnblocks/kibo
tailark/blocks
shadcnstudio/shadcn-studio
shadcnspace/shadcnspace
nolly-studio/cult-ui
kokonut-labs/kokonutui
imskyleen/animate-ui
karthikmudunuri/eldoraui
ibelick/prompt-kit
Yonom/assistant-ui
ibelick/motion-primitives
ibelick/zola
ibelick/nim
nyxb-ui/ui
magicuidesign/magicui
DavidHDev/react-bits
mattbx/shadcn-skills
masonjames/Shadcnblocks-Skill
iakovosds/cnblocks
mfts/papermark
elie222/inbox-zero
dubinc/dub
calcom/cal.com
formbricks/formbricks
twentyhq/twenty
boxyhq/saas-starter-kit
ixartz/SaaS-Boilerplate
vercel/nextjs-subscription-payments
vercel/platforms
midday-ai/midday
laurent22/joplin
actualbudget/actual
documenso/documenso
openstatusHQ/openstatus
maybe-finance/maybe
homarr-labs/homarr
supabase/supabase
langfuse/langfuse
triggerdotdev/trigger.dev
umami-software/umami
coollabsio/coolify
logto-io/logto
Infisical/infisical
```

### Tailwind Component Blocks

Count: 47

```text
saadeghi/daisyui
themesberg/flowbite
themesberg/flowbite-react
htmlstreamofficial/preline
markmead/hyperui
merakiuilabs/merakiui
Microwawe/mamba-ui
praveenjuge/kutty
Siumauricio/rippleui
TailGrids/tailwind-ui-components
sailboatui/sailboatui
material-tailwind/material-tailwind
konstaui/konsta
skeletonlabs/skeleton
creativetimofficial/tailwind-starter-kit
estevanmaito/windmill-dashboard
estevanmaito/windmill-react-ui
themesberg/tailwind-starter-kit
L-Blondy/tw-elements
tailwindlabs/tailwindcss-forms
tailwindlabs/tailwindcss-typography
tailwindlabs/tailwindcss-aspect-ratio
tailwindlabs/tailwindcss-container-queries
tailwindlabs/tailwindcss
postcss/autoprefixer
unocss/unocss
stitchesjs/stitches
vanilla-extract-css/vanilla-extract
emotion-js/emotion
styled-components/styled-components
panda-css/panda
tw-in-js/twind
heroui-inc/tailwind-variants
nextui-org/tailwind-variants
joe-bell/cva
dcastil/tailwind-merge
clsx/clsx
pmndrs/leva
bramus/cqfill
alpinejs/alpine
tailwindtoolbox/Admin-Template
tailwindtoolbox/Landing-Page
tailwindtoolbox/Minimal-Blog
tailwindtoolbox/Profile-Card
tailwindtoolbox/Rainblur-Landing-Page
tailwindtoolbox/Starter-Template
tailwindtoolbox/App-Landing-Page
```

### Motion Visual Effects

Count: 47

```text
magicuidesign/magicui
DavidHDev/react-bits
ibelick/motion-primitives
imskyleen/animate-ui
kokonut-labs/kokonutui
nolly-studio/cult-ui
karrixlee/KL-UI
karthikmudunuri/eldoraui
nikitph/flux-ui
omerakben/tuel
nyxb-ui/ui
barvian/number-flow
romboHQ/tailwindcss-motion
tsparticles/react
tsparticles/tsparticles
pmndrs/react-three-fiber
pmndrs/drei
framer/motion
greensock/GSAP
animejs/anime
motiondivision/motionone
lottiefiles/lottie-react
airbnb/lottie-web
react-spring/react-spring
pmndrs/react-spring
pmndrs/react-use-gesture
use-gesture/use-gesture
FormidableLabs/react-animations
daneden/animate.css
animate-css/animate.css
reactjs/react-transition-group
aholachek/react-flip-toolkit
nearform/react-animation
wellyshen/react-cool-inview
michalsnik/aos
alvarotrigo/fullPage.js
nolimits4web/swiper
hamburgers/hamburgers
idiotWu/smooth-scrollbar
locomotivemtl/locomotive-scroll
darkroomengineering/lenis
studio-freight/lenis
barbajs/barba
kamranahmedse/driver.js
shepherd-pro/shepherd
shipshapecode/shepherd
gilbarbara/react-joyride
```

### Dashboard Admin Templates

Count: 51

```text
tremorlabs/tremor
tremorlabs/template-dashboard-oss
TailAdmin/free-nextjs-admin-dashboard
TailAdmin/free-react-tailwind-admin-dashboard
TailAdmin/tailadmin-free-tailwind-dashboard-template
tabler/tabler
ant-design/ant-design-pro
ant-design/pro-components
keenthemes/reui
adminmart/MatDash-Nextjs-free
adminmart/Modernize-Nextjs-Free
flatlogic/react-material-admin
creativetimofficial/material-dashboard-react
creativetimofficial/argon-dashboard-react
coreui/coreui-free-react-admin-template
akveo/ngx-admin
epicmaxco/vuestic-admin
justboil/admin-one-vue-tailwind
themeselection/sneat-bootstrap-html-admin-template-free
ColorlibHQ/AdminLTE
puikinsh/gentelella
BootstrapDash/PurpleAdmin-Free-Admin-Template
BootstrapDash/StarAdmin-Free-Bootstrap-Admin-Template
BootstrapDash/corona-free-dark-bootstrap-admin-template
wrappixel/materialpro-react-lite
wrappixel/ample-react-dashboard-lite
flatlogic/sing-app-react
flatlogic/light-blue-react
flatlogic/react-dashboard
devias-io/material-kit-react
devias-io/material-kit-pro-react
coreui/coreui-free-vue-admin-template
coreui/coreui-free-angular-admin-template
coreui/coreui-free-bootstrap-admin-template
primefaces/sakai-react
primefaces/sakai-vue
primefaces/sakai-ng
primefaces/primereact-examples
marmelab/react-admin
refinedev/refine
saleor/saleor-dashboard
amplication/amplication
appsmithorg/appsmith
ToolJet/ToolJet
Budibase/budibase
nocobase/nocobase
lowdefy/lowdefy
plasmicapp/plasmic
directus/directus
strapi/strapi
payloadcms/payload
```

### Landing Marketing Templates

Count: 54

```text
tailark/blocks
shadcnblocks/shadcn-ui-blocks
iakovosds/cnblocks
magicuidesign/magicui
DavidHDev/react-bits
markmead/hyperui
htmlstreamofficial/preline
themesberg/flowbite
merakiuilabs/merakiui
karthikmudunuri/eldoraui
creativetimofficial/tailwind-starter-kit
cruip/open-react-template
cruip/tailwind-landing-page-template
vercel/platforms
leerob/leerob.io
ibelick/nim
ixartz/Next-js-Boilerplate
ixartz/SaaS-Boilerplate
ixartz/Next-js-Landing-Page-Starter-Template
ixartz/Astro-boilerplate
withastro/astro
withastro/starlight
theodorusclarence/ts-nextjs-tailwind-starter
t3-oss/create-t3-app
nextauthjs/next-auth-example
vercel/next.js
vercel/examples
open-sauced/app
netlify-templates/next-platform-starter
sanity-io/nextjs-blog-cms-sanity-v3
timlrx/tailwind-nextjs-starter-blog
tailwindlabs/spotlight
tailwindlabs/primer
transitive-bullshit/nextjs-notion-starter-kit
NotionX/react-notion-x
Lissy93/personal-security-checklist
withspectrum/spectrum
hashnode/starter-kit
hugo-toha/toha
gatsbyjs/gatsby-starter-blog
gatsbyjs/gatsby
QwikDev/qwik
solidjs/solid-start
remix-run/remix
vitejs/vite
unjs/unjs.io
nuxt/nuxt.com
nuxt-ui-templates/dashboard
nuxt-ui-templates/landing
nuxt-ui-templates/docs
nuxt-ui-templates/pro-dashboard
nuxt-ui-templates/saas
nuxt-ui-templates/starter
vitejs/awesome-vite
```

### Ai Chat Agent Ui

Count: 46

```text
ibelick/prompt-kit
Yonom/assistant-ui
ibelick/zola
vercel/ai-chatbot
vercel/ai
mckaywrigley/chatbot-ui
open-webui/open-webui
lobehub/lobe-chat
ChatGPTNextWeb/NextChat
CopilotKit/CopilotKit
continuedev/continue
cline/cline
langchain-ai/langgraphjs
langchain-ai/langchainjs
langchain-ai/open-canvas
upstash/rag-chatbot
jina-ai/langchain-serve
FlowiseAI/Flowise
langgenius/dify
Mintplex-Labs/anything-llm
microsoft/autogen
microsoft/semantic-kernel
crewAIInc/crewAI
browser-use/browser-use
run-llama/LlamaIndexTS
superagent-ai/superagent
e2b-dev/fragments
getmaxun/maxun
stackblitz-labs/bolt.diy
all-hands-ai/OpenHands
BloopAI/bloop
sourcegraph/cody
tabbyml/tabby
codestoryai/aide
aider-ai/aider
yoheinakajima/babyagi
microsoft/TaskWeaver
Significant-Gravitas/AutoGPT
TransformerOptimus/SuperAGI
agenta-ai/agenta
promptfoo/promptfoo
Helicone/helicone
langfuse/langfuse
Portkey-AI/gateway
openai/openai-node
openai/openai-python
```

### Editor Canvas Diagram Workspace

Count: 77

```text
tldraw/tldraw
excalidraw/excalidraw
xyflow/xyflow
konvajs/react-konva
konvajs/konva
fabricjs/fabric.js
pixijs/pixijs
paperjs/paper.js
pmndrs/react-three-fiber
pmndrs/drei
dnd-kit/docs
clauderic/dnd-kit
atlassian/pragmatic-drag-and-drop
react-grid-layout/react-grid-layout
bokuweb/react-rnd
bvaughn/react-resizable-panels
daybrush/moveable
daybrush/selecto
daybrush/scenejs
craftjs/Craft.js
prevwong/craft.js
facebook/lexical
ProseMirror/prosemirror
ueberdosis/tiptap
tiptap/tiptap
udecode/plate
ianstormtaylor/slate
quilljs/quill
zenoamaro/react-quill
milkdown/milkdown
TypeCellOS/BlockNote
blocknotejs/blocknote
GrapesJS/grapesjs
BuilderIO/builder
BuilderIO/mitosis
PuckEditor/puck
measuredco/puck
react-page/react-page
tremorlabs/tremor
TanStack/form
rjsf-team/react-jsonschema-form
jsonforms/jsonforms
surveyjs/survey-library
formio/formio.js
reactflow/react-flow
projectstorm/react-diagrams
diagrams-js/diagram-js
bpmn-io/bpmn-js
camunda/bpmn-js
mermaid-js/mermaid
plantuml/plantuml
dromara/go-view
alibaba/GGEditor
antvis/X6
antvis/G6
antvis/L7
jointjs/joint
clientIO/joint
drawdb-io/drawdb
sql-js/sql.js
silexlabs/Silex
penpot/penpot
figma/plugin-samples
BuilderIO/figma-html
html-to-image/html-to-image
bubkoo/html-to-image
tsayen/dom-to-image
niklasvh/html2canvas
eKoopmans/html2pdf.js
parallax/jsPDF
gitbrent/PptxGenJS
yWorks/svg2pdf.js
canvg/canvg
svgdotjs/svg.js
svg/svgo
svgdotjs/svg.panzoom.js
svgdotjs/svg.resize.js
```

### Charts Tables Data Viz

Count: 56

```text
recharts/recharts
apache/echarts
hustcc/echarts-for-react
plouc/nivo
airbnb/visx
FormidableLabs/victory
vega/vega
vega/vega-lite
vega/react-vega
plotly/react-plotly.js
plotly/plotly.js
antvis/G2
antvis/G2Plot
antvis/L7
antvis/S2
antvis/G6
antvis/X6
d3/d3
chartjs/Chart.js
reactchartjs/react-chartjs-2
tremorlabs/tremor
tanstack/table
tanstack/virtual
ag-grid/ag-grid
mui/mui-x
handsontable/handsontable
glideapps/glide-data-grid
adazzle/react-data-grid
Comcast/react-data-grid
KevinVandy/material-react-table
jbetancur/react-data-table-component
autodesk/react-base-table
schrodinger/fixed-data-table-2
bvaughn/react-window
bvaughn/react-virtualized
petyosi/react-virtuoso
TanStack/query
pmndrs/zustand
reduxjs/redux-toolkit
facebookexperimental/Recoil
pmndrs/jotai
valtiojs/valtio
vercel/swr
LegendApp/legend-state
mobxjs/mobx
xstatejs/xstate
fluentui/fluentui
visjs/vis-network
visgl/react-map-gl
mapbox/mapbox-gl-js
Leaflet/Leaflet
PaulLeCam/react-leaflet
openlayers/openlayers
CesiumGS/cesium
kepler-gl/kepler.gl
uber/deck.gl
```

### Vue Nuxt Ui

Count: 55

```text
unovue/shadcn-vue
unovue/reka-ui
unovue/inspira-ui
nuxt/ui
nuxt/nuxt
nuxt-modules/tailwindcss
vueComponent/ant-design-vue
element-plus/element-plus
vuetifyjs/vuetify
primefaces/primevue
quasarframework/quasar
Akryum/vue-virtual-scroller
epicmaxco/vuestic-ui
epicmaxco/vuestic-admin
themesberg/flowbite-vue
radix-vue/radix-vue
tusen-ai/naive-ui
arco-design/arco-design-vue
varletjs/varlet
Tencent/tdesign-vue-next
Tencent/tdesign-vue
Tencent/tdesign-mobile-vue
youzan/vant
youzan/vant-demo
baianat/hooper
vueform/multiselect
vueform/vueform
vueuse/vueuse
vuejs/pinia
vuejs/router
vuejs/core
vitejs/vite
slidevjs/slidev
vuepress/core
vuepress/vuepress-next
vitepress/docs
jdf2e/nutui
ElemeFE/element
iview/iview
buefy/buefy
bootstrap-vue/bootstrap-vue
euvl/vue-js-modal
vue-final/vue-final-modal
SortableJS/Vue.Draggable
shentao/vue-multiselect
ecomfe/vue-echarts
vuechartjs/vue-chartjs
vue-stripe/vue-stripe
nuxt-themes/docus
nuxt-themes/alpine
nuxt-modules/mdc
nuxt/image
nuxt/content
nuxt/fonts
nuxt/icon
```

### Svelte Solid Astro Multi Framework

Count: 38

```text
huntabyte/shadcn-svelte
skeletonlabs/skeleton
themesberg/flowbite-svelte
carbon-design-system/carbon-components-svelte
svelteuidev/svelteui
melt-ui/melt-ui
huntabyte/bits-ui
sveltejs/svelte
sveltejs/kit
sveltejs/realworld
solidjs/solid
solidjs/solid-start
kobaltedev/kobalte
suid-io/suid
hope-ui/hope-ui
chakra-ui/ark
corvujs/corvu
unocss/unocss
withastro/astro
withastro/starlight
withastro/astro.build
nanostores/nanostores
preactjs/preact
preactjs/signals
builderio/qwik
QwikDev/qwik
BuilderIO/mitosis
millionjs/million
marko-js/marko
stenciljs/core
ionic-team/stencil
lit/lit
webcomponents/polyfills
shoelace-style/shoelace
open-wc/open-wc
vaadin/web-components
patternfly/patternfly-elements
material-components/material-web
```

### Mobile H5 App Ui

Count: 34

```text
konstaui/konsta
ionic-team/ionic-framework
Framework7io/framework7
ant-design/ant-design-mobile
youzan/vant
Tencent/tdesign-mobile-vue
Tencent/tdesign-mobile-react
jd-opensource/nutui
NervJS/taro
dcloudio/uni-app
alibaba/rax
nativewind/nativewind
tamagui/tamagui
Shopify/restyle
callstack/react-native-paper
react-native-elements/react-native-elements
gluestack/gluestack-ui
gluestack/gluestack-ui-nativewind
GeekyAnts/NativeBase
software-mansion/react-native-reanimated
software-mansion/react-native-gesture-handler
react-navigation/react-navigation
gorhom/react-native-bottom-sheet
mrousavy/react-native-vision-camera
Shopify/flash-list
facebook/react-native
expo/expo
flutter/flutter
flutter/gallery
ionic-team/capacitor
tauri-apps/tauri
electron/electron
electron-react-boilerplate/electron-react-boilerplate
neutralinojs/neutralinojs
```

### Icons Tokens Fonts Design Assets

Count: 59

```text
lucide-icons/lucide
tabler/tabler-icons
phosphor-icons/core
tailwindlabs/heroicons
Remix-Design/RemixIcon
iconify/iconify
react-icons/react-icons
radix-ui/icons
primer/octicons
microsoft/fluentui-system-icons
carbon-design-system/carbon-icons
ant-design/ant-design-icons
twbs/icons
simple-icons/simple-icons
feathericons/feather
ionic-team/ionicons
FortAwesome/Font-Awesome
google/material-design-icons
astrit/css.gg
teenyicons/teenyicons
akveo/eva-icons
jam-icons/jam-icons
tabler/tabler
radix-ui/colors
adobe/leonardo
ant-design/ant-design-colors
primer/primitives
carbon-design-system/carbon
fontsource/fontsource
rsms/inter
vercel/geist-font
IBM/plex
googlefonts/noto-cjk
be5invis/Iosevka
lxgw/LxgwWenKai
atelier-anchor/smiley-sans
adobe-fonts/source-han-sans
adobe-fonts/source-han-serif
typekit/source-code-pro
source-foundry/Hack
JetBrains/JetBrainsMono
tonsky/FiraCode
mozilla/Fira
googlefonts/roboto
googlefonts/rubik
googlefonts/lexend
googlefonts/opensans
googlefonts/montserrat
googlefonts/lato-source
googlefonts/material-design-icons
microsoft/fluentui-emoji
twitter/twemoji
emoji-mart/emoji-mart
iamcal/emoji-data
nolanlawson/emoji-picker-element
undraw/undraw
devicons/devicon
konpa/devicon
file-icons/source
```

### Forms Validation Uploads Payments Auth

Count: 39

```text
react-hook-form/react-hook-form
jaredpalmer/formik
final-form/react-final-form
TanStack/form
colinhacks/zod
jquense/yup
ajv-validator/ajv
vinejs/vine
effect-ts/schema
gcanti/io-ts
typestack/class-validator
rjsf-team/react-jsonschema-form
jsonforms/jsonforms
surveyjs/survey-library
formio/formio.js
react-dropzone/react-dropzone
pqina/filepond
transloadit/uppy
dropzone/dropzone
blueimp/jQuery-File-Upload
nextauthjs/next-auth
authjs/authjs
supabase/auth-ui
supabase/supabase
clerk/javascript
lucia-auth/lucia
kinde-oss/kinde-auth-nextjs
logto-io/logto
ory/kratos
ory/hydra
keycloak/keycloak
stripe/stripe-js
stripe/react-stripe-js
stripe-samples/checkout-one-time-payments
stripe-samples/checkout-single-subscription
lemonsqueezy/lemonsqueezy.js
paypal/paypal-js
paddlehq/paddle-js-wrapper
vercel/nextjs-subscription-payments
```

### Testing Accessibility Quality

Count: 39

```text
storybookjs/storybook
chromaui/chromatic
playwright-community/playwright-ct
microsoft/playwright
testing-library/react-testing-library
testing-library/dom-testing-library
vitest-dev/vitest
jestjs/jest
cypress-io/cypress
webdriverio/webdriverio
puppeteer/puppeteer
axe-core/react
dequelabs/axe-core
pa11y/pa11y
GoogleChrome/lighthouse
GoogleChrome/web-vitals
eslint/eslint
typescript-eslint/typescript-eslint
prettier/prettier
stylelint/stylelint
biomejs/biome
oxc-project/oxc
secretlint/secretlint
semgrep/semgrep
reviewdog/reviewdog
danger/danger-js
commitizen/cz-cli
changesets/changesets
release-it/release-it
semantic-release/semantic-release
pnpm/pnpm
yarnpkg/berry
oven-sh/bun
vitejs/vite
vercel/turbo
nx/nx
storybookjs/addon-designs
storybookjs/addon-a11y
storybookjs/addon-interactions
```

---

## Library Selection Output Contract

When the user asks for a UI implementation, return a short selection decision before code unless the user explicitly requests code only.

Use this format:

```text
Page type:
Mood:
Current stack:
Selected base UI:
Selected pattern source:
Selected style source:
Why:
Dependency risk:
Implementation plan:
```

If generating code, include only the dependencies that are needed for the current task.

---

## Review Checklist Before Final Answer

Before finalizing the UI, check:

- Does the UI match the user's requested mood?
- Did you avoid defaulting to AI tech style?
- Did you avoid mixing too many UI systems?
- Is the layout responsive?
- Are form controls accessible?
- Are loading, empty, disabled, and error states handled when relevant?
- Are colors and spacing consistent?
- Is animation useful and not excessive?
- Did you avoid introducing unnecessary dependencies?
- Did you preserve existing project conventions?

---

## Short Prompt Examples

### Warm login page

```text
Build a warm cozy login page using the current stack. First infer the page type and mood, then select suitable GitHub open-source UI resources from Open UI Scout. Avoid dark AI tech style.
```

### Premium SaaS dashboard

```text
Create a premium SaaS dashboard. Use Open UI Scout to select a base UI, dashboard components, and chart/table resources. Keep it clean, production-ready, and responsive.
```

### Editorial landing page

```text
Create an editorial-style landing page. Use large whitespace, strong typography, low-saturation colors, and a magazine-like layout. Do not make it a generic SaaS card grid.
```

### Canvas editor

```text
Design a canvas editor workspace. Use Open UI Scout to choose suitable GitHub resources for the UI shell, canvas engine, resizable panels, and layer/property controls.
```

---

## Final Principle

Open UI Scout is not a fixed UI-library recommendation list.

It is a decision process:

```text
Understand the product.
Understand the page.
Understand the mood.
Inspect the stack.
Score open-source GitHub candidates.
Select a small coherent set.
Generate consistent UI.
Review for style, usability, accessibility, and maintainability.
```
