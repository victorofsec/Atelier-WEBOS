# Atelier isolated browser engine

Static runtime for Scramjet 1.1.0 and BareMux 2.1.9. This origin contains no Atelier account credentials, files, or independent relay. Only its configured Atelier parent supplies authenticated HTTP networking through a narrow postMessage bridge. Browsing cookies/storage live on this isolated origin, separately from the desktop. WebSocket and DRM are not supported by this HTTP-only transport.

Run `node build.mjs` after installing the root project dependencies. Output: `dist/`. Do not serve these files on the desktop origin: proxied JavaScript must remain isolated. The host iframe must prohibit top navigation and popups.

Engine integration files are provided under AGPL-3.0-or-later; see LICENSE.txt in the published runtime. Corresponding source is downloadable as `/source.zip`. Unmodified dependency source for these exact releases:

- https://github.com/MercuryWorkshop/scramjet/tree/57ba89e (npm @mercuryworkshop/scramjet@1.1.0)
- https://github.com/MercuryWorkshop/bare-mux/tree/dc9dc6e (npm @mercuryworkshop/bare-mux@2.1.9)

The exact upstream source releases are available at the links above.

The parent relay never forwards the parent session's cookies or identity headers. It checks public DNS results and restricts targets to public HTTP(S) names on standard ports; requests follow no server-side redirects. DNS validation is not IP pinning. Production requires the host's public-only egress boundary; do not expose this relay on a server with private-network access without an egress firewall.

Performance update: diagnostic error interception and source maps are disabled. Proxy addresses are unwrapped before navigation to avoid recursive encoding. The transport deduplicates simultaneous GETs and keeps at most 16 MB / 128 explicitly cacheable static responses for up to five minutes. Cache keys include the complete outgoing headers, and private/no-store/no-cache responses and Set-Cookie responses are excluded. The parent uses gzip packets and coalesces public DNS checks, respecting TTLs up to 30 seconds. HTML anti-bot challenges returned instead of JavaScript are reported as blocked resources; they are not parsed as JS or silently retried.
