/** Observe only the utility process created for this import. */
export function observeImportProcess(process: {
  once(event: 'exit', listener: () => void): unknown
  kill(): boolean
}) {
  let hasExited = false
  const exited = new Promise<void>((resolve) => {
    process.once('exit', () => {
      hasExited = true
      resolve()
    })
  })

  return {
    exited,
    async stop(timeoutMs = 5000): Promise<void> {
      if (hasExited) return
      process.kill()
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          exited,
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => {
              reject(
                new Error(
                  'The importer has not stopped yet. Leave Liferaft open and try again.'
                )
              )
            }, timeoutMs)
          })
        ])
      } finally {
        if (timeout) clearTimeout(timeout)
      }
    }
  }
}
