# Mobile Copilot Integration Guide (React Native)

This guide is for the **mobile coding agent**. The web app (`technician-copilot`)
has already been migrated to the unified copilot orchestrator with full
block-rendering UX. Your job is to bring the **same features** to the React Native
app.

> **Source of truth.** The contract is identical on both platforms — copy
> [`copilot-contract.ts`](../copilot-contract.ts) into the mobile app. The backend
> behavior is described in [`FRONTEND_INTEGRATION.md`](../FRONTEND_INTEGRATION.md).
> This doc explains *what the web app does* and *how to do the same in RN*. Where
> useful, it names the web file so you can read the reference implementation.

---

## 0. Feature checklist (what to build)

| Feature | Web reference | Mobile notes |
|---|---|---|
| Named-event SSE over POST | `src/services/copilotChatService.ts` | use **`react-native-sse`** (not `fetch` streaming) |
| Typed block renderers (one per `kind`) | `src/components/copilot/blocks/*` | RN components, same switch |
| Markdown rendering | `src/components/copilot/MarkdownContent.tsx` | use `react-native-markdown-display` |
| **Conversation starter prompts** (empty state) | `AskAITab.tsx` / `JobDetailNew.tsx` | chips that send a turn |
| **Stop-generation button** | `AskAITab.tsx` `handleStopStreaming` | abort the SSE connection |
| **Sources & citations** handling | `SourcesBlock.tsx` / `CitationsBlock.tsx` | tappable rows → `Linking.openURL` |
| Equipment **identified** card | `IdentifiedBlock.tsx` | — |
| Estimate **quote** card | `QuoteBlock.tsx` | — |
| **Clarifier questions** — collect ALL, send ONE collective turn | `QuestionsBlock.tsx` | **important: batch, don't send per-answer** |
| **Follow-up suggestion chips** | `FollowUpsBlock.tsx` | tap → send a turn |
| Estimate **actions** (sign / email / download) | `ActionsBlock.tsx` + `useEstimateActions.ts` | use `react-native-signature-canvas` |
| Routing / step **indicators** | `ToolActivityIndicator.tsx` (`StepIndicator`) | — |
| Hide **Sign** after signing | `JobDetailNew.tsx` `markEstimateSigned` | same block-rewrite logic |
| `aria-live` accessibility | `ChatMessage.tsx` | RN: `accessibilityLiveRegion="polite"` |

---

## 1. Transport — `react-native-sse`

`fetch`'s streaming body is unreliable in RN. Use **`react-native-sse`**, which
supports POST + custom headers + **named** event listeners. The backend emits named
SSE frames (`event: chunk`, `event: routing`, …); each frame's JSON `data` payload
*also* carries a `type` field, so you dispatch on the named event.

```ts
// services/copilotStream.ts
import EventSource from "react-native-sse";
import type { CopilotResponse } from "../types/copilot";

const COPILOT_EVENTS = [
  "user_message", "thinking", "routing", "node", "chunk", "tool_call",
  "tool_result", "identified", "message", "citations", "sources",
  "followUps", "quote", "questions", "done", "error",
] as const;

export interface CopilotStreamHandlers {
  onToken: (token: string) => void;
  onThinking?: () => void;
  onRouting?: (route: string, reason?: string) => void;
  onNode?: (node: string, phase?: string) => void;
  onToolCall?: (tool: string) => void;
  onToolResult?: () => void;
  onBlock?: (block: CopilotBlock) => void;            // interim typed blocks
  onComplete: (final?: any, response?: CopilotResponse) => void;
  onError: (err: Error) => void;
}

/** Returns a `close()` you wire to the Stop button + unmount. */
export function streamCopilot(
  baseUrl: string,
  conversationId: string,
  body: { content: string; senderId?: string; mode?: "estimate" | "general"; imageUrls?: string[] },
  headers: Record<string, string>,
  h: CopilotStreamHandlers
): () => void {
  const es = new EventSource(`${baseUrl}/api/v1/copilot/${conversationId}/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
      "X-Device-Timezone": Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
      ...headers, // Authorization / dev-bypass
    },
    body: JSON.stringify(body),
    pollingInterval: 0, // do not auto-reconnect
  });

  const parse = (e: any) => { try { return JSON.parse(e.data); } catch { return {}; } };

  es.addEventListener("chunk", (e: any) => { const d = parse(e); if (d.content) h.onToken(d.content); });
  es.addEventListener("thinking", () => h.onThinking?.());
  es.addEventListener("routing", (e: any) => { const d = parse(e); if (d.route) h.onRouting?.(d.route, d.reason); });
  es.addEventListener("node", (e: any) => { const d = parse(e); if (d.node) h.onNode?.(d.node, d.phase); });
  es.addEventListener("tool_call", (e: any) => { const d = parse(e); if (d.tool) h.onToolCall?.(d.tool); });
  es.addEventListener("tool_result", () => h.onToolResult?.());

  // Interim typed blocks — map each event to its CopilotBlock shape.
  es.addEventListener("identified", (e: any) => { const d = parse(e); if (d.data) h.onBlock?.({ kind: "identified", data: d.data }); });
  es.addEventListener("quote",      (e: any) => { const d = parse(e); if (d.data) h.onBlock?.({ kind: "quote", data: d.data }); });
  es.addEventListener("questions",  (e: any) => { const d = parse(e); const qs = d.questions ?? d.data?.questions; if (qs) h.onBlock?.({ kind: "questions", data: { questions: qs } }); });
  es.addEventListener("citations",  (e: any) => { const d = parse(e); if (d.items) h.onBlock?.({ kind: "citations", items: d.items }); });
  es.addEventListener("sources",    (e: any) => { const d = parse(e); if (d.items) h.onBlock?.({ kind: "sources", items: d.items }); });
  es.addEventListener("followUps",  (e: any) => { const d = parse(e); if (d.items) h.onBlock?.({ kind: "followUps", items: d.items }); });

  es.addEventListener("done", (e: any) => {
    const d = parse(e);
    h.onComplete(d.data, d.response);     // PREFER d.response.blocks as source of truth
    es.removeAllEventListeners(); es.close();
  });
  es.addEventListener("error", (e: any) => {
    h.onError(new Error(parse(e)?.error || "stream error"));
    es.removeAllEventListeners(); es.close();
  });

  return () => { es.removeAllEventListeners(); es.close(); }; // <-- Stop button + unmount
}
```

> Mirrors the web `sendCopilotMessageStreaming` in `src/lib/api.ts`. Same handler
> set, same "`done.response.blocks` is the idempotent source of truth" rule.

---

## 2. State per AI message

Keep the same shape the web uses (see `runCopilotStream` in `JobDetailNew.tsx`):

```ts
type AiMessage = {
  id: string;
  role: "assistant";
  content: string;                 // live streamed markdown
  metadata: {
    blocks?: CopilotBlock[];       // structured blocks (source of truth once present)
    responseKind?: CopilotResponseKind;
    thinkingDuration?: number;
  };
};
```

Reducer rules (one streaming message at a time):

- `chunk` → append to `content`; clear routing/step hints on first token.
- `routing` / `node` → set `routingHint` / `activeNode` (for the StepIndicator).
- `onBlock` → append to the message's `metadata.blocks` (live).
- `done` → **replace** `metadata.blocks` with `response.blocks` if present, else keep
  accumulated; persist the final aiMessage.
- On reload (history `/full`), re-render from `aiMessage.metadata.blocks`.

**Render rule (same as web `ChatMessage.tsx`):** if the message has `metadata.blocks`
and is not currently streaming → render `<CopilotBlocks>`; otherwise render the live
markdown bubble with a cursor.

---

## 3. Block renderers — one component per `kind`

Port `src/components/copilot/blocks/CopilotBlocks.tsx`. Same switch, same
**unknown-kind → markdown + `console.warn`** fallback. Never share a renderer
between kinds.

```tsx
export function CopilotBlocks({ blocks, onSendTurn, onAction, disabled }: Props) {
  return (
    <View style={{ gap: 10 }}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "markdown":   return <MarkdownBlock key={i} text={b.text} />;
          case "citations":  return <CitationsBlock key={i} items={b.items} />;
          case "sources":    return <SourcesBlock key={i} items={b.items} />;
          case "identified": return <IdentifiedBlock key={i} data={b.data} />;
          case "quote":      return <QuoteBlock key={i} data={b.data} />;
          case "questions":  return <QuestionsBlock key={i} questions={b.data.questions} onSendTurn={onSendTurn} disabled={disabled} />;
          case "followUps":  return <FollowUpsBlock key={i} items={b.items} onSendTurn={onSendTurn} disabled={disabled} />;
          case "actions":    return <ActionsBlock key={i} items={b.items} onAction={onAction} disabled={disabled} />;
          default:
            console.warn("[CopilotBlocks] unknown kind", (b as any).kind);
            return <MarkdownBlock key={i} text={(b as any).text ?? JSON.stringify(b)} />;
        }
      })}
    </View>
  );
}
```

Callbacks are threaded by props: `onSendTurn(content)` (questions + follow-ups) and
`onAction(action)` (estimate actions). Markdown: use
**`react-native-markdown-display`** in `MarkdownBlock`.

### Sources & citations (tappable)

Port `SourcesBlock.tsx` / `CitationsBlock.tsx`. Each row opens its `url`:

```tsx
import { Linking } from "react-native";
// sources: file/web icon + title; citations: "NFPA 25 §5.2" — title
<Pressable onPress={() => item.url && Linking.openURL(item.url)}>
  <Text>{label}</Text>
</Pressable>
```

- **Citations** format: `[standard] [code] §[section] — title` (web `formatRef`).
- **Sources** show a file vs. web icon by `item.type` and a title; open `url` if set.
- Only render the row as tappable when `url` exists.

---

## 4. Clarifier questions — collect ALL, send ONE collective turn

**Important behavior (matches the latest web `QuestionsBlock.tsx`):** do **not**
send a turn the moment one question is answered. Collect answers for **every**
question in the group, then send a **single collective turn**.

- Each question accepts an option chip **or** a free-text "Other" entry; answers stay
  editable until submit.
- A **"Send answers"** button is enabled only when **all** questions are answered.
- On submit, compose **one** `content` string and call `onSendTurn` once:
  - 1 question → send the chosen `option.value`.
  - N questions → join `` `${question}\n→ ${answer}` `` pairs with blank lines.
- Lock the whole group after submit (and while a newer turn streams).

```ts
const allAnswered = questions.every(q => !!answers[q.id]?.trim());
const content = questions.length === 1
  ? answers[questions[0].id]
  : questions.map(q => `${q.question}\n→ ${answers[q.id]}`).join("\n\n");
onSendTurn(content); // single call
```

This ensures the copilot receives the full set of answers in one pass and can
generate the complete quotation, instead of getting them piecemeal.

### Follow-up chips (separate, optional)

`FollowUpsBlock` is different — each chip is an **independent** suggestion that
**immediately** sends a new turn with `chip.prompt`. Don't batch these.

---

## 5. Conversation starter prompts (empty state)

Mirror the web empty state (`AskAITab.tsx` / `JobDetailNew.tsx`). When there are no
messages, show 3–4 starter chips; tapping one calls the same `handleSendTurn`.

```tsx
const COPILOT_STARTERS = [
  "What's the fault code on this panel mean?",
  "How do I reset this device?",
  "What would it cost to replace this unit?",
  "Show me the inspection steps for this asset.",
];

{messages.length === 0 && (
  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
    {COPILOT_STARTERS.map(s => (
      <Pressable key={s} onPress={() => handleSendTurn(s)} style={chipStyle}>
        <Text>{s}</Text>
      </Pressable>
    ))}
  </View>
)}
```

`handleSendTurn(content)` just starts a normal new turn — same path as typing and
sending.

---

## 6. Stop-generation button

Mirror `handleStopStreaming` (web `JobDetailNew.tsx` / `AskAITab.tsx`). While a turn
is streaming, show a **Stop** button; pressing it calls the `close()` returned by
`streamCopilot` and clears the streaming state.

```tsx
const closeRef = useRef<null | (() => void)>(null);

function send(content: string) {
  closeRef.current?.(); // abort any in-flight stream
  closeRef.current = streamCopilot(baseUrl, convoId, { content, senderId }, authHeaders, handlers);
}

function handleStopStreaming() {
  closeRef.current?.();
  closeRef.current = null;
  setStreamingId(null);
  setIsThinking(false);
  setActiveTool(null);
  setRoutingHint(null);
  setActiveNode(null);
}

{streamingId && (
  <Pressable onPress={handleStopStreaming} style={stopPillStyle}>
    <Text>■ Stop</Text>
  </Pressable>
)}
```

Also call `closeRef.current?.()` on screen unmount.

---

## 7. Routing / step indicators

Port `StepIndicator` + `getNodeLabel` / `getRouteHint` from
`ToolActivityIndicator.tsx`. Precedence while streaming (same as web):

1. `activeTool` → tool chip ("Searching technical manuals…")
2. else `activeNode` or `routingHint` → `StepIndicator` ("Identifying…", "Building quote…")
3. else `isThinking` → "Thinking…"

`NODE_LABELS` / route hints are friendly-label maps; unknown nodes render nothing.
**Confirm the backend's actual node names** and tune the map (the web map is a best
guess).

---

## 8. Estimate actions (sign / email / download)

Port `ActionsBlock.tsx` + the `useEstimateActions` hook. Each `ActionItem` carries
`actionType` + `endpoint` + `method`. Parse `cid`/`mid` from the endpoint:
`/copilot/(cid)/estimate/(mid)/…`.

- **`sign_estimate`** → open a signature modal using **`react-native-signature-canvas`**;
  it yields a PNG **data URL** → `POST /copilot/:cid/estimate/:mid/sign`
  `{ signatureBase64, signatureMimeType: "image/png", signerName? }` →
  `{ url, directUrl, estimateNumber, suggestedCustomerEmail }`.
- **`email_estimate`** → small modal prefilled with `suggestedCustomerEmail` →
  `POST /…/email { to }`.
- **`download_pdf`** → `Linking.openURL(`${base}/api/v1/copilot/:cid/estimate/:mid/pdf?inline=1`)`
  (open in browser) or download + Share sheet.
- The PDF only exists **after** signing; email/download return **409** until then —
  surface that as a toast.

### Hide the Sign button after signing (don't skip this)

Mirror `markEstimateSigned` (web `JobDetailNew.tsx`). After a successful sign, the
`actions` block still contains `sign_estimate`, so you must **rewrite that message's
blocks**:

1. In the `quote` block → set `data.signed = true` and `estimateNumber` from the sign
   response (the QuoteBlock then shows a "Signed" badge).
2. In the `actions` block → **remove `sign_estimate`** and ensure `email_estimate` +
   `download_pdf` are present.

```ts
function markEstimateSigned(blocks, res, cid, mid) {
  return blocks.map((b) => {
    if (b.kind === "quote")
      return { ...b, data: { ...b.data, signed: true, estimateNumber: res.estimateNumber ?? b.data.estimateNumber } };
    if (b.kind === "actions") {
      const items = b.items.filter(a => a.actionType !== "sign_estimate");
      if (!items.some(a => a.actionType === "email_estimate"))
        items.push({ id: "email_estimate", label: "Email to customer", actionType: "email_estimate", endpoint: `/api/v1/copilot/${cid}/estimate/${mid}/email`, method: "POST", style: "primary" });
      if (!items.some(a => a.actionType === "download_pdf"))
        items.push({ id: "download_pdf", label: "Download PDF", actionType: "download_pdf", endpoint: `/api/v1/copilot/${cid}/estimate/${mid}/pdf`, method: "GET", style: "secondary" });
      return { ...b, items };
    }
    return b;
  });
}
```

Wire it via an `onSigned(messageId, res)` callback (web does this through
`useEstimateActions`) that updates the message in state. This is an optimistic
update; a later `/full` refetch reconciles with the server's persisted blocks.

---

## 9. Request body & headers

`POST /api/v1/copilot/:conversationId/stream`

```jsonc
{ "content": "…", "senderId": "…",
  "mode": "estimate|general",      // optional explicit toggle
  "imageUrls": ["…"], "selectedImageIds": ["…"], "images": ["data:image/…"] }
```

Always send header `X-Device-Timezone` (IANA tz) plus your auth header. Images:
image picker → presigned upload → pass `imageUrls`/`selectedImageIds`, or inline
small photos via `images` (data URLs).

---

## 10. Accessibility

On the streaming text container, set `accessibilityLiveRegion="polite"` (Android) /
rely on VoiceOver announcing appended text (iOS) — the RN equivalent of the web
`aria-live="polite"`.

---

## Suggested libraries

| Need | Library |
|---|---|
| SSE over POST | `react-native-sse` |
| Markdown | `react-native-markdown-display` |
| Signature pad | `react-native-signature-canvas` |
| Open links / PDF | `Linking` (built-in) or `expo-web-browser` |
| Icons | `lucide-react-native` (matches web icon set) |

---

## Definition of done

- [ ] SSE via `react-native-sse`, dispatching all 15 named events.
- [ ] All 8 block kinds render (one component per kind) with the unknown-kind fallback.
- [ ] Sources & citations rows open their URLs.
- [ ] Clarifier questions **collect all answers, then send one collective turn**.
- [ ] Follow-up chips send a turn each on tap.
- [ ] Conversation starter chips in the empty state.
- [ ] Stop button aborts the stream mid-generation.
- [ ] Routing/step indicators show during streaming.
- [ ] Sign → signature pad → quote shows Signed; **Sign button is gone**, email +
      download appear; 409s surfaced before signing.
- [ ] Reload re-renders blocks from `metadata.blocks`.
