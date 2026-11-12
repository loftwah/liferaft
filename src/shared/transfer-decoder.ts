import { PassThrough, Transform } from 'node:stream'

export function decoderForTransferEncoding(encoding: string | null): Transform {
  const normalized = (encoding ?? '').trim().toLowerCase()

  if (normalized === 'base64') return new Base64DecodeTransform()
  if (normalized === 'quoted-printable')
    return new QuotedPrintableDecodeTransform()
  return new PassThrough()
}

class Base64DecodeTransform extends Transform {
  private carry = ''
  private padded = false

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    const incoming = chunk.toString('latin1').replace(/[ \t\r\n]/g, '')
    const sanitized = `${this.carry}${incoming}`
    if (
      /[^A-Za-z0-9+/=]/.test(sanitized) ||
      (this.padded && incoming.length > 0)
    ) {
      callback(new Error('The attachment contains invalid base64 data.'))
      return
    }
    const usableLength = sanitized.length - (sanitized.length % 4)
    if (usableLength > 0) {
      const encoded = sanitized.slice(0, usableLength)
      const padding = encoded.indexOf('=')
      if (padding >= 0) {
        if (
          usableLength !== sanitized.length ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)$/.test(
            encoded
          )
        ) {
          callback(new Error('The attachment contains invalid base64 padding.'))
          return
        }
        this.padded = true
      }
      this.push(Buffer.from(encoded, 'base64'))
    }
    this.carry = sanitized.slice(usableLength)
    callback()
  }

  override _flush(callback: (error?: Error | null) => void): void {
    if (this.carry.length === 1 || this.carry.includes('=')) {
      callback(new Error('The attachment contains incomplete base64 data.'))
      return
    }
    if (this.carry.length > 0) this.push(Buffer.from(this.carry, 'base64'))
    callback()
  }
}

/** Decode bytes incrementally; quoted-printable attachments may be binary. */
class QuotedPrintableDecodeTransform extends Transform {
  private carry: Buffer = Buffer.alloc(0)

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    this.decode(Buffer.concat([this.carry, chunk]), false)
    callback()
  }

  override _flush(callback: (error?: Error | null) => void): void {
    this.decode(this.carry, true)
    callback()
  }

  private decode(source: Buffer, final: boolean): void {
    const output = Buffer.allocUnsafe(source.length)
    let written = 0
    let index = 0
    for (; index < source.length; index += 1) {
      if (source[index] !== 0x3d) {
        output[written++] = source[index]!
        continue
      }
      if (!final && index + 2 >= source.length) break
      if (source[index + 1] === 0x0a) {
        index += 1
      } else if (source[index + 1] === 0x0d && source[index + 2] === 0x0a) {
        index += 2
      } else {
        const high = hexDigit(source[index + 1])
        const low = hexDigit(source[index + 2])
        if (high >= 0 && low >= 0) {
          output[written++] = high * 16 + low
          index += 2
        } else {
          output[written++] = source[index]!
        }
      }
    }
    this.carry = Buffer.from(source.subarray(index))
    if (written > 0) this.push(output.subarray(0, written))
  }
}

function hexDigit(byte: number | undefined): number {
  if (byte === undefined) return -1
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10
  return -1
}
