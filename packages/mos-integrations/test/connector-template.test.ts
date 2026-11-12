import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { ContractValidationError, InvariantViolation } from "@mos/contracts";
import {
  HUBSPOT_SEARCH_CONTACTS_TOOL,
  ZCODE_PLUGIN_MANIFEST_KEYS,
  hubspotProviderDescriptor,
  loadHubSpotConnectorTemplate,
  parseConnectorTemplateManifest,
} from "../src/index.js";

const TEMPLATE_ROOT = fileURLToPath(
  new URL("../src/connector/hubspot-connector-template", import.meta.url),
);

const VALID_SERVER = {
  type: "http",
  url: "https://mcp.hubspot.com/",
  oauth: { type: "authorization_code" },
};

const tempDirs: string[] = [];

async function makeTempTemplateRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "mos-connector-template-"));
  tempDirs.push(root);
  await mkdir(join(root, ".zcode-plugin"), { recursive: true });
  return root;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("hubspot connector template (installable declaration, NOT wired)", () => {
  test("loads and validates the .zcode-plugin/plugin.json manifest", async () => {
    const template = await loadHubSpotConnectorTemplate(TEMPLATE_ROOT);
    expect(template.manifest.name).toBe("mos-hubspot-connector");
    expect(template.manifest.version).toBe("0.1.0");
    expect(template.manifest.description.length).toBeGreaterThan(0);
    expect(template.manifestPath).toBe(".zcode-plugin/plugin.json");
  });

  test("declares the hubspot http remote MCP server with authorization_code OAuth", async () => {
    const template = await loadHubSpotConnectorTemplate(TEMPLATE_ROOT);
    expect(template.serverName).toBe("hubspot");
    const server = template.manifest.mcpServers["hubspot"];
    expect(server?.type).toBe("http");
    expect(server?.url).toBe(hubspotProviderDescriptor.endpoint.url);
    expect(server?.oauth).toEqual({ type: "authorization_code" });
  });

  test("manifest does NOT alter ZCode's plugin manifest schema (no MOS-invented keys)", async () => {
    const template = await loadHubSpotConnectorTemplate(TEMPLATE_ROOT);
    const manifestKeys = Object.keys(template.manifest);
    expect(manifestKeys.length).toBeGreaterThan(0);
    for (const key of manifestKeys) {
      expect(ZCODE_PLUGIN_MANIFEST_KEYS).toContain(key);
    }
    // 模板绝不携带能力元数据：工具映射只存在于相邻 MOS 描述符（且 verified=false）。
    expect(manifestKeys).not.toContain("capabilities");
    expect(manifestKeys).not.toContain("mosCapabilities");
    expect(hubspotProviderDescriptor.toolMappingVerified).toBe(false);
  });

  test("template is explicitly not installed (composition root decides later)", async () => {
    const template = await loadHubSpotConnectorTemplate(TEMPLATE_ROOT);
    expect(template.installed).toBe(false);
    // 工具名只存在于相邻 MOS 描述符（且 verified=false），绝不进入 plugin manifest。
    expect(JSON.stringify(template.manifest)).not.toContain(HUBSPOT_SEARCH_CONTACTS_TOOL);
    expect(hubspotProviderDescriptor.toolMappingVerified).toBe(false);
  });

  test("rejects a manifest that adds a field outside the ZCode plugin manifest schema", () => {
    expect(() =>
      parseConnectorTemplateManifest({
        name: "mos-hubspot-connector",
        version: "0.1.0",
        description: "bad template",
        mcpServers: { hubspot: { ...VALID_SERVER } },
        mosCapabilities: { tool: HUBSPOT_SEARCH_CONTACTS_TOOL },
      }),
    ).toThrow(InvariantViolation);
  });

  test("rejects a structurally invalid manifest (missing name)", () => {
    expect(() =>
      parseConnectorTemplateManifest({
        version: "0.1.0",
        description: "no name",
        mcpServers: {},
      }),
    ).toThrow(ContractValidationError);
  });

  test("rejects a hubspot server that disagrees with the provider descriptor", async () => {
    const root = await makeTempTemplateRoot();
    const tampered = {
      name: "mos-hubspot-connector",
      version: "0.1.0",
      description: "tampered endpoint",
      mcpServers: {
        hubspot: { type: "http", url: "https://example.invalid/mcp", oauth: { type: "authorization_code" } },
      },
    };
    await writeFile(
      join(root, ".zcode-plugin", "plugin.json"),
      JSON.stringify(tampered),
      "utf8",
    );
    await expect(loadHubSpotConnectorTemplate(root)).rejects.toThrow(InvariantViolation);
  });

  test("rejects a hubspot server without the authorization_code OAuth declaration", async () => {
    const root = await makeTempTemplateRoot();
    const noOauth = {
      name: "mos-hubspot-connector",
      version: "0.1.0",
      description: "missing oauth",
      mcpServers: { hubspot: { type: "http", url: "https://mcp.hubspot.com/" } },
    };
    await writeFile(join(root, ".zcode-plugin", "plugin.json"), JSON.stringify(noOauth), "utf8");
    await expect(loadHubSpotConnectorTemplate(root)).rejects.toThrow(InvariantViolation);
  });

  test("missing manifest file fails closed instead of fabricating a template", async () => {
    await expect(loadHubSpotConnectorTemplate("/nonexistent/connector-template")).rejects.toThrow(
      InvariantViolation,
    );
  });
});
