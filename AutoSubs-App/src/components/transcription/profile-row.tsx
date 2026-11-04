import * as React from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePresets } from "@/contexts/PresetsContext";
import {
  formatKeywords,
  formatReplacements,
  newProfile,
  parseKeywords,
  parseReplacements,
  parseSeconds,
} from "@/lib/customer-profiles";
import { useSettingsStore } from "@/stores/settings-store";
import type { CustomerProfile } from "@/types";

const NONE = "__none__";
const KEEP_STYLE = "__keep__";

/**
 * Customer picker: choosing a profile applies its caption preset right away
 * and its word rules, keywords and timing on the next run.
 */
export function ProfileRow() {
  const { t } = useTranslation();
  const profiles = useSettingsStore((s) => s.customerProfiles);
  const activeProfileId = useSettingsStore((s) => s.activeProfileId);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const [editing, setEditing] = React.useState<CustomerProfile | null>(null);

  const active = profiles.find((p) => p.id === activeProfileId);

  const selectProfile = (id: string) => {
    const profile = profiles.find((p) => p.id === id);
    updateSetting("activeProfileId", profile ? profile.id : null);
    if (profile?.presetId) {
      updateSetting("captionStyle", { source: "autosubs", presetId: profile.presetId });
    }
  };

  const saveProfile = (profile: CustomerProfile) => {
    const exists = profiles.some((p) => p.id === profile.id);
    const next = exists
      ? profiles.map((p) => (p.id === profile.id ? profile : p))
      : [...profiles, profile];
    updateSetting("customerProfiles", next);
    updateSetting("activeProfileId", profile.id);
    if (profile.presetId) {
      updateSetting("captionStyle", { source: "autosubs", presetId: profile.presetId });
    }
    setEditing(null);
  };

  const deleteProfile = (id: string) => {
    updateSetting(
      "customerProfiles",
      profiles.filter((p) => p.id !== id),
    );
    if (activeProfileId === id) updateSetting("activeProfileId", null);
    setEditing(null);
  };

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Select value={active?.id ?? NONE} onValueChange={selectProfile}>
        <SelectTrigger className="h-10 min-w-0 flex-1 rounded-lg bg-muted/30 dark:bg-muted">
          <SelectValue placeholder={t("profiles.none")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{t("profiles.none")}</SelectItem>
          {profiles.length > 0 && <SelectSeparator />}
          {profiles.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="ghost"
        size="icon"
        className="size-10 shrink-0"
        title={active ? t("profiles.edit") : t("profiles.new")}
        onClick={() => setEditing(active ?? newProfile(""))}
      >
        {active ? <Pencil className="size-4" /> : <Plus className="size-4" />}
      </Button>
      {active && (
        <Button
          variant="ghost"
          size="icon"
          className="size-10 shrink-0"
          title={t("profiles.new")}
          onClick={() => setEditing(newProfile(""))}
        >
          <Plus className="size-4" />
        </Button>
      )}
      {editing && (
        <ProfileDialog
          profile={editing}
          isNew={!profiles.some((p) => p.id === editing.id)}
          onSave={saveProfile}
          onDelete={deleteProfile}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface ProfileDialogProps {
  profile: CustomerProfile;
  isNew: boolean;
  onSave: (profile: CustomerProfile) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

function secondsText(value: number | null): string {
  return value == null ? "" : String(value);
}

function ProfileDialog({ profile, isNew, onSave, onDelete, onClose }: ProfileDialogProps) {
  const { t } = useTranslation();
  const { presets } = usePresets();
  const [name, setName] = React.useState(profile.name);
  const [presetId, setPresetId] = React.useState(profile.presetId ?? KEEP_STYLE);
  const [keywords, setKeywords] = React.useState(formatKeywords(profile.keywords));
  const [keywordColor, setKeywordColor] = React.useState(profile.keywordColor ?? "#C8102E");
  const [replacements, setReplacements] = React.useState(formatReplacements(profile.replacements));
  const [minDur, setMinDur] = React.useState(secondsText(profile.minDurationSec));
  const [maxDur, setMaxDur] = React.useState(secondsText(profile.maxDurationSec));
  const [pause, setPause] = React.useState(secondsText(profile.pauseSplitSec));

  const keywordCount = parseKeywords(keywords).length;
  const ruleCount = parseReplacements(replacements).length;

  const save = () => {
    onSave({
      ...profile,
      name: name.trim() || t("profiles.unnamed"),
      presetId: presetId === KEEP_STYLE ? null : presetId,
      keywords: parseKeywords(keywords),
      keywordColor,
      replacements: parseReplacements(replacements),
      minDurationSec: parseSeconds(minDur),
      maxDurationSec: parseSeconds(maxDur),
      pauseSplitSec: parseSeconds(pause),
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isNew ? t("profiles.new") : t("profiles.edit")}</DialogTitle>
          <DialogDescription>{t("profiles.dialogDescription")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-name">{t("profiles.name")}</Label>
            <Input
              id="profile-name"
              value={name}
              placeholder="Tipico"
              autoFocus
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("profiles.style")}</Label>
            <Select value={presetId} onValueChange={setPresetId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={KEEP_STYLE}>{t("profiles.keepStyle")}</SelectItem>
                <SelectSeparator />
                {presets.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-keywords">
              {t("profiles.keywords")} ({keywordCount})
            </Label>
            <div className="flex items-center gap-2">
              <p className="flex-1 text-xs text-muted-foreground">{t("profiles.keywordsHelp")}</p>
              <input
                type="color"
                aria-label={t("profiles.keywordColor")}
                title={t("profiles.keywordColor")}
                value={keywordColor}
                onChange={(e) => setKeywordColor(e.target.value)}
                className="size-7 shrink-0 cursor-pointer rounded border bg-transparent p-0.5"
              />
            </div>
            <Textarea
              id="profile-keywords"
              rows={5}
              value={keywords}
              placeholder={"Lennart Karl\nBayern München\nBVB"}
              onChange={(e) => setKeywords(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-replacements">
              {t("profiles.replacements")} ({ruleCount})
            </Label>
            <p className="text-xs text-muted-foreground">{t("profiles.replacementsHelp")}</p>
            <Textarea
              id="profile-replacements"
              rows={4}
              value={replacements}
              placeholder={"Balak => Ballack\nähm =>"}
              className="font-mono text-xs"
              onChange={(e) => setReplacements(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("profiles.timing")}</Label>
            <p className="text-xs text-muted-foreground">{t("profiles.timingHelp")}</p>
            <div className="grid grid-cols-3 gap-2">
              <SecondsField label={t("profiles.minDuration")} value={minDur} placeholder="1.0" onChange={setMinDur} />
              <SecondsField label={t("profiles.maxDuration")} value={maxDur} placeholder="6.0" onChange={setMaxDur} />
              <SecondsField label={t("profiles.pauseSplit")} value={pause} placeholder="0.5" onChange={setPause} />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {!isNew ? (
            <Button variant="ghost" className="text-destructive" onClick={() => onDelete(profile.id)}>
              <Trash2 className="size-4" />
              {t("profiles.delete")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button onClick={save}>{t("profiles.save")}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SecondsField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <Input
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
