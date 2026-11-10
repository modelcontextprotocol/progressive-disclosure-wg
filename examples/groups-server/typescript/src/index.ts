import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  setupGroups,
  ServerGroup,
  GroupContents,
  GROUPS_EXTENSION,
} from "@modelcontextprotocol/ext-grouping";
import {
  CallToolRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// A small but realistic "workspace assistant" MCP server. It keeps a handful of
// genuinely always-on utilities in tools/list and pushes the bulk of its
// capability — dozens of situational tools — behind groups, revealed only via
// groups/get. This is the shape the Groups SEP targets: a server with far more
// capability than any one session needs resident.

const server = new Server(
  {
    name: "example-groups-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      extensions: {
        [GROUPS_EXTENSION]: {},
      },
      tools: {},
      resources: {},
    } as any,
  }
);

// ---------------------------------------------------------------------------
// Groups (situational capability, revealed on demand via groups/get)
// ---------------------------------------------------------------------------

// A skill: instructions plus the tools they orchestrate.
const weatherGroup: ServerGroup = {
  group: {
    name: "weather-forecaster",
    title: "Weather",
    description:
      "Current conditions, multi-day forecasts, and severe-weather alerts for any city or region.",
  },
  instructions: () =>
    "# Weather\n" +
    "Use `get_weather` for current conditions, `get_forecast` for a multi-day " +
    "outlook, and `get_severe_alerts` to check active warnings before advising " +
    "on travel or outdoor plans.",
  contents: (): GroupContents => ({
    tools: [
      {
        name: "get_weather",
        description: "Get the current weather conditions for a city.",
        inputSchema: {
          type: "object",
          properties: {
            city: { type: "string", description: "City name, e.g. 'Cambridge'." },
          },
          required: ["city"],
        },
      },
      {
        name: "get_forecast",
        description: "Get a multi-day weather forecast for a city.",
        inputSchema: {
          type: "object",
          properties: {
            city: { type: "string", description: "City name." },
            days: {
              type: "integer",
              description: "Number of days to forecast (1-10).",
              minimum: 1,
              maximum: 10,
            },
          },
          required: ["city", "days"],
        },
      },
      {
        name: "get_severe_alerts",
        description:
          "List active severe-weather alerts (storms, floods, heat) for a region.",
        inputSchema: {
          type: "object",
          properties: {
            region: {
              type: "string",
              description: "Region, state, or metro area to check.",
            },
          },
          required: ["region"],
        },
      },
    ],
  }),
};

// A toolset: scoped tools, no instructions.
const calendarGroup: ServerGroup = {
  group: {
    name: "calendar",
    title: "Calendar",
    description:
      "Read and manage calendar events: list a day, find open slots, schedule, and cancel.",
  },
  contents: (): GroupContents => ({
    tools: [
      {
        name: "list_events",
        description: "List calendar events for a given day.",
        inputSchema: {
          type: "object",
          properties: {
            day: { type: "string", description: "Date in YYYY-MM-DD form." },
          },
          required: ["day"],
        },
      },
      {
        name: "find_availability",
        description:
          "Find open time slots on a given day that fit a meeting of a given length.",
        inputSchema: {
          type: "object",
          properties: {
            day: { type: "string", description: "Date in YYYY-MM-DD form." },
            duration_minutes: {
              type: "integer",
              description: "Required meeting length in minutes.",
            },
            attendees: {
              type: "array",
              items: { type: "string" },
              description: "Email addresses whose calendars must also be free.",
            },
          },
          required: ["day", "duration_minutes"],
        },
      },
      {
        name: "create_event",
        description: "Create a calendar event and invite attendees.",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Event title." },
            day: { type: "string", description: "Date in YYYY-MM-DD form." },
            start: { type: "string", description: "Start time, e.g. '14:00'." },
            end: { type: "string", description: "End time, e.g. '15:00'." },
            attendees: {
              type: "array",
              items: { type: "string" },
              description: "Attendee email addresses.",
            },
          },
          required: ["title", "day", "start", "end"],
        },
      },
      {
        name: "cancel_event",
        description: "Cancel a previously scheduled calendar event by id.",
        inputSchema: {
          type: "object",
          properties: {
            event_id: { type: "string", description: "The event id to cancel." },
          },
          required: ["event_id"],
        },
      },
    ],
  }),
};

// A knowledge bundle: instructions plus reference resources, no tools.
const knowledgeBaseGroup: ServerGroup = {
  group: {
    name: "knowledge-base",
    title: "Knowledge Base",
    description: "Critical domain knowledge provided via text resources.",
  },
  instructions: () =>
    "# Knowledge Base\nRead the provided internal resources to answer questions about the project.",
  contents: (): GroupContents => ({
    resources: [
      {
        uri: "internal://docs/project-guidelines.txt",
        name: "Project Guidelines",
        mimeType: "text/plain",
        description: "Core rules and guidelines for the project.",
      },
      {
        uri: "internal://docs/architecture.txt",
        name: "Architecture Overview",
        mimeType: "text/plain",
      },
    ],
  }),
};

// A skill: customer-relationship-management workflow.
const crmGroup: ServerGroup = {
  group: {
    name: "crm",
    title: "CRM",
    description:
      "Look up customers, review account health, open support tickets, and log interactions.",
  },
  instructions: () =>
    "# CRM\n" +
    "Resolve the customer with `find_customer` first, then use its id with " +
    "`get_account_summary`, `create_ticket`, or `log_interaction`. Always " +
    "confirm the customer identity before creating tickets.",
  contents: (): GroupContents => ({
    tools: [
      {
        name: "find_customer",
        description: "Search for a customer by name, email, or company.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Name, email, or company." },
          },
          required: ["query"],
        },
      },
      {
        name: "get_account_summary",
        description:
          "Return plan, renewal date, open tickets, and recent activity for a customer.",
        inputSchema: {
          type: "object",
          properties: {
            customer_id: { type: "string", description: "The customer id." },
          },
          required: ["customer_id"],
        },
      },
      {
        name: "create_ticket",
        description: "Open a support ticket for a customer.",
        inputSchema: {
          type: "object",
          properties: {
            customer_id: { type: "string", description: "The customer id." },
            subject: { type: "string", description: "Short ticket subject." },
            priority: {
              type: "string",
              enum: ["low", "normal", "high", "urgent"],
              description: "Ticket priority.",
            },
          },
          required: ["customer_id", "subject"],
        },
      },
      {
        name: "log_interaction",
        description: "Record a note about a customer interaction.",
        inputSchema: {
          type: "object",
          properties: {
            customer_id: { type: "string", description: "The customer id." },
            notes: { type: "string", description: "What happened." },
          },
          required: ["customer_id", "notes"],
        },
      },
    ],
  }),
};

// A skill: travel booking workflow.
const travelGroup: ServerGroup = {
  group: {
    name: "travel-booking",
    title: "Travel Booking",
    description:
      "Search flights and hotels and assemble an itinerary for a trip.",
  },
  instructions: () =>
    "# Travel Booking\n" +
    "Search options with `search_flights` and `search_hotels`, present the best " +
    "few to the user, and only call `book_itinerary` after they confirm.",
  contents: (): GroupContents => ({
    tools: [
      {
        name: "search_flights",
        description: "Search for flights between two cities on given dates.",
        inputSchema: {
          type: "object",
          properties: {
            origin: { type: "string", description: "Origin city or airport." },
            destination: {
              type: "string",
              description: "Destination city or airport.",
            },
            depart_date: { type: "string", description: "YYYY-MM-DD." },
            return_date: {
              type: "string",
              description: "YYYY-MM-DD (omit for one-way).",
            },
          },
          required: ["origin", "destination", "depart_date"],
        },
      },
      {
        name: "search_hotels",
        description: "Search for hotels in a city for a date range.",
        inputSchema: {
          type: "object",
          properties: {
            city: { type: "string", description: "City to stay in." },
            checkin: { type: "string", description: "YYYY-MM-DD." },
            checkout: { type: "string", description: "YYYY-MM-DD." },
            guests: { type: "integer", description: "Number of guests." },
          },
          required: ["city", "checkin", "checkout"],
        },
      },
      {
        name: "book_itinerary",
        description:
          "Book a selected flight and hotel together as one itinerary.",
        inputSchema: {
          type: "object",
          properties: {
            flight_id: { type: "string", description: "Chosen flight id." },
            hotel_id: { type: "string", description: "Chosen hotel id." },
          },
          required: ["flight_id", "hotel_id"],
        },
      },
    ],
  }),
};

setupGroups(server, [
  weatherGroup,
  calendarGroup,
  knowledgeBaseGroup,
  crmGroup,
  travelGroup,
]);

// ---------------------------------------------------------------------------
// Always-on top-level tools (returned by tools/list, available every session)
// ---------------------------------------------------------------------------

const alwaysOnTools = [
  {
    name: "web_search",
    description:
      "Search the public web and return the top results (title, url, snippet). Use for current events, facts, and anything outside internal systems.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query." },
        recency: {
          type: "string",
          enum: ["any", "day", "week", "month", "year"],
          description: "Restrict results to a recency window.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "read_url",
    description:
      "Fetch a URL and return its main text content. Use to read a page found via web_search or supplied by the user.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "The URL to fetch." },
      },
      required: ["url"],
    },
  },
  {
    name: "send_message",
    description:
      "Send a short message to a person or channel the user has access to.",
    inputSchema: {
      type: "object",
      properties: {
        channel: {
          type: "string",
          description: "Recipient address or channel name.",
        },
        text: { type: "string", description: "Message body." },
      },
      required: ["channel", "text"],
    },
  },
  {
    name: "echo",
    description:
      "Echo back a message. A general-purpose utility that is always available (not part of any capability group).",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Text to echo back." },
      },
      required: ["message"],
    },
  },
];

// tools/list returns only the always-on tools. Group-scoped tools are hidden
// here (discovery-gating) and revealed via groups/get. resources/list is empty
// for the same reason.
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: alwaysOnTools,
}));
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [],
}));
server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
  resourceTemplates: [],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request: any) => {
  const uri = request.params.uri;
  if (uri === "internal://docs/project-guidelines.txt") {
    return {
      contents: [
        {
          uri,
          mimeType: "text/plain",
          text: "Rule 1: No magic numbers. Rule 2: Always validate inputs.",
        },
      ],
    };
  }
  if (uri === "internal://docs/architecture.txt") {
    return {
      contents: [
        {
          uri,
          mimeType: "text/plain",
          text: "The architecture consists of an SDK layer, a Server layer, and a Client agent.",
        },
      ],
    };
  }
  throw new Error(`Resource not found: ${uri}`);
});

// A single dispatch for every tool — always-on and group-scoped alike. Scoped
// tools remain invokable through the flat tools/call namespace whether or not
// the client has fetched their group (the SEP's discovery gate is not a session
// gate). Responses are canned but plausible so the agent can complete a task.
const text = (t: string) => ({ content: [{ type: "text", text: t }] });

server.setRequestHandler(CallToolRequestSchema, async (request: any) => {
  const name = request.params.name;
  const a = request.params.arguments ?? {};
  switch (name) {
    // always-on
    case "echo":
      return text(`echo: ${a.message ?? ""}`);
    case "web_search":
      return text(
        `Top results for "${a.query}":\n` +
          `1. Overview — https://example.com/${encodeURIComponent(a.query ?? "")}\n` +
          `2. Guide — https://example.org/guide`
      );
    case "read_url":
      return text(`Fetched ${a.url}. (Main content omitted in this demo.)`);
    case "send_message":
      return text(`Message sent to ${a.channel}.`);

    // weather-forecaster
    case "get_weather":
      return text(`The weather in ${a.city} is sunny, 18°C.`);
    case "get_forecast":
      return text(
        `${a.days}-day forecast for ${a.city}: mostly sunny, highs 17-21°C, light rain midweek.`
      );
    case "get_severe_alerts":
      return text(`No active severe-weather alerts for ${a.region}.`);

    // calendar
    case "list_events":
      return text(`No events scheduled for ${a.day}.`);
    case "find_availability":
      return text(
        `Open ${a.duration_minutes}-min slots on ${a.day}: 10:00-10:30, 13:30-14:00, 16:00-16:30.`
      );
    case "create_event":
      return text(
        `Created "${a.title}" on ${a.day} ${a.start}-${a.end} (event id evt_1042).`
      );
    case "cancel_event":
      return text(`Cancelled event ${a.event_id}.`);

    // crm
    case "find_customer":
      return text(
        `Match for "${a.query}": Acme Corp (customer id cus_88).`
      );
    case "get_account_summary":
      return text(
        `Account ${a.customer_id}: Enterprise plan, renews 2026-12-01, 2 open tickets, last contact 6 days ago.`
      );
    case "create_ticket":
      return text(
        `Opened ${a.priority ?? "normal"}-priority ticket for ${a.customer_id}: "${a.subject}" (ticket id tkt_301).`
      );
    case "log_interaction":
      return text(`Logged interaction for ${a.customer_id}.`);

    // travel-booking
    case "search_flights":
      return text(
        `Flights ${a.origin}→${a.destination} on ${a.depart_date}: ` +
          `fl_A 07:20 nonstop $480, fl_B 12:10 1-stop $360.`
      );
    case "search_hotels":
      return text(
        `Hotels in ${a.city} ${a.checkin}–${a.checkout}: ht_X central $180/night, ht_Y airport $120/night.`
      );
    case "book_itinerary":
      return text(
        `Booked flight ${a.flight_id} + hotel ${a.hotel_id} (confirmation TRIP-7781).`
      );

    default:
      throw new Error(`Tool not found: ${name}`);
  }
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Example Groups server running on stdio");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
