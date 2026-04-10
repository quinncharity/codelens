import { createClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'

import { AnalysisService, StudyService } from '@codelens/proto-ts'

// In production (Vercel) the API lives at /rpc on the same origin.
// In local dev the .env file overrides this to http://localhost:8080/rpc.
const baseUrl =
  import.meta.env.VITE_ANALYZER_BASE_URL ?? '/rpc'

export const transport = createConnectTransport({
  baseUrl,
})

export const analysisClient = createClient(AnalysisService, transport)
export const studyClient = createClient(StudyService, transport)

