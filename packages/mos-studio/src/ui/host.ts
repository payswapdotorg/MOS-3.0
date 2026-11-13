import { App } from "@modelcontextprotocol/ext-apps";

/**
 * 面板宿主桥（@modelcontextprotocol/ext-apps AppBridge）。
 * 全部数据与动作都经本插件 server 的工具（callServerTool）；面板不直接做任何网络 IO。
 * 会话关联经宿主在面板工具调用上注入的会话事实（server 端 _meta）实现。
 */

export interface StudioHost {
  call<T>(toolName: string, args?: Record<string, unknown>): Promise<T | null>;
}

export async function connectStudioHost(): Promise<StudioHost> {
  const app = new App({ name: "mos-studio", version: "1" }, {}, { autoResize: false });
  await app.connect();
  return {
    async call<T>(toolName: string, args: Record<string, unknown> = {}): Promise<T | null> {
      try {
        const result = await app.callServerTool({ name: toolName, arguments: args });
        if (result.isError === true) {
          const block = result.content?.find((item) => item.type === "text");
          const text = block && block.type === "text" ? block.text : null;
          return { error: text ?? "tool error" } as unknown as T;
        }
        return (result.structuredContent as T) ?? null;
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) } as unknown as T;
      }
    },
  };
}
