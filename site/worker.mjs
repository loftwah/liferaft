const origin = 'https://liferaft.loftwah.com'

export default {
  fetch(request, env) {
    const url = new URL(request.url)
    if (url.origin !== origin) {
      if (url.hostname === 'liferaft.loftwah.com' && url.protocol === 'http:') {
        return Response.redirect(origin + url.pathname + url.search, 308)
      }
      return new Response('Not found', {
        status: 404,
        headers: { 'X-Robots-Tag': 'noindex' }
      })
    }
    return env.ASSETS.fetch(request)
  }
}
