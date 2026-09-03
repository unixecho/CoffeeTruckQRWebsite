"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ios/Sheet";
import { Button, Disclosure, Switch, TextField } from "@/components/ios/Controls";
import { useToast } from "@/components/ios/Feedback";
import { agorotToInput, parseShekels } from "@/lib/money";
import { localize, type Category, type Product, type Subclass } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { patch, post, errorMessage } from "./api";
import { PhotoManager } from "./PhotoManager";
import { Picker } from "./Picker";

/* ==========================================================================
   Adding a keychain, at a coffee truck, on a phone

   Field order is the order the job actually happens in: point the camera at
   the thing, say what it is, say what it costs. Everything else — the other
   two languages, descriptions, stock — is behind a disclosure, because none of
   it is needed to sell something this afternoon and asking for it up front is
   what turns a thirty-second task into a two-minute one.

   Hebrew name and price are the only required fields. That is not laziness:
   the storefront falls back to Hebrew for a missing translation, so a product
   with only those two is genuinely complete.
   ========================================================================== */

type Target =
  | { mode: "new"; categoryId: string; subclassId: string | null }
  | { mode: "edit"; product: Product };

interface Props {
  target: Target;
  categories: Category[];
  subclasses: Subclass[];
  onClose: () => void;
  onDelete: (product: Product) => void;
}

interface Draft {
  nameHe: string;
  nameEn: string;
  nameAr: string;
  descriptionHe: string;
  descriptionEn: string;
  descriptionAr: string;
  price: string;
  categoryId: string;
  subclassId: string | null;
  available: boolean;
  stock: string;
}

function draftFrom(target: Target): Draft {
  if (target.mode === "new") {
    return {
      nameHe: "",
      nameEn: "",
      nameAr: "",
      descriptionHe: "",
      descriptionEn: "",
      descriptionAr: "",
      price: "",
      categoryId: target.categoryId,
      subclassId: target.subclassId,
      available: true,
      stock: "",
    };
  }

  const p = target.product;
  return {
    nameHe: p.name.he,
    nameEn: p.name.en ?? "",
    nameAr: p.name.ar ?? "",
    descriptionHe: p.description.he ?? "",
    descriptionEn: p.description.en ?? "",
    descriptionAr: p.description.ar ?? "",
    price: agorotToInput(p.priceAgorot),
    categoryId: p.categoryId,
    subclassId: p.subclassId,
    available: p.available,
    stock: p.stock === null ? "" : String(p.stock),
  };
}

export function ProductEditor({ target, categories, subclasses, onClose, onDelete }: Props) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const toast = useToast();

  /* Keyed on the target by the caller, so opening a different product
     remounts this and gets a fresh draft. No effect syncing props into
     state — the mount IS the sync. */
  const [draft, setDraft] = useState<Draft>(() => draftFrom(target));
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [saving, setSaving] = useState(false);

  const existing = target.mode === "edit" ? target.product : null;
  const field = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  /* Only the subclasses of the chosen category are offerable. The database
     enforces the same pairing with a trigger; offering an impossible choice
     and then rejecting it would be the interface's fault, not the owner's. */
  const available = subclasses.filter((s) => s.categoryId === draft.categoryId);

  function validate(): { nameHe: string; priceAgorot: number } | null {
    const next: Partial<Record<keyof Draft, string>> = {};

    const nameHe = draft.nameHe.trim();
    if (nameHe === "") next.nameHe = t.manager.validation.nameRequired;

    const priceAgorot = parseShekels(draft.price);
    if (draft.price.trim() === "") next.price = t.manager.validation.priceRequired;
    else if (priceAgorot === null) next.price = t.manager.validation.priceInvalid;

    if (!draft.categoryId) next.categoryId = t.manager.validation.categoryRequired;

    setErrors(next);
    if (Object.keys(next).length > 0 || priceAgorot === null) return null;
    return { nameHe, priceAgorot };
  }

  async function save() {
    const checked = validate();
    if (!checked) return;

    setSaving(true);

    /* Empty strings become nulls rather than being sent through. An empty
       English name stored as "" would win the `||` fallback chain in
       `localize()` and render as a blank line on the storefront. */
    const blank = (value: string) => (value.trim() === "" ? null : value.trim());

    const body = {
      categoryId: draft.categoryId,
      subclassId: draft.subclassId,
      name: { he: checked.nameHe, en: blank(draft.nameEn), ar: blank(draft.nameAr) },
      description: {
        he: blank(draft.descriptionHe),
        en: blank(draft.descriptionEn),
        ar: blank(draft.descriptionAr),
      },
      priceAgorot: checked.priceAgorot,
      available: draft.available,
      stock: draft.stock.trim() === "" ? null : Number(draft.stock),
    };

    const result = existing
      ? await patch(`/api/manager/products/${existing.id}`, body)
      : await post("/api/manager/products", body);

    setSaving(false);

    if (!result.ok) {
      if (result.error.field) {
        setErrors({ [fieldKeyFor(result.error.field)]: result.error.message ?? "" });
      }
      toast(errorMessage(result.error, t), "error");
      return;
    }

    toast(t.manager.saved);
    router.refresh();
    onClose();
  }

  return (
    <Sheet
      open
      onClose={onClose}
      dismissLabel={t.common.dismiss}
      title={existing ? t.manager.editProduct : t.manager.newProduct}
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
        {/* The camera comes first, because it is the first thing the owner
            actually does. A product that does not exist yet has nothing to
            attach a photo to, so this waits for the first save. */}
        {existing ? (
          <PhotoManager productId={existing.id} images={existing.images} />
        ) : (
          <p className="text-footnote" style={{ color: "var(--label-secondary)" }}>
            {t.manager.photos.hint}
          </p>
        )}

        <TextField
          label={t.manager.fields.nameHe}
          value={draft.nameHe}
          onChange={(value) => field("nameHe", value)}
          error={errors.nameHe}
          autoFocus={!existing}
        />

        <TextField
          label={t.manager.fields.price}
          value={draft.price}
          onChange={(value) => field("price", value)}
          prefix="₪"
          inputMode="decimal"
          error={errors.price}
        />

        <Picker
          label={t.manager.fields.category}
          value={draft.categoryId}
          error={errors.categoryId}
          options={categories.map((category) => ({
            value: category.id,
            label: localize(category.name, locale),
          }))}
          onChange={(value) =>
            setDraft((current) => ({
              ...current,
              categoryId: value,
              /* Moving category strands the old subclass, so clear it rather
                 than letting the pairing go invalid between two taps. */
              subclassId: null,
            }))
          }
        />

        <Picker
          label={t.manager.fields.subclass}
          value={draft.subclassId ?? ""}
          options={[
            { value: "", label: t.manager.directlyInCategory },
            ...available.map((subclass) => ({
              value: subclass.id,
              label: localize(subclass.name, locale),
            })),
          ]}
          onChange={(value) => field("subclassId", value === "" ? null : value)}
        />

        <Disclosure label={`${t.common.settings} · ${t.common.optional}`}>
          <TextField
            label={t.manager.fields.nameEn}
            value={draft.nameEn}
            onChange={(value) => field("nameEn", value)}
          />
          <TextField
            label={t.manager.fields.nameAr}
            value={draft.nameAr}
            onChange={(value) => field("nameAr", value)}
          />
          <TextField
            label={t.manager.fields.descriptionHe}
            value={draft.descriptionHe}
            onChange={(value) => field("descriptionHe", value)}
            multiline
          />
          <TextField
            label={t.manager.fields.descriptionEn}
            value={draft.descriptionEn}
            onChange={(value) => field("descriptionEn", value)}
            multiline
          />
          <TextField
            label={t.manager.fields.descriptionAr}
            value={draft.descriptionAr}
            onChange={(value) => field("descriptionAr", value)}
            multiline
          />
          <TextField
            label={t.manager.fields.stock}
            value={draft.stock}
            onChange={(value) => field("stock", value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            helper={t.manager.fields.stockHelper}
          />

          <div className="flex min-h-11 items-center justify-between gap-4">
            <span className="text-body">{t.manager.fields.available}</span>
            <Switch
              checked={draft.available}
              onChange={(value) => field("available", value)}
              label={t.manager.fields.available}
            />
          </div>
        </Disclosure>

        {existing && (
          <Button
            variant="destructive"
            fullWidth
            onClick={() => {
              onClose();
              onDelete(existing);
            }}
          >
            {t.common.delete}
          </Button>
        )}
      </div>
    </Sheet>
  );
}

/** Maps an API field name back onto the draft key the input is bound to. */
function fieldKeyFor(apiField: string): keyof Draft {
  switch (apiField) {
    case "priceAgorot":
      return "price";
    case "categoryId":
      return "categoryId";
    case "subclassId":
      return "subclassId";
    case "stock":
      return "stock";
    default:
      return "nameHe";
  }
}
