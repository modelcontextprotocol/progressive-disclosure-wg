# Portable experimental checks

This directory defines a versioned, implementation-independent **test adapter
contract**. It does not define an official MCP conformance certification.
`suite.mjs` imports no reference Host, Server, fixture factory or digest function.
It consumes `fixture.json`, sends JSON-RPC-shaped requests through an asynchronous
adapter, and checks responses against fixture-derived expectations.

## Run an implementation

```sh
node experiments/deterministic-groups/conformance/run.mjs
node experiments/deterministic-groups/conformance/run.mjs /absolute/path/to/your-adapter.mjs
node --test experiments/deterministic-groups/conformance/suite.test.mjs
```

The runner emits a JSON report and exits nonzero if any implemented check fails.
`contract.json` is the authoritative inventory: 12 server checks, four canonical
serialization vectors, and six separately listed pending gates. Pending gates
are never included in the passed count. A passing report establishes only these
16 checks for that adapter; it is not a complete interoperability result.

## Adapter exports

```js
export async function createAdapter({ fixture, allowed, options }) {
  return {
    async request(jsonRpcRequest) {
      /* return a JSON-RPC response */
    },
    async replaceFixture(nextFixture) {
      /* test-only atomic replacement */
    },
    async setAllowed(exactNames) {
      /* change this session's authorized view */
    },
    async close() {
      /* release all resources */
    },
  };
}
export function serialize(jsonValue) {
  /* return canonical JSON text */
}
```

Each check gets a fresh independent instance. Fixtures and allowed names are
provided by the harness. `options.manifest = false` selects the legacy fixture
mode. These controls are a **test-only control plane**, never MCP tools or methods;
do not deploy an unauthenticated fixture replacement endpoint. A transport adapter
can perform the real initialize/initialized handshake internally and expose the
normalized capability response here. Report that normalization explicitly.

The current fixture uses a 50-name describe bound and only empty-object arguments.
These are fixture configuration requirements, not universal protocol limits. An
adapter must configure those conditions rather than rewrite faulty results to
make assertions pass. The harness checks request/response IDs and exclusive
result/error envelopes. Digest/size expectations are computed from received full
definitions, using a separate implementation for the fixture's bounded JSON domain.

## What is independent, and what is not

- The suite and JSON inputs are independent of the implementation under test.
- `reference-adapter.mjs` intentionally wraps the original reference server; it
  is **not a second implementation**. Its serializer is tested against literal
  expected strings, not against itself.
- Five negative-control tests deliberately break digest values, authorization,
  stale-view handling, response IDs and serialization. Each must cause the suite
  to fail, helping detect a harness that always returns success.
- `reconnect-view` tests a fresh adapter with different permissions and rejection
  of an old view revision. It does not establish real transport reconnection or
  provider registration eviction; those remain integration work.
- Existing Host tests remain in `../reference.test.mjs`. This portable suite tests
  server behavior, not a portable provider-facing Host API.

## Canonicalization and remaining gates

`canonical-vectors.json` contains language-neutral inputs and literal expected
UTF-8 JSON text, including escaping, nested key order, negative zero and exponent
formatting. All object keys are ASCII. Other languages can consume the same file,
but only JavaScript has been run here. The SEP's code-point ordering wording and
RFC 8785's UTF-16 ordering need alignment before non-BMP-key vectors become binding.

The next tests should add pagination snapshot semantics, actual notification
delivery, TTL expiry, transport reconnect, and native Host activation after those
interfaces are agreed. The pending entries deliberately name missing work rather
than accepting a mock as proof of the corresponding production behavior.
