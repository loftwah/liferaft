declare module 'html-to-text' {
  export function compile(options: {
    wordwrap: number | false
    limits: { maxDepth: number; maxChildNodes: number }
    selectors: {
      selector: string
      format?: string
      options?: { ignoreHref: boolean }
    }[]
  }): (html: string) => string
}
