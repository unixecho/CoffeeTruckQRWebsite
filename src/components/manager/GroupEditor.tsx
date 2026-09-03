"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ios/Sheet";
import { Button, Disclosure, Switch, TextField } from "@/components/ios/Controls";
import { useToast } from "@/components/ios/Feedback";
import { IconTile } from "@/components/ios/Icon";
import {
  CATEGORY_TINTS,
  ICON_NAMES,
  resolveIcon,
  resolveTint,
  TINT_NAMES,
} from "@/lib/categoryIcons";
import { useI18n } from "@/lib/i18n";
import type { Category, Subclass } from "@/lib/types";
import { errorMessage, patch, post } from "./api";

/* ==========================================================================
   Creating and editing categories and subclasses

   One component for both, because the two differ in exactly three ways — a
   subclass carries a category, and only a category has an icon and a tint —
   and two near-identical sheets would drift apart within a month.
   ========================================================================== */

type Target =
  | { kind: "category"; row: Category | null }
  | { kind: "subclass"; row: Subclass | null; categoryId: string };

interface Props {
  target: Target;
  onClose: () => void;
  onDelete: (kind: "category" | "subclass", id: string, name: string) => void;
}

export function GroupEditor({ target, onClose, onDelete }: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();

  const existing = target.row;
  const isCategory = target.kind === "category";

  const [nameHe, setNameHe] = useState(existing?.name.he ?? "");
  const [nameEn, setNameEn] = useState(existing?.name.en ?? "");
  const [nameAr, setNameAr] = useState(existing?.name.ar ?? "");
  const [visible, setVisible] = useState(existing?.visible ?? true);
  const [icon, setIcon] = useState(
    target.kind === "category" ? (target.row?.icon ?? "Package") : "Package"
  );
  const [tint, setTint] = useState(
    target.kind === "category" ? (target.row?.tint ?? "gray") : "gray"
  );
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  async function save() {
    if (nameHe.trim() === "") {
      setError(t.manager.validation.nameRequired);
      return;
    }
    setError(undefined);
    setSaving(true);

    const blank = (value: string) => (value.trim() === "" ? null : value.trim());
    const name = { he: nameHe.trim(), en: blank(nameEn), ar: blank(nameAr) };

    const body = isCategory
      ? { name, icon, tint, visible }
      : { name, visible, categoryId: target.kind === "subclass" ? target.categoryId : "" };

    const path = isCategory ? "categories" : "subclasses";
    const result = existing
      ? await patch(`/api/manager/${path}/${existing.id}`, body)
      : await post(`/api/manager/${path}`, body);

    setSaving(false);

    if (!result.ok) {
      toast(errorMessage(result.error, t), "error");
      return;
    }

    toast(t.manager.saved);
    router.refresh();
    onClose();
  }

  const title = existing
    ? isCategory
      ? t.manager.editCategory
      : t.manager.editSubclass
    : isCategory
      ? t.manager.newCategory
      : t.manager.newSubclass;

  return (
    <Sheet
      open
      onClose={onClose}
      dismissLabel={t.common.dismiss}
      title={title}
      footer={
        <div className="flex gap-2">
          <div className="flex-[2]">
            <Button size="lg" fullWidth onClick={save} loading={saving}>
              {saving ? t.common.saving : t.common.save}
            </Button>
          </div>
          <div className="flex-1">
            <Button size="lg" fullWidth variant="gray" onClick={onClose}>
              {t.common.cancel}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <TextField
          label={t.manager.fields.nameHe}
          value={nameHe}
          onChange={setNameHe}
          error={error}
          autoFocus={!existing}
        />

        {isCategory && (
          <>
            <Choice
              label={t.manager.fields.icon}
              options={ICON_NAMES}
              value={icon}
              onChange={setIcon}
              render={(name) => (
                <IconTile icon={resolveIcon(name)} tint={resolveTint(tint)} size="lg" />
              )}
            />
            <Choice
              label={t.manager.fields.tint}
              options={TINT_NAMES}
              value={tint}
              onChange={setTint}
              render={(name) => (
                <span
                  aria-hidden="true"
                  className="block size-7 rounded-full"
                  style={{
                    backgroundColor: CATEGORY_TINTS[name as keyof typeof CATEGORY_TINTS],
                    // A hairline so a tint close to the surface colour still
                    // reads as a swatch rather than a hole.
                    boxShadow: "inset 0 0 0 1px var(--separator)",
                  }}
                />
              )}
            />
          </>
        )}

        <div className="flex min-h-11 items-center justify-between gap-4">
          <span className="text-body">{t.manager.fields.visible}</span>
          <Switch checked={visible} onChange={setVisible} label={t.manager.fields.visible} />
        </div>

        <Disclosure label={`${t.manager.fields.nameEn} · ${t.manager.fields.nameAr}`}>
          <TextField label={t.manager.fields.nameEn} value={nameEn} onChange={setNameEn} />
          <TextField label={t.manager.fields.nameAr} value={nameAr} onChange={setNameAr} />
        </Disclosure>

        {existing && (
          <Button
            variant="destructive"
            fullWidth
            onClick={() => {
              onClose();
              onDelete(target.kind, existing.id, existing.name.he);
            }}
          >
            {t.common.delete}
          </Button>
        )}
      </div>
    </Sheet>
  );
}

/**
 * A horizontally scrolling row of swatches.
 *
 * A radiogroup rather than a select, because the whole point is seeing the
 * options — an icon named "MousePointerClick" in a dropdown tells the owner
 * nothing about what it looks like on the shelf.
 */
function Choice({
  label,
  options,
  value,
  onChange,
  render,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (next: string) => void;
  render: (option: string) => React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-footnote px-1" style={{ color: "var(--label-secondary)" }}>
        {label}
      </span>
      <div
        role="radiogroup"
        aria-label={label}
        className="scroll-region -mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
      >
        {options.map((option) => {
          const selected = option === value;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={option}
              onClick={() => onChange(option)}
              className="press flex size-11 shrink-0 items-center justify-center"
              style={{
                borderRadius: "var(--radius-control)",
                backgroundColor: selected ? "var(--fill-tertiary)" : "transparent",
                // Selection carries a ring as well as a fill: colour alone is
                // never the only signal.
                boxShadow: selected ? "inset 0 0 0 2px var(--ios-blue)" : "none",
              }}
            >
              {render(option)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
