# AI Lab Builder

This document is the implementation spec for the AI Lab Builder feature: pointing
NetworkChum at an LLM, giving it a plain-English spec, and having it build a
valid lab document. It is written so an agent (or a human) can implement the
feature without re-discovering the codebase. Everything below references real
files, real schemas, and real conventions from the current build.

---

## 1. Feature Summary

- The user describes a lab in natural language ("two CSR routers connected to
  one Ubuntu host, all in one subnet") and clicks **Generate**.
- The API calls the configured LLM with a **network-engineer system prompt**
  that contains the live device catalog (template ids, image bindings, resource
  limits) and a strict JSON output contract.
- The LLM returns a constrained `AiLabSpec` JSON document. The API resolves the
  spec against the real `TemplateRegistry`, clamps resources, assigns node and
  interface ids, builds ethernet segments from the links, and validates the
  whole thing with `LabDocumentSchema.parse()` — the same validation the
  topology import pipeline uses.
- The user previews the resolved lab (nodes, links, any issues), then commits
  it. Commit re-runs the same deterministic builder and creates the lab via
  `createLabFromDocument`, exactly like a topology import commit.

Design rules:

- **The LLM never writes lab documents directly.** It only writes a small spec
  (nodes + links + template hints). The API owns id generation, resource
  clamping, interface assignment, and final validation. This is what makes the
  feature robust: every invalid thing the model can do either fails loudly
  (400/502 with a message) or is deterministically clamped, never persisted
  half-broken.
- **One repair round.** If the model's JSON fails schema validation, the API
  re-prompts once with the validation errors and asks for corrected JSON. A
  second failure is surfaced to the user as a 502, not silently swallowed.
- **The catalog is injected into the prompt**, so the model can only choose
  template ids that actually exist in this installation. Fuzzy matches are
  resolved deterministically and reported as preview issues.
- **Two provider flavors**, per user decision:
  - `openai-compatible` — generic `POST {baseUrl}/chat/completions`. Works with
    OpenAI, OpenRouter, Groq, LM Studio, Ollama, LiteLLM, vLLM, etc. The user
    supplies a base URL that includes the version path (e.g.
    `https://api.openai.com/v1`).
  - `anthropic` — native `POST {baseUrl}/v1/messages` with `x-api-key` and
    `anthropic-version` headers. Base URL without version path (e.g.
    `https://api.anthropic.com`).
- **The API key is stored server-side** in the API data dir (user decision),
  same file-store pattern as every other store. It is never returned to the
  browser; the GET endpoint returns `hasApiKey: true/false` and a masked hint.

---

## 2. Precedent to Mirror

Read these before writing anything; the feature is deliberately shaped to look
like them:

| Concern                                | File to mirror                                                                                                  | Why                                                                                                                                   |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Programmatic lab document construction | `apps/api/src/importers/commitImport.ts` — `buildLabDocumentFromImport`                                         | Canonical "build a valid `LabDocument` from a normalized spec" function. Copy its clamp/interface/network/attachment logic shape.     |
| Two-step preview/commit routes         | `apps/api/src/routes/imports.ts`                                                                                | Route naming, draft handling, 400/404/201 status patterns, `z.object(...).parse()` per handler.                                       |
| Injectable outbound fetcher            | `apps/api/src/runtime/container/dockerHubRegistry.ts` — `searchDockerHub(query, fetcher: typeof fetch = fetch)` | The only existing outbound HTTP call. Same DI pattern applies to the LLM client, which is what makes it testable with a fake fetcher. |
| Server-side JSON store                 | `apps/api/src/templates/templateOverrideStore.ts`                                                               | `getDataFile()` flat-JSON store pattern for the provider settings.                                                                    |
| Route registration                     | `apps/api/src/app.ts` — `buildApp()`                                                                            | New plugin `aiRoutes` gets registered here; deps flow through `AppDependencies`.                                                      |
| Web dialog                             | `apps/web/src/components/ImportTopologyDialog.tsx`                                                              | Props-driven dialog: `open`, `onClose`, `onPreview`, `onCommit`, local `busy`/`error` state, `dialog-overlay` markup.                 |
| API client method                      | `apps/web/src/api/client.ts` — `previewTopologyImport` / `commitTopologyImport`                                 | Plain `fetch` wrappers with `parseResponse`; add four methods the same way.                                                           |
| Route tests                            | `apps/api/src/app.test.ts`                                                                                      | `buildApp()` + `app.inject()`, `mkdtemp` data dir, fake fetcher via `AppDependencies`.                                                |

---

## 3. Shared Schemas

**File: `packages/shared/src/aiLabBuilder.ts`** (new; export from
`packages/shared/src/index.ts` alongside the other domain modules).

```ts
import { z } from "zod";

export const AiProviderKindSchema = z.enum(["openai-compatible", "anthropic"]);

// What the user saves. `apiKey: null` clears a stored key.
export const AiProviderSettingsSchema = z.object({
  provider: AiProviderKindSchema,
  baseUrl: z.string().min(1),
  model: z.string().min(1),
  apiKey: z.string().min(1).nullable(),
  temperature: z.number().min(0).max(2).optional(),
});
export type AiProviderSettings = z.infer<typeof AiProviderSettingsSchema>;

// What GET returns: never the key itself.
export const AiProviderSettingsViewSchema = AiProviderSettingsSchema.omit({
  apiKey: true,
}).extend({ hasApiKey: z.boolean() });
export type AiProviderSettingsView = z.infer<
  typeof AiProviderSettingsViewSchema
>;

// --- The LLM's output contract ---

export const AiLabNodeSpecSchema = z.object({
  name: z.string().min(1),
  templateId: z.string().min(1),
  role: z.string().optional(), // free-text hint, e.g. "core router"
  interfaceCount: z.number().int().positive().optional(),
  vcpu: z.number().int().nonnegative().optional(),
  ramMb: z.number().int().nonnegative().optional(),
});

export const AiLabLinkMemberSchema = z.object({
  node: z.string().min(1), // must match a node name, not an id
  interfaceIndex: z.number().int().nonnegative().optional(),
});

export const AiLabLinkSpecSchema = z.object({
  name: z.string().optional(), // defaults to link-N
  members: z.array(AiLabLinkMemberSchema).min(2),
});

export const AiLabSpecSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  nodes: z.array(AiLabNodeSpecSchema).min(1),
  links: z.array(AiLabLinkSpecSchema).default(() => []),
});
export type AiLabSpec = z.infer<typeof AiLabSpecSchema>;
```

Notes:

- Links are **members of a broadcast segment** (`nodes: ["r1", "r2", "sw1"]` on
  one link = all three share one ethernet segment), matching the
  `attachments` flat edge-list model — one interface ↔ one network. There is no
  point-to-point link type in `NetworkSegmentSchema`; do not invent one.
- `interfaceIndex` is optional so the model can say "R1's Gi0/0 goes to X"
  without the API failing if slots collide — the builder resolves collisions
  deterministically (§5).
- Node identity inside a spec is the **name**, not an id; duplicate node names
  are a validation error with a clear message.

---

## 4. API: Provider Settings

**File: `apps/api/src/ai/providerSettingsStore.ts`** (new)

Follow `templateOverrideStore.ts` exactly:

```ts
import { readFile, writeFile } from "node:fs/promises";
import { getDataFile } from "../storagePaths.js";

function settingsFile(): string {
  return getDataFile("ai-provider.json");
}

export function loadAiProviderSettings(): AiProviderSettings | null { ... }
export function saveAiProviderSettings(settings: AiProviderSettings): void { ... }
```

- Synchronous-style `readFile`/`writeFile` with try/catch returning `null` on
  ENOENT, matching the sibling stores.
- Validate on load with `AiProviderSettingsSchema.safeParse`; ignore broken
  files (return `null`) rather than crashing every route.

**File: `apps/api/src/routes/ai.ts`** (new plugin) — four routes:

| Route                     | Behavior                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /ai/provider`        | 200 `{ provider: AiProviderSettingsView \| null }` — settings with `apiKey` omitted and `hasApiKey` added.                                                                                                                                                                                                                                                              |
| `PUT /ai/provider`        | Body parsed with `AiProviderSettingsSchema` (via `z.object({ provider: ... }).passthrough()` on `request.body`, same style as imports). An `apiKey` of `""` or `null` **preserves** the previously stored key (so the UI can edit other fields without re-entering the key); a non-empty string replaces it. Saves via the store, returns the same view shape as GET.   |
| `POST /ai/provider/probe` | Body `{ provider, baseUrl, apiKey? }` (omitted key falls back to the stored one). Probes the endpoint's model list — `{baseUrl}/models` with fallback to `/v1/models` for OpenAI-compatible servers, `{baseUrl}/v1/models` for Anthropic — and returns `{ models: string[] }` sorted; failures (404 on every path, auth rejection, empty list) are 502 with the reason. |
| `POST /ai/labs/preview`   | Body `{ prompt: string }` (min length 1). Runs the full generation pipeline (§6) and returns 200 `{ preview }`.                                                                                                                                                                                                                                                         |
| `POST /ai/labs/commit`    | Body `{ name: string, spec: AiLabSpec }` validated with `z.object({ name: z.string().min(1), spec: AiLabSpecSchema })`. Runs the **pure** builder (§5) — no LLM call — and returns 201 `{ lab }`, mirroring the import commit.                                                                                                                                          |

Registration in `app.ts`:

```ts
import { aiRoutes } from "./routes/ai.js";
// ...
app.register(aiRoutes, dependencies);
```

The fetcher comes from `AppDependencies.runtime?.fetcher` (already exists in
`AppDependencies`, currently used by `dockerHubRegistry` and container
runtime). Inside the plugin:

```ts
const fetcher = dependencies.runtime?.fetcher ?? fetch;
```

This is the only test seam needed for the LLM — no provider-specific mocking
frameworks, no new dependency types.

**Key handling detail:** the settings file sits in the API data dir next to
`labs.json`. Note in the docs that anything with filesystem access to the data
dir can read it; the API token gate (`x-networkchum-token`) already protects
the route. Do not log the key.

---

## 5. API: The Pure Spec Builder

**File: `apps/api/src/ai/buildLabDocumentFromSpec.ts`** (new)

Pure function, no I/O, fully unit-testable:

```ts
export type ResolvedAiNode = {
  specNodeName: string;
  status: "matched" | "fuzzy-matched" | "unresolved";
  templateId: string | null;
  matchedDisplayName?: string;
  message?: string; // human-readable, surfaces in the preview
};

export type AiLabPreview = {
  labName: string;
  description?: string;
  spec: AiLabSpec; // the normalized, parsed spec
  nodes: Array<ResolvedAiNode>;
  links: Array<{ name: string; members: string[] }>; // resolved member names
  issues: Array<{ message: string }>;
  document: LabDocument | null; // null when any node is unresolved
};

export function buildLabDocumentFromSpec(input: {
  labId: string;
  spec: AiLabSpec;
  templates: Template[];
  images: ImageRecord[];
  accelerationMode?: string | null; // host-detected (kvm/hvf/tcg/none)
  allowedTemplateIds?: Array<string>; // dialog-selected devices
}): AiLabPreview;
```

Resolution algorithm (deterministic, so preview == commit):

1. **Template resolution.** For each node, in order (when
   `allowedTemplateIds` is provided, the searchable catalog narrows to those
   templates and hints resolving outside the selection become unresolved with
   a "among the selected devices" issue):
   1. exact `templates.find(t => t.id === specNode.templateId)`;
   2. else case-insensitive exact on `id` and `displayName`;
   3. else substring/alias match: lowercase `specNode.templateId` matched
      against `id`, `displayName`, `vendor`, and the vendor-role pairs the
      built-in templates use (e.g. `"iosv"` → `cisco-iosv`, `"veos"` →
      `arista-veos`, `"eos"` → `arista-veos`, `"nxos"` → `cisco-nxosv`,
      `"vmx"` → `juniper-vmx`). Keep the alias table small and explicit —
      reuse `suggestTemplateId` (`packages/shared/src/imageSuggestions.ts`)
      only if it already covers a case; do not hand-roll a scorer.
   4. else `unresolved` with `message: 'No template for "<hint>". Available
templates: <comma-separated ids>'`.
2. **Image binding.** `imageId` comes from the image records bound to the
   resolved template (`images.filter(i => i.catalogState === "active" &&
i.templateId === template.id)`, first match), exactly how the catalog pairs
   them (`apps/api/src/catalog/getCatalog.ts`). VM templates with no bound
   image get `imageId: null` and a preview issue: `"Arista vEOS has no bound
image; the node will not power on until an image is bound."` — this mirrors
   how the UI already treats unbound templates. Do **not** let the LLM pick
   image ids.
3. **Config clamping.** Same as `buildLabDocumentFromImport`:
   `vcpu`/`ramMb`/`interfaceCount` clamped into `template.configSchema.*`
   min/max (values out of range or absent fall back to the template default);
   `nicModel` from `template.boot.nicModel`, `accelerationMode` from
   `input.accelerationMode` for qemu templates — the route passes
   `detectAccelerationMode().mode` exactly like the Add Node flow
   (`routes/labs.ts:349`) — and from `template.boot.acceleration` otherwise
   (the static template string like "hardware" is NOT a valid qemu
   `-accel` value), container fields from `template.container`.
4. **Interface assignment.** Interfaces are generated per node as
   `Array.from({ length: interfaceCount }, (_, index) => ({ id:
\`if-${nodeId}-${index}\`, name: template.interfaceNames?.[index] ??
   \`eth${index}\`, slot: index }))`. Link members claiming
`interfaceIndex >= interfaceCount`**grow that node's`interfaceCount`** to
the max claimed slot + 1 (then re-clamped to `template.configSchema
   .interfaceCount.max`, with an issue if the clamp truncated). This is the
   one place where the spec can ask for more interfaces than the node
   declared, and the answer must be deterministic.
5. **Networks and attachments.** One `NetworkSegmentSchema` per spec link:
   `id: \`net-ai-${index}-${randomSuffix()}\`, kind: "ethernet", name:
   link.name ?? \`link-${index + 1}\`, visible: false`. Each member resolves to
the interface id for its claimed slot; duplicate member slots within one
link (two members claiming node R1 eth0) get sequential free slots with a
preview issue. Attachments are `{ interfaceId, networkId }`.
6. **Unresolved short-circuit.** If any node is `unresolved`, return the
   preview with `document: null` and every link listed so the UI can show what
   would have been built. Preview status is 200 (the generation itself
   succeeded); the UI simply won't allow commit.
7. **Validate.** The final document goes through `LabDocumentSchema.parse()`,
   same as `commitImport.ts:172`. A parse failure is a bug in the builder, not
   a user error — let it throw.
8. **Lab id and canvas.** `labId: \`lab-${Date.now()}-${randomSuffix()}\`,
   canvas: { zoom: 1, backgroundImage: null, drawings: [] }, annotations: [],
   startupConfigSets: [], nodeBootActions: [], activeConfigSetId: null` — same
   empty-canvas defaults as imports.

Node positions: lay nodes out in a deterministic grid (e.g.
`{ x: 80 + (i % 4) * 160, y: 80 + Math.floor(i / 4) * 120 }`) so the canvas is
usable immediately; the user drags from there, same as imports.

---

## 6. API: The LLM Client and Prompt

**File: `apps/api/src/ai/llmClient.ts`** (new)

```ts
export type LlmMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export async function callLlm(input: {
  settings: AiProviderSettings;
  messages: LlmMessage[];
  fetcher: typeof fetch;
  maxTokens?: number;
}): Promise<string>;
```

- `openai-compatible`: `POST {baseUrl}/chat/completions`, headers
  `content-type: application/json` + `authorization: Bearer <apiKey>` (omit
  the header when no key — local Ollama/LM Studio setups often need none),
  body `{ model, messages, temperature? }`. Extract
  `choices[0].message.content`.
- `anthropic`: `POST {baseUrl}/v1/messages`, headers `content-type`,
  `x-api-key: <apiKey>`, `anthropic-version: 2023-06-01`, body `{ model,
system, messages, max_tokens (default 4096), temperature? }` where `system`
  is the system message and `messages` the user/assistant turns. Concatenate
  the `text` blocks of `content`.
- Non-2xx → throw `Error` with status + truncated body text; the route turns
  it into a 502 with that message. Timeouts: rely on Node's default fetch
  behavior; do not add a timeout library.
- Also exported: `probeModels({ provider, baseUrl, apiKey, fetcher })` —
  detects the served model list for the dialog's model picker (§8).

**File: `apps/api/src/ai/systemPrompt.ts`** (new)

The system prompt is the product here. Requirements:

1. Persona and scope: the model is a senior network engineer whose _only_ job
   is converting a lab request into the JSON spec. It does not explain, does
   not write configs, does not choose images, does not invent templates.
2. The full JSON contract (§3) inline, plus one fully worked example built
   from the real built-in templates (e.g. two `cisco-xrv9k` routers + one
   `linux-ubuntu-container` host in one subnet, plus a three-router triangle
   with two subnets — show the optional `interfaceIndex` once).
3. The **live catalog**, rendered as one line per template:
   `- cisco-xrv9k — Cisco IOS-XRv 9000 (router, qemu) — interfaces: GigabitEthernet0/0..., vcpu 2, ramMb 4096`
   with the bound image noted, plus the rule: "use `templateId` values from
   this list verbatim; if the user names a device you cannot map, pick the
   closest template and add a `role` note".
4. Hard rules, spelled out: node names unique and simple (no spaces needed —
   but allowed); every link needs ≥ 2 members; members reference node names;
   links without names get numbered automatically; interface counts must fit
   the template limits shown in the catalog; output **only** the JSON object —
   no markdown fences, no commentary.
5. Container templates are always usable; qemu templates only when an image is
   bound (flagged in the catalog lines).

**File: `apps/api/src/ai/generateLabSpec.ts`** (new) — the orchestration the
preview route runs:

```ts
export async function generateLabSpec(input: {
  prompt: string;
  settings: AiProviderSettings;
  templates: Template[];
  images: ImageRecord[];
  fetcher: typeof fetch;
}): Promise<{ spec: AiLabSpec; rounds: number }>;
```

1. Build messages: system prompt (with catalog), user message with the raw
   prompt.
2. Call the LLM, extract JSON: strip code fences if present, take the first
   `{ ... }` balanced block (write a small `extractJsonObject` helper — ~15
   lines, no dependency).
3. `AiLabSpecSchema.safeParse`. On failure **or** a thrown JSON parse: one
   repair round — append the assistant's output as an `assistant` message and
   a `user` message listing the exact validation errors and the rules again.
   A second failure throws `Error("The model did not return a valid lab spec
after a repair round: <first errors>")`; the preview route maps any thrown
   error from this function to 502 with the message.
4. Normalize: trim node names, default link names, drop links referencing
   unknown node names (with the issues preserved in the returned spec so the
   preview can show them — the schema allows unknown names only after this
   normalization, which is why links with unknown members are removed here
   rather than at commit).
5. Return the parsed spec.

---

## 7. API: Preview and Commit Flow

`POST /ai/labs/preview`:

```
parse body { prompt, devices? }            → 400 if missing
settings = loadAiProviderSettings()        → 400 "LLM provider is not configured
                                             yet" with the message the UI shows
if !settings.hasApiKey && provider needs a key → 400 with a clear message
templates = new TemplateRegistry().list()
images = await listImages()
spec = await generateLabSpec(...)          → 502 on provider/JSON failure
preview = buildLabDocumentFromSpec({ labId placeholder, spec, templates, images })
return { preview }
```

`POST /ai/labs/commit`:

```
parse body { name, spec, allowedTemplateIds? }
templates/images as above
preview = buildLabDocumentFromSpec(...)    → if preview.document is null, 400
lab = await createLabFromDocument(preview.labName, preview.document)
return 201 { lab }
```

The lab id is minted at commit time (`lab-${Date.now()}-...`), same as the
import commit at `imports.ts:150`. Preview does not persist anything — no
draft store needed, because the spec itself is the portable draft the UI sends
back on commit.

---

## 8. Web UI

**File: `apps/web/src/components/AiLabBuilderDialog.tsx`** (new) — modeled on
`ImportTopologyDialog.tsx` (props-driven, local `busy`/`error`, returns `null`
when `!open`, reuses `dialog-overlay` / `dialog` / `field` / `btn` classes; add
an `ai-dialog` body class if a wider dialog is needed, mirroring
`.import-dialog` in `theme.css`).

State machine inside the dialog:

1. **Configure** (rendered first, collapsed into an "LLM Provider" section):
   provider select (`openai-compatible` / `anthropic`), base URL, model, API
   key (password input, placeholder `•••• (saved)` when `hasApiKey`), Save
   button → `onSaveProvider(settings)`. Shows the current settings on open via
   `onLoadProvider()`.
2. **Model detection**: when a saved endpoint exists, the dialog probes
   the model list automatically on open (and via a **Detect Models** button
   after any base URL/provider change request) and offers the results as a
   datalist over the free-text model input — pick one or type your own.
3. **Devices**: an optional checkbox list of catalog devices (name +
   image-bound/container status). Selections are sent to preview as
   `devices`, which narrows the system prompt to a hard constraint and the
   builder's resolution to that set; the commit sends the preview's resolved
   template ids back as `allowedTemplateIds` so nothing outside the selection
   can slip in. Changing the selection drops the current preview.
4. **Describe**: textarea for the natural-language spec + "Generate" button →
   `onPreview(prompt)` → shows the preview: lab name, description, node table
   (name, resolved template display name, status, image bound or not) and
   link list, plus `issues` (fuzzy matches, missing images) in an
   `import-issues`-style list. If `document` is `null` (unresolved nodes),
   disable commit and show why.
5. **Commit**: "Create Lab" → `onCommit({ name, spec })`.

**File: `apps/web/src/api/client.ts`** — four methods, exactly the
`previewTopologyImport` pattern:

```ts
async getAiProvider(): Promise<AiProviderSettingsView | null>
async saveAiProvider(settings: AiProviderSettings): Promise<AiProviderSettingsView>
async previewAiLab(prompt: string): Promise<AiLabPreview>
async commitAiLab(input: { name: string; spec: AiLabSpec }): Promise<LabDetails>
```

**File: `apps/web/src/App.tsx`** — mirror the import feature:

- `const [showAiLabBuilderDialog, setShowAiLabBuilderDialog] = useState(false);`
  next to `showImportTopologyDialog` (App.tsx:1266).
- A **"Build with AI"** button in the `panel-actions` block next to "Import
  Lab" (App.tsx:2658), `disabled` when `!api.previewAiLab || !api.commitAiLab`
  — the `ApiClient` interface (App.tsx:244 area) gets the four optional
  methods, so the demo-data fallback keeps working.
- `handleCommitAiLab({ name, spec })` is a copy of
  `handleCommitTopologyImport` (App.tsx:1662): insert lab, select it, close
  the dialog, `setLeftTab("inspector")`.
- Render the dialog next to `<ImportTopologyDialog ...>` (App.tsx:3270) with
  the same guard-and-throw pattern on the optional methods.

---

## 9. Tests

API tests: **`apps/api/src/ai/aiLabBuilder.test.ts`** (new), `pool: "forks"`
already handled by `apps/api/vitest.config.ts`, temp
`NETWORKCHUM_DATA_DIR` via `mkdtemp` like `app.test.ts`:

1. **Unit — the pure builder**: feed `buildLabDocumentFromSpec` a spec with
   exact matches, an alias match (`"iosv"` → `cisco-iosv`), an unresolved
   node, an out-of-range `ramMb` (assert clamped to template max), a link
   claiming `interfaceIndex: 5` on a 4-interface node (assert
   `interfaceCount` grew and ids `if-<node>-5` exist), duplicate member slot,
   and a no-image qemu template (assert `imageId: null` + issue). Assert
   `LabDocumentSchema.parse` accepts every generated document.
2. **Routes through `buildApp()` + `inject`**, with
   `AppDependencies.runtime.fetcher` replaced by a fake that returns canned
   OpenAI/Anthropic-shaped JSON bodies:
   - `PUT /ai/provider` saves settings; `GET /ai/provider` returns
     `hasApiKey: true` and **never** the raw key anywhere in the response
     body (assert with `stringify(...).not.toContain("sk-test")`).
   - `PUT /ai/provider` with empty key preserves the stored key.
   - `POST /ai/labs/preview` happy path: fake fetcher → 200 preview with
     resolved nodes and no issues.
   - Repair round: first fetcher response is invalid JSON, second is valid —
     assert the fake fetcher was called twice and preview is 200.
   - Both rounds invalid → 502 with the validation error text.
   - Provider not configured → 400 with the configured message.
   - Commit → 201, lab retrievable via `GET /labs/:id`, document validates,
     node config clamped. Commit with a spec containing an unknown template → 400.
   - `x-networkchum-token` gate: all four routes 401 without the token when
     `NETWORKCHUM_API_TOKEN` is set (copy the pattern from
     `app.test.ts:2053`).

Web tests: **`apps/web/src/components/AiLabBuilderDialog.test.tsx`** (new),
copying `ImportTopologyDialog.test.tsx`: render with mock `onPreview` /
`onCommit` / `onSaveProvider` / `onLoadProvider` `vi.fn()`s, drive
describe → generate → preview table → commit, assert the disabled states
(no spec yet, unresolved nodes) and that errors render.

Shared: the schema file is declarative (trivial) — no dedicated test file;
the API builder tests cover it end to end.

---

## 10. Verification (definition of done)

```bash
npm run build        # tsc across shared/api/web — run it first and last
npm test             # vitest across packages, api (forks), web, scripts
```

Manual smoke on the real API:

1. `GET /ai/provider` → `{"provider":null}`.
2. In the UI: Labs panel → "Build with AI" → paste a base URL (e.g. LM
   Studio `http://127.0.0.1:1234/v1`) → the model list is detected
   automatically (`POST /ai/provider/probe`); pick a model, save, reload the
   dialog → settings persisted, key masked.
3. Generate from "three routers in a triangle, one ubuntu host attached to
   router 1's second interface, plus a management network with all routers and
   the host" → preview shows 4 nodes, 3 links, all matched; commit → lab opens
   in the inspector with the expected topology; canvas drags work.
4. Generate something with a nonexistent template → preview shows the
   unresolved node, commit disabled.
5. Point the provider at a dead URL → generate shows the provider error
   message, nothing persisted.
6. Repeat with an Anthropic key: base URL `https://api.anthropic.com`, model
   `claude-sonnet-4-5`, verify the same flows.

Non-goals (explicitly out of scope for this feature):

- No LLM-generated device configs (startup-config sets stay human-authored).
- No streaming responses; the builder is one request (+ one repair round).
- No multi-model routing, no usage metering, no chat history — one prompt in,
  one spec out.
- No provider settings UI outside this dialog (no settings page).
