"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, UserPlus } from "lucide-react";
import { NavBar } from "@/components/ios/NavBar";
import { ListGroup, ListRow } from "@/components/ios/List";
import { Button, SegmentedControl, Switch, TextField } from "@/components/ios/Controls";
import { useToast } from "@/components/ios/Feedback";
import { ICON_SIZE } from "@/components/ios/Icon";
import { SignOutButton } from "@/components/SignInButton";
import { useI18n } from "@/lib/i18n";
import { useTheme, type Theme } from "@/lib/theme";
import { LOCALES, type Locale, type ShopSettings } from "@/lib/types";
import { del, errorMessage, patch, post } from "./api";
import { ReadOnlyBanner } from "./ReadOnlyBanner";

/* ==========================================================================
   Settings

   Each group has its own Save button and saves independently. Nothing is
   debounced or saved on blur: a half-typed WhatsApp number must never reach
   the database, because the storefront builds a live wa.me link out of it and
   a half-typed number is a link to nobody.
   ========================================================================== */

interface Props {
  settings: ShopSettings;
  live: boolean;
  ownerEmail: string | null;
  invites: { email: string; role: string }[];
  /* Whether a payment provider has its credentials server-side. Resolved on
     the server and passed in, because the answer lives in environment
     variables that must never reach a browser bundle. */
  cardProviderConfigured: boolean;
}

export function SettingsView({
  settings,
  live,
  ownerEmail,
  invites,
  cardProviderConfigured,
}: Props) {
  const { t, locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const toast = useToast();

  const [open, setOpen] = useState(settings.open);
  const [closedHe, setClosedHe] = useState(settings.closedMessage.he);
  const [bitLink, setBitLink] = useState(settings.bitPaymentLink);
  const [phone, setPhone] = useState(settings.whatsappPhone);
  const [announceHe, setAnnounceHe] = useState(settings.announcement?.he ?? "");
  const [checkoutEnabled, setCheckoutEnabled] = useState(settings.checkoutEnabled);
  const [onlinePayments, setOnlinePayments] = useState(settings.onlinePaymentsEnabled);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"owner" | "staff">("staff");
  const [errors, setErrors] = useState<{ bitLink?: string; phone?: string; invite?: string }>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function saveGroup(group: string, body: Record<string, unknown>) {
    setBusy(group);
    const result = await patch("/api/manager/settings", body);
    setBusy(null);

    if (!result.ok) {
      toast(errorMessage(result.error, t), "error");
      return;
    }
    toast(t.manager.saved);
    router.refresh();
  }

  async function savePayment() {
    const next: typeof errors = {};

    /* Validated here as well as on the server so the owner sees which field is
       wrong, not just that something is. The server's check is the one that
       matters: the Bit link becomes a navigation target for customers, so a
       `javascript:` URL stored here would run in their browser. */
    if (bitLink.trim() !== "") {
      try {
        if (new URL(bitLink.trim()).protocol !== "https:") {
          next.bitLink = t.manager.settingsScreen.bitLinkInvalid;
        }
      } catch {
        next.bitLink = t.manager.settingsScreen.bitLinkInvalid;
      }
    }
    if (!/^[0-9]{9,15}$/.test(phone.trim())) {
      next.phone = t.manager.settingsScreen.whatsappInvalid;
    }

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    await saveGroup("payment", {
      bitPaymentLink: bitLink.trim(),
      whatsappPhone: phone.trim(),
    });
  }

  async function invite() {
    const email = inviteEmail.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setErrors({ invite: t.manager.settingsScreen.inviteEmailInvalid });
      return;
    }
    setErrors({});
    setBusy("invite");

    const result = await post("/api/manager/staff", { email, role: inviteRole });
    setBusy(null);

    if (!result.ok) {
      toast(errorMessage(result.error, t), "error");
      return;
    }
    setInviteEmail("");
    toast(t.manager.saved);
    router.refresh();
  }

  async function revoke(email: string) {
    setBusy(email);
    const result = await del(`/api/manager/staff/${encodeURIComponent(email)}`);
    setBusy(null);

    if (!result.ok) {
      toast(errorMessage(result.error, t), "error");
      return;
    }
    router.refresh();
  }

  const s = t.manager.settingsScreen;

  return (
    <>
      <NavBar title={s.title} />

      {!live && <ReadOnlyBanner />}

      {/* ---- Shop ---- */}
      <ListGroup header={s.shopSection} footer={s.shopOpenHelper}>
        <ListRow
          title={s.shopOpen}
          trailing={<Switch checked={open} onChange={setOpen} label={s.shopOpen} disabled={!live} />}
        />
      </ListGroup>

      <div className="mb-8 flex flex-col gap-4">
        <TextField label={s.closedMessage} value={closedHe} onChange={setClosedHe} multiline />
        <Button
          onClick={() => saveGroup("shop", { open, closedMessage: { he: closedHe } })}
          loading={busy === "shop"}
          disabled={!live}
          fullWidth
        >
          {t.common.save}
        </Button>
      </div>

      {/* ---- Payment & contact ---- */}
      <div className="mb-8 flex flex-col gap-4">
        <h2 className="text-footnote px-4 tracking-wide uppercase" style={{ color: "var(--label-secondary)" }}>
          {s.paymentSection}
        </h2>
        <TextField
          label={s.bitLink}
          value={bitLink}
          onChange={setBitLink}
          type="url"
          inputMode="url"
          helper={s.bitLinkHelper}
          error={errors.bitLink}
        />
        <TextField
          label={s.whatsapp}
          value={phone}
          onChange={(value) => setPhone(value.replace(/[^0-9]/g, ""))}
          inputMode="numeric"
          helper={s.whatsappHelper}
          error={errors.phone}
        />
        <Button onClick={savePayment} loading={busy === "payment"} disabled={!live} fullWidth>
          {t.common.save}
        </Button>
      </div>

      {/* ---- Orders ----
          Its own group with its own Save, like everything else here. The two
          switches are not the same kind of thing and the footers say so:
          the first stops new orders arriving, the second decides whether card
          payment is offered inside one. ---- */}
      <ListGroup header={s.checkoutSection} footer={s.checkoutEnabledHelper}>
        <ListRow
          title={s.checkoutEnabled}
          trailing={
            <Switch
              checked={checkoutEnabled}
              onChange={setCheckoutEnabled}
              label={s.checkoutEnabled}
              disabled={!live}
            />
          }
        />
        <ListRow
          title={s.onlinePayments}
          subtitle={cardProviderConfigured ? undefined : s.onlinePaymentsUnavailable}
          trailing={
            <Switch
              checked={onlinePayments}
              onChange={setOnlinePayments}
              label={s.onlinePayments}
              /* Off *and* untouchable with no provider behind it. A switch
                 that turns on a button which dead-ends at a counter is worse
                 than no switch. */
              disabled={!live || !cardProviderConfigured}
            />
          }
        />
      </ListGroup>

      <div className="mb-8 flex flex-col gap-4">
        <p className="text-footnote px-4" style={{ color: "var(--label-secondary)" }}>
          {s.onlinePaymentsHelper}
        </p>
        <Button
          onClick={() =>
            saveGroup("checkout", {
              checkoutEnabled,
              onlinePaymentsEnabled: onlinePayments,
            })
          }
          loading={busy === "checkout"}
          disabled={!live}
          fullWidth
        >
          {t.common.save}
        </Button>
      </div>

      {/* ---- Announcement ---- */}
      <div className="mb-8 flex flex-col gap-4">
        <h2 className="text-footnote px-4 tracking-wide uppercase" style={{ color: "var(--label-secondary)" }}>
          {s.announcement}
        </h2>
        <TextField
          label={s.announcement}
          value={announceHe}
          onChange={setAnnounceHe}
          helper={s.announcementHelper}
          multiline
        />
        <Button
          onClick={() =>
            saveGroup("announce", {
              announcement: announceHe.trim() === "" ? null : { he: announceHe.trim() },
            })
          }
          loading={busy === "announce"}
          disabled={!live}
          fullWidth
        >
          {t.common.save}
        </Button>
      </div>

      {/* ---- Appearance & language. Local to this device, so no Save. ---- */}
      <div className="mb-8 flex flex-col gap-4">
        <h2 className="text-footnote px-4 tracking-wide uppercase" style={{ color: "var(--label-secondary)" }}>
          {s.appearanceSection}
        </h2>

        {/* `dir="ltr"` pins the track order: a language switcher whose options
            change places when you change language is disorienting. */}
        <div dir="ltr">
          <SegmentedControl<Locale>
            label={t.common.language}
            value={locale}
            onChange={setLocale}
            options={LOCALES.map((code) => ({
              value: code,
              label: code === "he" ? s.langHe : code === "en" ? s.langEn : s.langAr,
            }))}
          />
        </div>

        <SegmentedControl<Theme>
          label={t.common.appearance}
          value={theme}
          onChange={setTheme}
          options={[
            { value: "dark", label: t.common.dark },
            { value: "light", label: t.common.light },
          ]}
        />
      </div>

      {/* ---- Staff ---- */}
      <ListGroup header={s.staff} footer={s.staffHelper}>
        {ownerEmail && <ListRow title={ownerEmail} subtitle={t.manager.signedInAs} />}
        {invites.length === 0 ? (
          <ListRow title={s.noPendingInvites} />
        ) : (
          invites.map((row) => (
            <ListRow
              key={row.email}
              title={row.email}
              subtitle={row.role === "owner" ? s.roleOwner : s.roleStaff}
              trailing={
                <button
                  type="button"
                  aria-label={s.revokeAria(row.email)}
                  disabled={!live || busy === row.email}
                  onClick={() => revoke(row.email)}
                  className="press flex size-11 items-center justify-center rounded-full"
                  style={{ color: "var(--ios-red)", opacity: live ? 1 : 0.4 }}
                >
                  <Trash2 size={ICON_SIZE.md} strokeWidth={2} aria-hidden="true" />
                </button>
              }
            />
          ))
        )}
      </ListGroup>

      <div className="mb-8 flex flex-col gap-4">
        <TextField
          label={s.inviteEmail}
          value={inviteEmail}
          onChange={setInviteEmail}
          inputMode="text"
          error={errors.invite}
        />
        <div dir="ltr">
          <SegmentedControl<"owner" | "staff">
            label={s.inviteRole}
            value={inviteRole}
            onChange={setInviteRole}
            options={[
              { value: "staff", label: s.roleStaff },
              { value: "owner", label: s.roleOwner },
            ]}
          />
        </div>
        <Button
          onClick={invite}
          loading={busy === "invite"}
          disabled={!live}
          fullWidth
          icon={<UserPlus size={ICON_SIZE.sm} strokeWidth={2.25} aria-hidden="true" />}
        >
          {s.invite}
        </Button>
      </div>

      <div className="mb-8 flex justify-center">
        <SignOutButton />
      </div>
    </>
  );
}
