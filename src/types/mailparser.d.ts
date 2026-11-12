declare module 'mailparser' {
  import { Readable, Transform } from 'node:stream'

  export class MailParser extends Transform {
    constructor(options?: Record<string, unknown>)
    on(
      event: 'headers',
      listener: (headers: Map<string, unknown>) => void
    ): this
    on(
      event: 'data',
      listener: (
        data:
          | { type: 'text'; text?: string; html?: string | null }
          | { type: 'attachment'; content: Readable; release: () => void }
      ) => void
    ): this
  }
}
