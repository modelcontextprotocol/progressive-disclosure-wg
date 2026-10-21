import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { GroupsClient } from "@modelcontextprotocol/ext-grouping";
import * as path from "path";
import * as url from "url";

const __dirname = url.fileURLToPath(new URL(".", import.meta.url));
const serverPath = path.resolve(__dirname, "../../../groups-server/typescript/dist/index.js");

async function main() {
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath],
  });

  const client = new Client(
    { name: "example-groups-client", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);

  const groups = new GroupsClient(client);

  console.log("Fetching groups list...");
  const listResponse = await groups.listGroups();
  console.log(JSON.stringify(listResponse, null, 2));

  // 1. A skill-shaped group: instructions + a scoped tool.
  console.log(`\n================================================`);
  console.log(`Fetching group: weather-forecaster (skill)`);
  const weatherResponse = await groups.getGroup("weather-forecaster");
  console.log(JSON.stringify(weatherResponse, null, 2));

  const weatherTool = (weatherResponse.contents?.tools || []).find(t => t.name === "get_weather");
  if (weatherTool) {
    console.log(`\nExecuting discovered tool: ${weatherTool.name}`);
    const toolResult = await client.callTool({
      name: weatherTool.name,
      arguments: { city: "Cambridge" }
    });
    console.log(JSON.stringify(toolResult, null, 2));
  }

  // 2. A knowledge bundle: instructions + scoped resources, no tools.
  console.log(`\n================================================`);
  console.log(`Fetching group: knowledge-base (knowledge bundle)`);
  const kbResponse = await groups.getGroup("knowledge-base");
  console.log(JSON.stringify(kbResponse, null, 2));

  const docResource = (kbResponse.contents?.resources || []).find(r => r.uri.includes("project-guidelines"));
  if (docResource) {
    console.log(`\nGetting discovered resource: ${docResource.uri}`);
    const runResult = await client.readResource({ uri: docResource.uri });
    console.log(JSON.stringify(runResult, null, 2));
  }

  // 3. A toolset: scoped tools with NO instructions.
  console.log(`\n================================================`);
  console.log(`Fetching group: calendar (toolset, no instructions)`);
  const calResponse = await groups.getGroup("calendar");
  console.log(JSON.stringify(calResponse, null, 2));

  const eventsTool = (calResponse.contents?.tools || []).find(t => t.name === "list_events");
  if (eventsTool) {
    console.log(`\nExecuting discovered tool: ${eventsTool.name}`);
    const toolResult = await client.callTool({
      name: eventsTool.name,
      arguments: { day: "2026-08-17" }
    });
    console.log(JSON.stringify(toolResult, null, 2));
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
