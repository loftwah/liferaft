declare module 'mailparser' {
  import { Writable } from 'node:stream'

  export class MailParser extends Writable {
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
          | { type: 'attachment'; release: () => void }
      ) => void
    ): this
  }
}
