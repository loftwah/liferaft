import { Transform } from 'node:stream'

export function isMboxSeparatorLine(line: Buffer): boolean {
  return (
    line.length >= 5 &&
    line[0] === 0x46 &&
    line.subarray(0, 5).toString('utf8') === 'From '
  )
}

export function unescapeMboxRdLine(line: Buffer): Buffer {
  let index = 0
  while (index < line.length && line[index] === 0x3e) {
    index += 1
  }

  if (
    index > 0 &&
    line.subarray(index, index + 5).toString('utf8') === 'From '
  ) {
    return Buffer.concat([line.subarray(1)])
  }

  return line
}

export class MboxRdUnescapeTransform extends Transform {
  private buffered: Buffer = Buffer.alloc(0)

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    const data =
      this.buffered.length > 0 ? Buffer.concat([this.buffered, chunk]) : chunk
    let lineStart = 0

    for (let index = 0; index < data.length; index += 1) {
      if (data[index] !== 0x0a) {
        continue
      }

      const line = data.subarray(lineStart, index + 1)
      this.push(unescapeMboxRdLine(line))
      lineStart = index + 1
    }

    this.buffered = Buffer.from(data.subarray(lineStart))
    callback()
  }

  override _flush(callback: (error?: Error | null) => void): void {
    if (this.buffered.length > 0) {
      this.push(unescapeMboxRdLine(this.buffered))
    }

    callback()
  }
}
