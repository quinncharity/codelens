import { createClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'

import { AnalysisService, StudyService } from '@codelens/proto-ts'

// Default same-origin `/rpc`; set VITE_ANALYZER_BASE_URL (e.g. http://localhost:8080/rpc) for local dev.
const baseUrl =
  import.meta.env.VITE_ANALYZER_BASE_URL ?? '/rpc'

export const transport = createConnectTransport({
  baseUrl,
})

export const analysisClient = createClient(AnalysisService, transport)
export const studyClient = createClient(StudyService, transport)

