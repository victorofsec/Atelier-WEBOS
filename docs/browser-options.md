# Browser compatibility

Atelier keeps web pages on a separate engine origin. Both sides of the message bridge must explicitly allow the desktop's actual origin. Changing the desktop domain without updating the engine breaks startup before any website request can run. The hosted engine now accepts the active custom domain and the original hosted address. The local edition accepts only its two loopback origins.

## Alternatives reviewed

- [Browser.js](https://github.com/HeyPuter/browser.js): an embeddable browser environment. Its [development server](https://github.com/HeyPuter/browser.js/blob/main/devserver.ts) supplies Wisp networking. Replacing the interface alone does not provide that transport.
- [Firefox WebAssembly](https://github.com/HeyPuter/firefox-wasm): Gecko running inside the browser, with Wisp networking. Its build requires Linux; this is a separate engine and deployment project, not a drop-in script.
- [Ultraviolet](https://github.com/titaniumnetwork-dev/Ultraviolet): its maintainers identify Scramjet as its successor. Switching to it would not remove the network transport requirement.

The hosted installation currently uses Scramjet with an authenticated HTTP relay. It does not provide Wisp TCP networking, WebSocket-dependent websites or guaranteed compatibility with anti-bot checks. The relay requires sign-in. No third-party public proxy is silently used for browsing or credentials.
