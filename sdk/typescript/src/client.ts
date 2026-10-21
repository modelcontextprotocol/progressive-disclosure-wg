import { ListGroupsResultSchema, ListGroupsResult, GetGroupResultSchema, GetGroupResult } from './types.js';

/**
 * Minimal structural view of the MCP `Client` surface `GroupsClient` relies on.
 * Typed structurally (rather than importing the concrete `Client` class) so
 * that consumers linking their own copy of `@modelcontextprotocol/sdk` don't
 * hit cross-package nominal-type clashes on the class's private fields.
 */
export interface GroupsCapableClient {
    request(request: { method: string; params?: Record<string, unknown> }, resultSchema: unknown): Promise<unknown>;
}

export class GroupsClient {
    constructor(private client: GroupsCapableClient) {}

    async listGroups(cursor?: string) {
        return this.client.request(
            {
                method: 'groups/list',
                params: cursor ? { cursor } : undefined
            },
            ListGroupsResultSchema
        ) as Promise<ListGroupsResult>;
    }

    /**
     * Fetch a group's instructions and scoped primitives. This is a stateless
     * read — it does not change server state. The caller decides whether and
     * when to surface the returned primitives to the model.
     */
    async getGroup(name: string) {
        return this.client.request(
            {
                method: 'groups/get',
                params: { name }
            },
            GetGroupResultSchema
        ) as Promise<GetGroupResult>;
    }
}
