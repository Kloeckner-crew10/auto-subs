import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettingsStore } from "@/stores/settings-store";
import type { Model, ProofPolicy } from "@/types";

const OFF = "__off__";

/**
 * Double proof: pick a second model that re-listens to the same audio and
 * votes on the spelling of each word, plus how disagreements are settled.
 */
export function ProofRow({
  modelsState,
  selectedModelIndex,
}: {
  modelsState: Model[];
  selectedModelIndex: number;
}) {
  const { t } = useTranslation();
  const proofModel = useSettingsStore((s) => s.proofModel);
  const proofPolicy = useSettingsStore((s) => s.proofPolicy);
  const translate = useSettingsStore((s) => s.translate);
  const updateSetting = useSettingsStore((s) => s.updateSetting);

  const sameAsMain = proofModel === selectedModelIndex;
  const active = proofModel !== null && !sameAsMain && !translate;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <Select
          value={proofModel === null ? OFF : String(proofModel)}
          onValueChange={(v) => updateSetting("proofModel", v === OFF ? null : Number(v))}
        >
          <SelectTrigger className="h-10 min-w-0 flex-1 rounded-lg bg-muted/30 dark:bg-muted">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={OFF}>{t("proof.off")}</SelectItem>
            <SelectSeparator />
            {modelsState.map((m, i) =>
              i === selectedModelIndex ? null : (
                <SelectItem key={m.value} value={String(i)}>
                  {m.label}
                  {m.isDownloaded ? "" : ` (${m.size})`}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
        {proofModel !== null && (
          <Select
            value={proofPolicy}
            onValueChange={(v) => updateSetting("proofPolicy", v as ProofPolicy)}
          >
            <SelectTrigger className="h-10 w-[42%] shrink-0 rounded-lg bg-muted/30 dark:bg-muted">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="confidence">{t("proof.policy.confidence")}</SelectItem>
              <SelectItem value="proof">{t("proof.policy.proof")}</SelectItem>
              <SelectItem value="report">{t("proof.policy.report")}</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
      {proofModel !== null && !active && (
        <p className="text-xs text-muted-foreground">
          {translate ? t("proof.notWithTranslate") : t("proof.sameModel")}
        </p>
      )}
    </div>
  );
}
