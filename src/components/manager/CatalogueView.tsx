"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, FolderPlus, Layers, PackagePlus, Plus } from "lucide-react";
import { NavBar } from "@/components/ios/NavBar";
import { ListGroup, ListRow } from "@/components/ios/List";
import { Button } from "@/components/ios/Controls";
import { ActionSheet, type SheetAction } from "@/components/ios/Sheet";
import { EmptyState, useToast } from "@/components/ios/Feedback";
import { ICON_SIZE, IconTile } from "@/components/ios/Icon";
import { resolveIcon, resolveTint } from "@/lib/categoryIcons";
import { formatAgorot } from "@/lib/money";
import { groupLadder } from "@/lib/pricing";
import { localize, type Category, type PricingRule, type Product, type Subclass } from "@/lib/types";
import { useI18n } from "@/lib/i18n";
import { imageUrl } from "@/lib/images";
import { del, errorMessage, post } from "./api";
import { ReadOnlyBanner } from "./ReadOnlyBanner";
import { ProductEditor } from "./ProductEditor";
import { GroupEditor } from "./GroupEditor";

/* ==========================================================================
   The catalogue, as an inset grouped list

   Shaped like iOS Settings rather than a table, because the owner works this
   one-handed on a phone while standing at a truck. Everything is a 44pt row;
   nothing needs a pointer.

   Categories are collapsible. Expanding one reveals its subclasses, the
   products in each, and any products sitting directly in the category.
   ========================================================================== */

interface Props {
  categories: Category[];
  subclasses: Subclass[];
  products: Product[];
  rules: PricingRule[];
  live: boolean;
}

/** What the product editor is currently open on. */
type ProductTarget =
  | { mode: "new"; categoryId: string; subclassId: string | null }
  | { mode: "edit"; product: Product };

/** What the category/subclass editor is currently open on. */
type GroupTarget =
  | { kind: "category"; row: Category | null }
  | { kind: "subclass"; row: Subclass | null; categoryId: string };

export function CatalogueView({ categories, subclasses, products, rules, live }: Props) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const toast = useToast();

  /* Expansion is UI state and belongs in the component, not the URL: which
     categories are open is not worth a back-button entry, and restoring it on
     a refresh would fight the owner rather than help them. */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [productTarget, setProductTarget] = useState<ProductTarget | null>(null);
  const [groupTarget, setGroupTarget] = useState<GroupTarget | null>(null);
  const [pendingDelete, setPendingDelete] = useState<
    { kind: "category" | "subclass" | "product"; id: string; name: string } | null
  >(null);

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function reorder(entity: "categories" | "subclasses" | "products", ids: string[]) {
    const result = await post("/api/manager/reorder", { entity, ids });
    if (!result.ok) {
      toast(errorMessage(result.error, t), "error");
      return;
    }
    router.refresh();
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const { kind, id, name } = pendingDelete;
    setPendingDelete(null);

    const path =
      kind === "category" ? "categories" : kind === "subclass" ? "subclasses" : "products";
    const result = await del(`/api/manager/${path}/${id}`);

    if (!result.ok) {
      toast(errorMessage(result.error, t), "error");
      return;
    }
    toast(t.manager.deleted(name));
    router.refresh();
  }

  const totalProducts = products.length;

  return (
    <>
      <NavBar
        title={t.manager.tabs.catalogue}
        subtitle={t.manager.itemCount(totalProducts)}
        trailing={
          <Button
            size="sm"
            variant="plain"
            disabled={!live}
            ariaLabel={t.manager.newCategory}
            onClick={() => setGroupTarget({ kind: "category", row: null })}
            icon={<Plus size={ICON_SIZE.md} strokeWidth={2.5} aria-hidden="true" />}
          >
            {t.manager.newCategory}
          </Button>
        }
      />

      {!live && <ReadOnlyBanner />}

      {categories.length === 0 ? (
        <EmptyState
          icon={Layers}
          title={t.manager.categories}
          message={t.shop.emptyMessage}
          action={
            <Button
              disabled={!live}
              onClick={() => setGroupTarget({ kind: "category", row: null })}
              icon={<FolderPlus size={ICON_SIZE.sm} strokeWidth={2.25} aria-hidden="true" />}
            >
              {t.manager.newCategory}
            </Button>
          }
        />
      ) : (
        categories.map((category, index) => {
          const open = expanded.has(category.id);
          const own = subclasses.filter((s) => s.categoryId === category.id);
          const inCategory = products.filter((p) => p.categoryId === category.id);
          const loose = inCategory.filter((p) => p.subclassId === null);

          return (
            <ListGroup key={category.id}>
              <ListRow
                leading={
                  <IconTile
                    icon={resolveIcon(category.icon)}
                    tint={resolveTint(category.tint)}
                    size="lg"
                  />
                }
                title={localize(category.name, locale)}
                subtitle={
                  category.visible
                    ? t.manager.itemCount(inCategory.length)
                    : `${t.manager.itemCount(inCategory.length)} · ${t.manager.fields.visible}: ${t.common.no}`
                }
                onClick={() => toggle(category.id)}
                trailing={
                  <span className="flex items-center gap-1">
                    <MoveButtons
                      disabled={!live}
                      index={index}
                      total={categories.length}
                      upLabel={t.manager.moveUp}
                      downLabel={t.manager.moveDown}
                      onMove={(to) =>
                        reorder("categories", swap(categories.map((c) => c.id), index, to))
                      }
                    />
                    <ChevronRight
                      size={ICON_SIZE.md}
                      strokeWidth={2.5}
                      aria-hidden="true"
                      className="shrink-0"
                      style={{
                        color: "var(--label-tertiary)",
                        transform: open ? "rotate(90deg)" : "rotate(0deg) scaleX(var(--dir, 1))",
                        transition: "transform 0.22s var(--ease-ios)",
                      }}
                    />
                  </span>
                }
              />

              {open && (
                <div className="stagger">
                  {own.map((subclass, subIndex) => {
                    const inSubclass = inCategory.filter((p) => p.subclassId === subclass.id);
                    const deal = dealCaption(subclass.id, inSubclass, rules, t);

                    return (
                      <div key={subclass.id}>
                        <ListRow
                          leading={<Spacer />}
                          title={localize(subclass.name, locale)}
                          subtitle={deal ?? t.manager.itemCount(inSubclass.length)}
                          onClick={() =>
                            setGroupTarget({
                              kind: "subclass",
                              row: subclass,
                              categoryId: category.id,
                            })
                          }
                          trailing={
                            <MoveButtons
                              disabled={!live}
                              index={subIndex}
                              total={own.length}
                              upLabel={t.manager.moveUp}
                              downLabel={t.manager.moveDown}
                              onMove={(to) =>
                                reorder("subclasses", swap(own.map((s) => s.id), subIndex, to))
                              }
                            />
                          }
                        />
                        {inSubclass.map((product) => (
                          <ProductRow
                            key={product.id}
                            product={product}
                            depth={2}
                            onEdit={() => setProductTarget({ mode: "edit", product })}
                          />
                        ))}
                        <AddRow
                          disabled={!live}
                          label={t.manager.newProduct}
                          depth={2}
                          onClick={() =>
                            setProductTarget({
                              mode: "new",
                              categoryId: category.id,
                              subclassId: subclass.id,
                            })
                          }
                        />
                      </div>
                    );
                  })}

                  {loose.map((product) => (
                    <ProductRow
                      key={product.id}
                      product={product}
                      depth={1}
                      onEdit={() => setProductTarget({ mode: "edit", product })}
                    />
                  ))}

                  <AddRow
                    disabled={!live}
                    label={t.manager.newSubclass}
                    depth={1}
                    icon={Layers}
                    onClick={() =>
                      setGroupTarget({ kind: "subclass", row: null, categoryId: category.id })
                    }
                  />
                  <AddRow
                    disabled={!live}
                    label={t.manager.newProduct}
                    depth={1}
                    icon={PackagePlus}
                    onClick={() =>
                      setProductTarget({
                        mode: "new",
                        categoryId: category.id,
                        subclassId: null,
                      })
                    }
                  />
                  <ListRow
                    leading={<Spacer />}
                    title={t.manager.editCategory}
                    onClick={() => setGroupTarget({ kind: "category", row: category })}
                  />
                </div>
              )}
            </ListGroup>
          );
        })
      )}

      {productTarget && (
        <ProductEditor
          target={productTarget}
          categories={categories}
          subclasses={subclasses}
          onClose={() => setProductTarget(null)}
          onDelete={(product) =>
            setPendingDelete({
              kind: "product",
              id: product.id,
              name: localize(product.name, locale),
            })
          }
        />
      )}

      {groupTarget && (
        <GroupEditor
          target={groupTarget}
          onClose={() => setGroupTarget(null)}
          onDelete={(kind, id, name) => setPendingDelete({ kind, id, name })}
        />
      )}

      <ActionSheet
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title={pendingDelete ? t.manager.confirmDelete(pendingDelete.name) : undefined}
        message={t.manager.confirmDeleteBody}
        cancelLabel={t.common.cancel}
        actions={
          [
            { label: t.common.delete, destructive: true, onSelect: confirmDelete },
          ] satisfies SheetAction[]
        }
      />
    </>
  );
}

/* --------------------------------------------------------------------------
   Row pieces
   -------------------------------------------------------------------------- */

/** Keeps nested rows aligned with the icon column above them. */
function Spacer() {
  return <span aria-hidden="true" className="block w-7" />;
}

function ProductRow({
  product,
  depth,
  onEdit,
}: {
  product: Product;
  depth: number;
  onEdit: () => void;
}) {
  const { t, locale } = useI18n();
  const photo = product.images[0];

  const status = !product.available
    ? t.shop.outOfStock
    : product.stock === 0
      ? t.shop.outOfStock
      : product.stock !== null
        ? t.shop.onlyLeft(product.stock)
        : undefined;

  return (
    <ListRow
      leading={
        <span className="flex items-center gap-2">
          {depth > 1 && <Spacer />}
          <span
            className="size-9 shrink-0 overflow-hidden bg-cover bg-center"
            style={{
              borderRadius: "var(--radius-control)",
              backgroundColor: "var(--fill-tertiary)",
              backgroundImage: photo ? `url(${imageUrl(photo.path)})` : undefined,
            }}
            aria-hidden="true"
          />
        </span>
      }
      title={localize(product.name, locale)}
      subtitle={status}
      /* The price is digits next to Hebrew text, so it is isolated. Without
         this the shekel sign and the number swap sides. */
      value={<span className="ltr-nums">{formatAgorot(product.priceAgorot)}</span>}
      onClick={onEdit}
    />
  );
}

function AddRow({
  label,
  depth,
  onClick,
  disabled,
  icon: Glyph = Plus,
}: {
  label: string;
  depth: number;
  onClick: () => void;
  disabled: boolean;
  icon?: typeof Plus;
}) {
  return (
    <ListRow
      leading={
        <span className="flex items-center gap-2">
          {depth > 1 && <Spacer />}
          <span
            aria-hidden="true"
            className="flex size-7 items-center justify-center"
            style={{ color: "var(--ios-blue)" }}
          >
            <Glyph size={ICON_SIZE.md} strokeWidth={2.25} />
          </span>
        </span>
      }
      title={<span style={{ color: disabled ? undefined : "var(--ios-blue)" }}>{label}</span>}
      onClick={onClick}
      disabled={disabled}
      trailing={<span />}
    />
  );
}

function MoveButtons({
  index,
  total,
  onMove,
  upLabel,
  downLabel,
  disabled,
}: {
  index: number;
  total: number;
  onMove: (to: number) => void;
  upLabel: string;
  downLabel: string;
  disabled: boolean;
}) {
  /* Buttons, not drag-and-drop. Dragging is unusable one-handed on a phone and
     is a genuine problem for assistive tech; two 44pt buttons are neither. */
  return (
    <span className="flex items-center">
      <MoveButton
        label={upLabel}
        direction="up"
        disabled={disabled || index === 0}
        onClick={() => onMove(index - 1)}
      />
      <MoveButton
        label={downLabel}
        direction="down"
        disabled={disabled || index === total - 1}
        onClick={() => onMove(index + 1)}
      />
    </span>
  );
}

function MoveButton({
  label,
  direction,
  disabled,
  onClick,
}: {
  label: string;
  direction: "up" | "down";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        // The row itself is a button; without this the tap also toggles it.
        event.stopPropagation();
        onClick();
      }}
      className="press flex size-11 items-center justify-center rounded-full"
      style={{ color: "var(--label-tertiary)", opacity: disabled ? 0.25 : 1 }}
    >
      <ChevronRight
        size={ICON_SIZE.sm}
        strokeWidth={2.75}
        aria-hidden="true"
        style={{ transform: direction === "up" ? "rotate(-90deg)" : "rotate(90deg)" }}
      />
    </button>
  );
}

/* --------------------------------------------------------------------------
   Helpers
   -------------------------------------------------------------------------- */

/** A copy of `ids` with the item at `from` moved to `to`. */
function swap(ids: string[], from: number, to: number): string[] {
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(to, 0, moved);
  return next;
}

/**
 * "3 for ₪25" for a subclass.
 *
 * Only rules scoped to the subclass itself count. Deriving this from a sample
 * product would pick up that product's own private deal and label the whole
 * subclass with it — the owner would then be looking at a caption that does
 * not match what the till charges.
 */
function dealCaption(
  subclassId: string,
  items: Product[],
  rules: PricingRule[],
  t: ReturnType<typeof useI18n>["t"]
): string | undefined {
  const cheapest = items.length > 0 ? Math.min(...items.map((p) => p.priceAgorot)) : 0;
  const ladder = groupLadder("subclass", subclassId, cheapest, rules);

  const best = ladder.at(-1);
  if (!best || best.qty < 2) return undefined;

  return t.shop.bundleHint(best.qty, formatAgorot(best.priceAgorot));
}
