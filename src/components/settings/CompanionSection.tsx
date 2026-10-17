"use client";

import { useState, type FormEvent } from "react";
import { useCanWrite, useSettings } from "@/components/app";
import { Button, Field, InlineAlert, SegmentedControl, TextInput, useToast } from "@/components/ui";
import type { Tone } from "@/core/models";
import { validateBotName } from "@/core/validators";
import { saveBotName, saveTone } from "@/services/settingsService";
import { SettingsRow, SettingsSection } from "./SettingsSection";
import { usePendingValue } from "./usePendingValue";

const TONES: { value: Tone; label: string; hint: string }[] = [
  { value: "cheerful", label: "Cheerful", hint: "Upbeat and warm, quick to celebrate small wins." },
  { value: "calm", label: "Calm", hint: "Steady and gentle, with room to think." },
  { value: "playful", label: "Playful", hint: "Light and a little witty, without losing the thread." },
];

/** Bot_Name and Tone of the Active_Profile (Req 2). */
export function CompanionSection({ index }: { index: string }) {
  const settings = useSettings();
  const canWrite = useCanWrite();
  const { toast } = useToast();

  const [name, setName] = useState(settings.botName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);

  const [tone, chooseTone, revertTone] = usePendingValue<Tone>(settings.tone);
  const [toneError, setToneError] = useState<string | null>(null);

  const dirty = name.trim() !== settings.botName;

  const submitName = async (e: FormEvent) => {
    e.preventDefault();
    if (!canWrite || savingName) return;
    const v = validateBotName(name);
    if (!v.ok) {
      setNameError(v.error);
      return;
    }
    setSavingName(true);
    const res = await saveBotName(name);
    setSavingName(false);
    if (!res.ok) {
      setNameError(res.error);
      return;
    }
    setName(res.value.botName);
    toast({ title: `Your companion is now called ${res.value.botName}`, tone: "success" });
  };

  const changeTone = async (next: Tone) => {
    if (!canWrite || next === tone) return;
    setToneError(null);
    chooseTone(next);
    const res = await saveTone(next);
    if (!res.ok) {
      revertTone();
      setToneError(res.error);
    }
  };

  return (
    <SettingsSection
      id="companion"
      index={index}
      title="Companion"
      description="How your companion introduces itself and the tone it uses. Changes apply to the next reply."
    >
      <SettingsRow>
        <form onSubmit={submitName} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <Field
            label="Name"
            hint={nameError ? undefined : "1 to 30 characters."}
            error={nameError}
            required
            className="flex-1"
          >
            <TextInput
              value={name}
              maxLength={30}
              autoComplete="off"
              disabled={!canWrite}
              onChange={(e) => {
                setName(e.target.value);
                setNameError(null);
              }}
            />
          </Field>
          <Button type="submit" loading={savingName} disabled={!canWrite || !dirty} className="sm:mt-[30px]">
            Save name
          </Button>
        </form>
      </SettingsRow>

      <SettingsRow>
        <SegmentedControl
          label="Tone"
          options={TONES.map((t) => ({ value: t.value, label: t.label }))}
          value={tone}
          onChange={(t) => void changeTone(t)}
          disabled={!canWrite}
        />
        <p className="mt-2 text-[13px] leading-5 text-muted" aria-live="polite">
          {TONES.find((t) => t.value === tone)?.hint}
        </p>
        {toneError ? (
          <InlineAlert tone="danger" className="mt-3">
            {toneError}
          </InlineAlert>
        ) : null}
      </SettingsRow>
    </SettingsSection>
  );
}
