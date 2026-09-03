"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Camera, X } from "lucide-react";
import { Spinner, useToast } from "@/components/ios/Feedback";
import { ICON_SIZE } from "@/components/ios/Icon";
import { haptic } from "@/lib/haptics";
import { imageUrl } from "@/lib/images";
import { useI18n } from "@/lib/i18n";
import type { ProductImage } from "@/lib/types";
import { del, errorMessage, upload } from "./api";

/* Mirrors the server's ceiling and the bucket's own limit. Checked here too so
   an 11MB photo fails instantly instead of after a minute of uploading over a
   phone tether — the server still checks, because a client-side check is a
   convenience, never a control. */
const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/avif"];

export function PhotoManager({
  productId,
  images,
}: {
  productId: string;
  images: ProductImage[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onPick(file: File) {
    if (file.size > MAX_BYTES) {
      toast(t.manager.photos.tooLarge, "error");
      return;
    }
    if (!ACCEPTED.includes(file.type)) {
      toast(t.manager.photos.wrongType, "error");
      return;
    }

    setBusy(true);
    const form = new FormData();
    form.set("productId", productId);
    form.set("file", file);

    const result = await upload("/api/manager/upload", form);
    setBusy(false);

    if (!result.ok) {
      toast(errorMessage(result.error, t), "error");
      return;
    }

    haptic("success");
    router.refresh();
  }

  async function remove(imageId: string) {
    const result = await del(`/api/manager/images/${imageId}`);
    if (!result.ok) {
      toast(errorMessage(result.error, t), "error");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-footnote px-1" style={{ color: "var(--label-secondary)" }}>
        {t.manager.photos.title}
      </span>

      <div className="flex flex-wrap items-center gap-2">
        {images.map((image) => (
          <span key={image.id} className="relative">
            <Image
              src={imageUrl(image.path)}
              alt=""
              width={80}
              height={80}
              className="size-20 object-cover"
              style={{
                borderRadius: "var(--radius-card)",
                backgroundColor: "var(--fill-tertiary)",
              }}
            />
            <button
              type="button"
              aria-label={t.manager.photos.removeAria}
              onClick={() => remove(image.id)}
              /* Offset outward on the trailing edge so it mirrors with the
                 layout, and 44pt despite the 20pt glyph. */
              className="press absolute -top-2 -end-2 flex size-11 items-center justify-center"
              onPointerDown={() => haptic("light")}
            >
              <span
                className="flex size-6 items-center justify-center rounded-full"
                style={{ backgroundColor: "var(--ios-red)", boxShadow: "var(--shadow-card)" }}
              >
                <X size={14} strokeWidth={3} color="#fff" aria-hidden="true" />
              </span>
            </button>
          </span>
        ))}

        <button
          type="button"
          onClick={() => {
            haptic("light");
            input.current?.click();
          }}
          disabled={busy}
          className="press flex size-20 flex-col items-center justify-center gap-1"
          style={{
            borderRadius: "var(--radius-card)",
            backgroundColor: "var(--fill-tertiary)",
            color: "var(--ios-blue)",
            opacity: busy ? 0.5 : 1,
          }}
        >
          {busy ? (
            <Spinner label={t.manager.photos.uploading} />
          ) : (
            <>
              <Camera size={ICON_SIZE.lg} strokeWidth={1.9} aria-hidden="true" />
              <span className="text-caption-2 font-medium">{t.manager.photos.add}</span>
            </>
          )}
        </button>
      </div>

      {/*
        `capture="environment"` is the whole workflow: on a phone it opens the
        rear camera directly instead of a file browser, which is the difference
        between photographing a keychain in two taps and going hunting through
        a gallery. On a desktop the attribute is ignored and this is an
        ordinary file input.
      */}
      <input
        ref={input}
        type="file"
        accept={ACCEPTED.join(",")}
        capture="environment"
        className="sr-only"
        aria-label={t.manager.photos.add}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so picking the same file twice fires a change event again.
          event.target.value = "";
          if (file) void onPick(file);
        }}
      />

      {images.length === 0 && !busy && (
        <p className="text-footnote px-1" style={{ color: "var(--label-secondary)" }}>
          {t.manager.photos.none} · {t.manager.photos.hint}
        </p>
      )}
    </div>
  );
}
