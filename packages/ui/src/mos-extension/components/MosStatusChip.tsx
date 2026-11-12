import { memo } from "react";
import { CircleAlert, CircleCheck, CircleDashed } from "lucide-react";
import { cn } from "@/components/lib/utils.js";
import type { MosStatusChipProps } from "@/mos-extension/contract.js";
import { resolveMosStatusPresentation } from "@/mos-extension/domain/statusPresentation.js";

/** 本地 test id（挂载方与 E2E 用；与 shared/test-ids 的集中登记一起由组合根决定）。 */
export const TID_MOS_STATUS_CHIP = "mos-extension-status-chip";

// 语气 → 图标（fail-closed：只认 domain 的三个语气，不出现「无图标」分支）。
const TONE_ICONS = {
  connected: CircleCheck,
  idle: CircleDashed,
  warning: CircleAlert,
} as const;

// 语气 → 颜色（DESIGN.md 词汇：success/warning/foreground-subtle，不加临时色值）。
const TONE_ICON_CLASSES = {
  connected: "text-success",
  idle: "text-foreground-subtle",
  warning: "text-warning",
} as const;

const TONE_LABEL_CLASSES = {
  connected: "text-foreground-subtle",
  idle: "text-foreground-subtle",
  warning: "text-warning",
} as const;

/**
 * MOS 状态 chip：mission 关联状态的一枚 ghost 徽标（span，不交互、无背景）。
 * 纯展示组件：可见性与语气判定在 domain/statusPresentation.ts；不可用/未注册时返回 null。
 */
function MosStatusChipImpl(props: MosStatusChipProps) {
  const presentation = resolveMosStatusPresentation({
    availability: props.availability,
    missionStatus: props.missionStatus,
  });
  if (!presentation) return null;
  const Icon = TONE_ICONS[presentation.tone];
  const available = props.availability?.available === true;
  return (
    <span
      data-testid={TID_MOS_STATUS_CHIP}
      data-mos-available={available ? "true" : "false"}
      title={presentation.label}
      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg px-1.5 text-ui-sm text-foreground-subtle"
    >
      <Icon
        className={cn("size-3.5 shrink-0", TONE_ICON_CLASSES[presentation.tone])}
        aria-hidden
      />
      <span
        className={cn(
          "max-w-40 truncate",
          TONE_LABEL_CLASSES[presentation.tone],
          props.compact && "sr-only",
        )}
      >
        {presentation.label}
      </span>
    </span>
  );
}

export const MosStatusChip = memo(MosStatusChipImpl);
