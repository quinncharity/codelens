import { createClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'

import { AnalysisService } from '@codelens/proto-ts'

const baseUrl =
  import.meta.env.VITE_ANALYZER_BASE_URL ?? 'http://localhost:8080/rpc'

export const transport = createConnectTransport({
  baseUrl,
})

export const analysisClient = createClient(AnalysisService, transport)

