// Test-only control plane. Never expose these controls as MCP methods.
import { Server, canonical } from "../reference.mjs";

export function serialize(value) {
  return canonical(value);
}
export async function createAdapter({ fixture, allowed, options = {} }) {
  const server = new Server(fixture, options);
  const session = { allowed: new Set(allowed) };
  return {
    async request(request) {
      return server.request(session, request);
    },
    async replaceFixture(next) {
      server.data = structuredClone(next);
    },
    async setAllowed(names) {
      session.allowed = new Set(names);
    },
    async close() {},
  };
}
