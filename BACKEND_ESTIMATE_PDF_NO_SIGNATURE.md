# Backend task: remove estimate signing, generate the PDF directly

**Repo:** `copilot-server` (deployed at `https://techcopilot-assistant.justclara.ai`)
**Requested by:** the mobile app (`field-native`, branch `feat/estimate-cost-demo`), which has
already been changed to match this spec.

## Goal

A quote turn no longer needs a customer signature. The technician taps **Generate PDF**. The
server renders the final quotation PDF (without a signature), stores it in S3, and returns a link.
Download, inline preview and email then work exactly as they do today after signing.

## What the mobile app now does

1. Receives the quote through the stream (`quote` event + `done`). It **ignores**
   `done.requiresSignature`.
2. On **Generate PDF**, it calls:
   ```
   POST /api/v1/copilot/:conversationId/estimate/:messageId/generate
   Content-Type: application/json
   Body: {}
   ```
3. It reads `data.url`, `data.key`, `data.filename`, `data.estimateNumber`, `data.generatedAt` and
   `data.suggestedCustomerEmail`. If `data.url` is missing, it treats the call as failed.
4. It opens `GET …/estimate/:messageId/pdf?inline=1` in a WebView, and uses `data.url` for
   Share/Save.
5. **Send email** calls the existing `POST …/estimate/:messageId/email` with `{ to }`.
6. When the app loads chat history, it shows a quote as "PDF ready" when `metadata.quote.pdfKey`
   is set. Quotes signed under the old flow already have `pdfKey`, so they keep working.

Until this endpoint is deployed, **Generate PDF** shows an error alert: the route returns 404.

## Required changes

### 1. New endpoint: `POST /:conversationId/estimate/:messageId/generate`

- **Route:** add it in `src/api/routes/estimate.route.ts`.
- **Validation:** add an `estimateGenerateSchema` in `src/api/schemas/estimate.schema.ts`. It takes
  `conversationId` and `messageId` as UUID params, and the body is an empty object with passthrough
  (it takes no fields).
- **Handler:** `EstimateController.generate` in `src/api/controllers/estimate.controller.ts`. Build
  it from the current `sign` handler with every signature step removed:
  - The 404 and 409 checks stay as they are: message not found or in another conversation → 404;
    not an estimate quote turn → 409. Accept either `meta.mode === "estimate"` or
    `meta.route === "estimate"`, the same as `previewPdf` does. The unified `/stream` route stores
    `route`, and today `sign` only checks `mode`.
  - Remove `decodeSignature` and the 400 "Invalid or empty signature image" response.
  - Call `buildQuotePdf({ quote, header, estimateNumber, date: generatedAt, thumbnail, photos })`
    with **no `signature` field**.
  - Upload the PDF to the same S3 key, `estimates/${conversationId}/${messageId}.pdf`, with the same
    `Content-Disposition`.
  - Persist to message metadata by merging, as `sign` does: `quote.pdfKey`, `quote.estimateNumber`,
    `quote.pdfGeneratedAt` (ISO) and `quote.suggestedCustomerEmail`. **Do not** set `signed`,
    `signedAt` or `signerName`.
  - Calling it again regenerates the PDF and overwrites it. That behaviour is intended.

**Response:**

```json
{
  "success": true,
  "data": {
    "url": "<permanent …/estimate/:messageId/pdf link>",
    "directUrl": "<presigned S3 link, up to 7 days>",
    "key": "estimates/<conversationId>/<messageId>.pdf",
    "filename": "Estimate-E0ABC12.pdf",
    "estimateNumber": "E0ABC12",
    "generatedAt": "2026-09-28T18:30:00.000Z",
    "suggestedCustomerEmail": "customer@example.com"
  }
}
```

**Errors:** `404` if the message is not found, `409` if the message isn't an estimate quote turn,
and `500` for anything else. All use the existing `{ success: false, error: { status, message } }`
shape.

### 2. Remove the "Customer Signature" block from the PDF

In `src/copilot/estimate/pdf/quotePdf.ts`, the section under `// ---- Signature (left, beside
totals) ----` always draws a signature line and a "Customer Signature" caption, even when there's
no `signature`. Remove the whole block, along with the `signature` input field and its doc comment.
The final PDF should show no signature area.

### 3. Stop asking for a signature in stream responses

- In `src/api/controllers/estimate.controller.ts` (`stream`, the `done` event), remove
  `requiresSignature`. Also update the comments that say a quote must be signed before its PDF is
  generated.
- In `src/api/controllers/copilot.controller.ts` (`stream`, the `done` event), remove
  `requiresSignature`.
- In the same file, change `quoteActions()` to replace the `sign` action:
  ```ts
  { id: "generate", label: "Generate PDF", actionType: "generate_pdf", endpoint: `${base}/generate`, method: "POST", style: "primary" },
  ```
  Also rename the `pdf` action's label from "Download signed PDF" to "Download PDF".
- In `src/copilot/orchestrator/responseContract.ts`, replace `"sign_estimate"` with
  `"generate_pdf"` in `CopilotActionType`. In `QuoteBlockData`, replace `signed?: boolean` with
  `pdfGeneratedAt?: string`.

### 4. Remove the old signing endpoint

- Remove the `POST …/estimate/:messageId/sign` route, `EstimateController.sign`,
  `estimateSignSchema` and `decodeSignature`.
- **Check first:** the web client (`technician-copilot`, `src/hooks/useEstimateActions.ts` and
  `src/services/copilotChatService.ts`) still calls `/sign` and renders a signature pad. Either
  migrate it to `/generate` in the same release, or keep `/sign` temporarily as a deprecated alias
  that ignores the signature and runs the `generate` logic. Don't break it silently.

### 5. Wording that still says "signed"

- `downloadPdf`: change the 409 message to "No PDF yet — generate it first.", and update the doc
  comment.
- `emailEstimate`: change the 409 message to "Generate the PDF first — no PDF to email yet.", and
  update the doc comment.
- `previewPdf`: its comments describe it as a preview "before committing a signature". Reword them
  to say "before generating the PDF". The endpoint itself stays.
- `src/copilot/estimate/email/estimateEmailTemplate.ts`: change "The full signed quotation is
  attached" (in both the HTML and the text body) to "The full quotation is attached". Also update
  the header comment.
- Update the `estimate.route.ts` route descriptions to match.
- Update `docs/COPILOT_ESTIMATE_FRONTEND.md` and `FRONTEND_INTEGRATION.md`. Replace the
  "Signing the estimate" section with the `generate` contract above, and drop `requiresSignature`
  from the event table.

## Acceptance checks

1. Stream a quote. The `done` event has no `requiresSignature`, and the unified `/stream` `actions`
   block contains `generate_pdf`, not `sign_estimate`.
2. `POST …/generate` with body `{}` returns 200 with the fields above. S3 now has
   `estimates/<conv>/<msg>.pdf`, and the message metadata has `quote.pdfKey` and
   `quote.pdfGeneratedAt`.
3. The generated PDF has **no** signature line and no "Customer Signature" caption.
4. `GET …/pdf` and `GET …/pdf?inline=1` stream the PDF.
5. `POST …/email` with `{ to }` sends the email with the PDF attached. The email copy doesn't say
   "signed".
6. `POST …/generate` on a non-quote message returns 409. With an unknown `messageId` it returns 404.
7. A quote signed under the old flow (it already has `pdfKey`) still downloads and emails.
8. `npm test` passes. That runs typecheck plus the `check:*` scripts.
9. After deploying to `techcopilot-assistant.justclara.ai`, tapping **Generate PDF** in the mobile
   app opens the PDF preview.
