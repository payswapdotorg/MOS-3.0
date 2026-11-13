import { z } from "zod";

/**
 * ZCode 插件清单（mos-studio 用到的字段）的结构镜像 —— 只镜像上游 schema 已定义的字段，
 * 不扩展清单 schema（与 @mos/integrations connectorTemplateManifestSchema 同纪律）。
 * 真实上游 loader 的完整校验在 test/integration/plugin-real-stack.test.ts（依赖 CLI dist）执行；
 * 这里给工程层一个无 dist 依赖的机器校验下限。
 */

const pluginNamePattern = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const surfaceIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

export const manifestStdioServerSchema = z.strictObject({
  type: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string().min(1)).optional(),
});

export const manifestUiSurfaceSchema = z.strictObject({
  id: z.string().regex(surfaceIdPattern),
  title: z.union([z.string().min(1).max(200), z.record(z.string(), z.string().min(1).max(200))]),
  icon: z.string().min(1).max(2048).optional(),
  server: z.string().min(1),
  resourceUri: z.string().regex(/^ui:\/\//).max(2048),
  availability: z.literal("session"),
});

export const manifestSlotTargetSchema = z
  .strictObject({ surface: z.string().regex(surfaceIdPattern) })
  .refine((target) => Object.keys(target).length === 1, {
    message: "target must have exactly one key (surface)",
  });

export const manifestSlotItemSchema = z.strictObject({
  id: z.string().regex(surfaceIdPattern),
  target: manifestSlotTargetSchema,
  title: z.union([z.string().min(1).max(200), z.record(z.string(), z.string().min(1).max(200))]).optional(),
  icon: z.string().min(1).max(2048).optional(),
  order: z.number().int().min(-1000).max(1000).optional(),
});

/** 本插件使用的插槽 id（上游 EXTENSION_SLOTS 的子集；未知插槽 id 上游只记诊断）。 */
export const STUDIO_SLOT_IDS = ["nav.primary", "sidePane.launcher"] as const;

export const studioManifestSchema = z.strictObject({
  name: z.string().regex(pluginNamePattern),
  version: z.string().min(1),
  description: z.string().min(1),
  description_i18n: z.record(z.string(), z.string().min(1)).optional(),
  author: z.unknown().optional(),
  license: z.string().min(1),
  mcpServers: z.record(z.string().min(1), manifestStdioServerSchema),
  ui: z.strictObject({ surfaces: z.array(manifestUiSurfaceSchema).min(1) }),
  slots: z.record(z.enum(STUDIO_SLOT_IDS), z.array(manifestSlotItemSchema).min(1)),
});

export type StudioManifest = z.infer<typeof studioManifestSchema>;

/** hooks/hooks.json（SessionStart 段）结构镜像。 */
export const studioHooksSchema = z.strictObject({
  hooks: z.strictObject({
    SessionStart: z
      .array(
        z.strictObject({
          hooks: z.array(
            z.strictObject({
              type: z.literal("command"),
              command: z.string().min(1),
              timeoutMs: z.number().int().positive().optional(),
              onError: z.enum(["allow", "deny"]).optional(),
            }),
          ),
        }),
      )
      .min(1),
  }),
});
