# SDK stdio integration experiment

This bridge exercises the experimental grouping contract through the repository's locked MCP TypeScript SDK (1.27.1 at implementation time) and actual stdio pipes. It does not change the SDK's published API, claim acceptance of the extension, or add a production server.

From the repository root:

```sh
npm ci --prefix sdk/typescript
node --test sdk/typescript/experiments/grouping/transport.checks.mjs
node --test sdk/typescript/experiments/grouping/host.checks.mjs
node experiments/deterministic-groups/conformance/run.mjs sdk/typescript/experiments/grouping/adapter.mjs
```

## Data flow

```text
portable suite -> async adapter -> SDK Client -> stdio -> SDK Server
                                                       -> reference handlers
```

`Client.connect()` and the SDK server perform the real initialize/initialized handshake. The adapter's later synthetic initialize query returns the negotiated capabilities; it does not send a second initialize request. The SDK correlates actual wire request IDs; the adapter
restores the harness ID on return. Therefore the portable envelope-ID assertions alone do not prove raw wire-ID correctness.

Draft methods are registered with explicit experimental request schemas. Standard `tools/list` and `tools/call` retain their names. No change is made to an installed SDK dependency, and unknown capabilities are not assumed to be stable protocol.

## Fixture control and notification scope

### Draft capability compatibility

SDK 1.27.1 filters unknown fields inside negotiated `tools` capabilities, including draft `tools.manifest`. Earlier direct-method server checks did not detect a Host falling back to `tools/list`. The asynchronous Host checks exposed this gap. The bridge now advertises
`experimental["experimental/deterministic-groups"] = {version: 1, manifest: true}`. The Host requires version 1 and either this explicit experimental opt-in or preserved `tools.manifest: true`. Otherwise it uses the legacy path. No dependency is patched; this is not native SDK
support for SEP-2636.

### Asynchronous Host lifecycle

`host.mjs` implements selective discovery, digest/size/membership verification, atomic registration and original-name invocation. A generation counter prevents late responses from restoring registrations after notifications, disconnects or newer activations. Five Host tests
exercise selection, switching, eviction, late-response races and legacy fallback over stdio. The provider-shaped registry remains in memory: no external model API or production Host has accepted it. Clearing this registry cannot recall already submitted provider requests.

### Test fixture updates

Each adapter owns a fresh temporary directory and a mode-0600 JSON fixture file. The child reads this test-only file; atomic replacement changes fixture state or the authorized session view out of band. No MCP method accepts fixture mutations or authentication identities. These
are synthetic permissions, not production authentication or OAuth.

The bridge refreshes its view on each request. The adapter sends a standard ping after changing the file to make the refresh deterministic. The server emits a real `notifications/tools/list_changed` before replying when the visible revision changes, and the SDK client's
registered notification handler receives it. Directory-only changes conservatively use that same notification in this bridge; the group's final notification contract remains an open review decision.

This proves notification delivery over stdio after an explicit synchronization barrier. It does not prove unsolicited filesystem watching, TTL scheduling, provider-native registration eviction, or atomic discovery-to-call behavior.

## Evidence and limitations

- All 16 portable checks run across real subprocess requests (serialization vectors still run locally). The business logic is the original reference implementation.
- A dedicated test checks the server identity from the handshake, a distinct child PID, authorization-change notification, rejection of a revoked tool, a surviving tool call, no duplicate notification for an unchanged view, and child exit.
- Requests have five-second timeouts; tests have bounded deadlines; adapters close the SDK client and remove their own temporary fixtures.
- No HTTP transport, real model-provider API, second language implementation, pagination or production security behavior has been certified.
- The original dependency-free suite remains runnable without installing the SDK.

This is an additional integration layer, not a replacement for the pending gates in the [portable contract](../../../../experiments/deterministic-groups/conformance/README.md).
