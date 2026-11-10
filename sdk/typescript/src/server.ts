import { McpError } from '@modelcontextprotocol/sdk/types.js';
import { ListGroupsRequestSchema, GetGroupRequestSchema, Group, GroupContents } from './types.js';

/**
 * Minimal structural view of the MCP `Server` surface `setupGroups` relies on.
 * Typed structurally (rather than importing the concrete `Server` class) so
 * that consumers linking their own copy of `@modelcontextprotocol/sdk` don't
 * hit cross-package nominal-type clashes on the class's private fields.
 */
export interface GroupsCapableServer {
    setRequestHandler(requestSchema: unknown, handler: (request: { params: { name: string } & Record<string, unknown> }) => unknown): void;
}

export interface ServerGroup {
    group: Group;
    /**
     * Optional. A group MAY omit instructions — e.g. a primitives-only toolset
     * that only needs to reveal its scoped tools when fetched.
     */
    instructions?: (params: { name: string }) => string | Promise<string>;
    contents?: (params: { name: string }) => GroupContents | Promise<GroupContents>;
}

/**
 * A helper to register handlers for the `io.modelcontextprotocol/groups`
 * extension on a standard Server.
 */
export function setupGroups(server: GroupsCapableServer, groups: ServerGroup[]) {
    server.setRequestHandler(ListGroupsRequestSchema, async () => {
        return {
            groups: groups.map(g => g.group)
        };
    });

    server.setRequestHandler(GetGroupRequestSchema, async request => {
        const name = request.params.name;
        const g = groups.find(gr => gr.group.name === name);

        if (!g) {
            // Mirror `resources/read`'s unknown-URI code so unknown-group handling
            // matches existing precedent (see SEP "groups/get").
            throw new McpError(-32002, `Group not found: ${name}`);
        }

        const instructions = g.instructions ? await g.instructions({ name }) : undefined;
        const contents = g.contents ? await g.contents({ name }) : undefined;

        // A response carries no meaning without at least one of these.
        if (instructions === undefined && contents === undefined) {
            throw new Error(`Group '${name}' returned neither instructions nor contents`);
        }

        return {
            ...(instructions !== undefined ? { instructions } : {}),
            ...(contents !== undefined ? { contents } : {})
        };
    });
}
