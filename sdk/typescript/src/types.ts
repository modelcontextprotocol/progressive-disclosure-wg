import { z } from 'zod';
import type { PaginatedRequest, PaginatedResult, Request, Result, Tool, Prompt, Resource } from '@modelcontextprotocol/sdk/types.js';

/**
 * Identifier for the "Progressive Disclosure via Groups" extension.
 * Negotiated via the standard `extensions` capability fields rather than a
 * top-level capability.
 */
export const GROUPS_EXTENSION = 'io.modelcontextprotocol/groups';

// Identifier constraints: 1–64 chars, lowercase alphanumeric and hyphens, with
// no leading, trailing, or consecutive hyphens.
const GROUP_NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const GroupSchema = z.object({
    name: z.string().min(1).max(64).regex(GROUP_NAME_REGEX),
    title: z.string().optional(),
    description: z.string(),
    _meta: z.record(z.unknown()).optional()
});

export type Group = {
    name: string;
    title?: string;
    description: string;
    _meta?: Record<string, unknown>;
};

export const ListGroupsRequestSchema = z
    .object({
        method: z.literal('groups/list')
    })
    .passthrough();

export interface ListGroupsRequest extends PaginatedRequest {
    method: 'groups/list';
}

export const ListGroupsResultSchema = z
    .object({
        groups: z.array(GroupSchema)
    })
    .passthrough();

export interface ListGroupsResult extends PaginatedResult {
    groups: Group[];
}

export const GetGroupRequestSchema = z
    .object({
        method: z.literal('groups/get'),
        params: z.object({ name: z.string() }).passthrough()
    })
    .passthrough();

export interface GetGroupRequest extends Request {
    method: 'groups/get';
    params: {
        name: string;
        [key: string]: unknown;
    };
}

export const GetGroupResultSchema = z
    .object({
        // Both fields are optional, but a response MUST carry at least one of them.
        // A primitives-only group (e.g. a toolset) omits `instructions`; a knowledge
        // bundle may carry `instructions` alone.
        instructions: z.string().optional()
    })
    .passthrough();

/**
 * Scoped primitives bundled with a group and returned in the
 * `groups/get` response. These are omitted from top-level tools/list,
 * prompts/list, and resources/list for discovery purposes, but remain
 * invokable server-side.
 */
export interface GroupContents {
    tools?: Tool[];
    prompts?: Prompt[];
    resources?: Resource[];
    groups?: Group[];
}

export interface GetGroupResult extends Result {
    instructions?: string;
    contents?: GroupContents;
}
