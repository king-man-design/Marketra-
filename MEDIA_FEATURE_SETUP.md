# Marketra media features

Added voice transcription and marketing-video analysis to the existing Marketra chat.

## New frontend controls
- Microphone button: records voice in the browser, sends it to the backend, and puts the transcript into the existing chat input for review before sending.
- Video button: selects an MP4/WebM/MOV video up to 50 MB and returns a Gemini marketing analysis inside the existing chat.

## New API endpoints
- `POST /api/media/transcribe`
- `POST /api/media/analyze-video`

Media is sent as JSON/base64 so no multipart upload dependency is required. The existing server-side `GEMINI_API_KEY` is reused.

## Render
No new API key is required. Keep `GEMINI_API_KEY` configured in Render. Optional `AI_MEDIA_MODEL` can override the model used for media; otherwise `AI_MODEL` is used.

## Limits
Maximum media size is 50 MB. Media endpoints are limited to 5 requests/minute/IP.
