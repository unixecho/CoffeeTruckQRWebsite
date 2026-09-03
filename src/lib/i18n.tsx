"use client";

import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { LOCALES, isRtl, type Locale } from "./types";

/* ==========================================================================
   Trilingual UI strings

   Hebrew, English, Arabic. Hebrew is the default and the primary language:
   it is what the stand is worked in, and it is what a customer walking up to
   the QR code sees first.

   Every visible string lives here, in all three languages. A string added to
   one block and not the others is a type error, which is the point — the
   old static site drifted out of sync exactly that way.

   Product *content* (names, descriptions) is not here; it lives in the
   database as localized columns and is read with `localize()` from types.ts.
   ========================================================================== */

const STORAGE_KEY = "coffeetruck-locale";

/* --------------------------------------------------------------------------
   The store

   `useSyncExternalStore`, not `useState` plus an effect. A server render has
   no localStorage to read, so it can only ever render Hebrew; starting the
   client at anything else would render English text against Hebrew-shaped
   server HTML and fail hydration. This is the API React built for exactly
   that split — the server snapshot through hydration, then a resync to the
   real value immediately after.
   -------------------------------------------------------------------------- */

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Locale {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return (LOCALES as readonly string[]).includes(stored ?? "") ? (stored as Locale) : "he";
}

function getServerSnapshot(): Locale {
  return "he";
}

/**
 * Mirrors the choice onto the document.
 *
 * `lang` and `dir` must reflect what is actually on screen, not a hardcoded
 * server default — a switcher that changes the words but leaves `lang="he"`
 * on an English page leaves a screen reader pronouncing English with Hebrew
 * phonetics. PLAYBOOK.md §2.4.
 */
function apply(locale: Locale) {
  document.documentElement.lang = locale;
  document.documentElement.dir = isRtl(locale) ? "rtl" : "ltr";
}

interface LocaleContextValue {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: Dict;
  dir: "rtl" | "ltr";
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: "he",
  setLocale: () => {},
  t: {} as Dict,
  dir: "rtl",
});

export function useI18n(): LocaleContextValue {
  return useContext(LocaleContext);
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setLocale = useCallback((next: Locale) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    apply(next);
    listeners.forEach((listener) => listener());
  }, []);

  const value: LocaleContextValue = {
    locale,
    setLocale,
    t: DICT[locale],
    dir: isRtl(locale) ? "rtl" : "ltr",
  };

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/**
 * Read once, synchronously, before React hydrates.
 *
 * Without this the first paint is always Hebrew RTL and an English visitor
 * watches the whole layout flip after hydration.
 */
export const LOCALE_NO_FLASH_SCRIPT = `
try {
  var l = localStorage.getItem(${JSON.stringify(STORAGE_KEY)}) || "he";
  if (["he","en","ar"].indexOf(l) < 0) l = "he";
  document.documentElement.lang = l;
  document.documentElement.dir = (l === "he" || l === "ar") ? "rtl" : "ltr";
} catch (e) {}
`;

/* ==========================================================================
   The dictionary
   ========================================================================== */

export interface Dict {
  common: {
    appName: string;
    cancel: string;
    save: string;
    saving: string;
    delete: string;
    edit: string;
    add: string;
    done: string;
    back: string;
    close: string;
    dismiss: string;
    search: string;
    clearSearch: string;
    retry: string;
    loading: string;
    all: string;
    optional: string;
    required: string;
    yes: string;
    no: string;
    language: string;
    appearance: string;
    light: string;
    dark: string;
    settings: string;
    somethingWentWrong: string;
  };

  landing: {
    eyebrow: string;
    title: string;
    body: string;
    browse: string;
    quickBit: string;
    suggestions: string;
    whatsappInquiry: string;
    whatsappSuggestion: string;
    /** Accessible name for the floating WhatsApp button, which is icon-only. */
    contactAria: string;
  };

  shop: {
    title: string;
    subtitle: string;
    searchPlaceholder: string;
    cart: string;
    cartAria: (count: number) => string;
    addToCart: string;
    addedToCart: (name: string) => string;
    outOfStock: string;
    onlyLeft: (n: number) => string;
    emptyTitle: string;
    emptyMessage: string;
    noMatchesTitle: string;
    noMatchesMessage: (query: string) => string;
    loadErrorTitle: string;
    loadErrorMessage: string;
    closedTitle: string;
    bundleHint: (minQty: number, price: string) => string;
    mixAndMatch: string;
    each: string;
  };

  cart: {
    title: string;
    emptyTitle: string;
    emptyMessage: string;
    browse: string;
    subtotal: string;
    savings: string;
    total: string;
    removeAria: (name: string) => string;
    oneMore: string;
    oneFewer: string;
    copyOrderNote: string;
    copied: string;
    copyFailed: string;
    payWithBit: string;
    paymentNote: string;
    bitNotConfigured: string;
    orderNoteHeading: string;
    clear: string;
    bundleApplied: (times: number, minQty: number) => string;
    /** The primary action once ordering is switched on. */
    placeOrder: string;
    orderInstead: string;
  };

  /**
   * The checkout and the order screen.
   *
   * Kept as its own block rather than folded into `cart`, because the cart is
   * a sheet the customer opens and closes while browsing and this is a flow
   * they commit to. Mixing them would mean every checkout string travelling
   * into a component that only ever wanted a total.
   */
  checkout: {
    title: string;
    steps: { review: string; details: string; payment: string };
    stepAria: (index: number, total: number) => string;
    back: string;
    continue: string;
    placeOrder: string;
    placing: string;

    emptyTitle: string;
    emptyMessage: string;
    disabledTitle: string;
    disabledMessage: string;

    detailsIntro: string;
    name: string;
    namePlaceholder: string;
    optional: string;
    phone: string;
    phonePlaceholder: string;
    phoneHelper: string;
    phoneInvalid: string;
    note: string;
    notePlaceholder: string;
    /**
     * Label on the hidden anti-spam field.
     *
     * Never read by a person, but it is a real `<label>` all the same: a
     * screen reader that does reach the input must not find an unlabelled
     * box. The field is skipped by keyboard and explained in place.
     */
    honeypotLabel: string;

    method: string;
    methodCounter: string;
    methodCounterHelper: string;
    methodCard: string;
    methodCardHelper: string;
    methodCardUnavailable: string;

    summary: string;
    itemCount: (n: number) => string;

    orderTitle: string;
    orderNumber: string;
    showAtCounter: string;
    payAtCounter: string;
    payAtCounterHelper: string;
    payByCard: string;
    payingTitle: string;
    payingHelper: string;
    paymentWindow: string;
    expiresIn: (minutes: number) => string;
    expiredTitle: string;
    expiredMessage: string;
    paidTitle: string;
    paidMessage: string;
    collectedTitle: string;
    collectedMessage: string;
    cancelledTitle: string;
    cancelledMessage: string;
    flaggedTitle: string;
    flaggedMessage: string;
    awaitingTitle: string;
    awaitingMessage: string;

    cancelOrder: string;
    cancelConfirmTitle: string;
    cancelConfirmBody: string;
    keepOrder: string;

    privacyTitle: string;
    privacyBody: string;
    forget: string;
    forgetDone: string;
    forgetConfirmTitle: string;
    forgetConfirmBody: string;

    retry: string;
    backToShop: string;
    copySummary: string;
    viewOrder: string;

    /**
     * Keyed off the server's error **codes**, never its messages.
     *
     * A validator that returns English prose renders Hebrew text to an Arabic
     * reader, and it is an easy bug to ship because the validator is usually
     * written next to a single-language screen. Unknown codes fall back to
     * `generic`, so adding a reason server-side can never render blank.
     * PLAYBOOK §4.4.
     */
    errors: {
      generic: string;
      offline: string;
      rateLimited: string;
      unavailable: string;
      expired: string;
      alreadyPaid: string;
      providerDown: string;
      cartEmpty: string;
      notFound: string;
      disabled: string;
    };
  };

  manager: {
    title: string;
    signIn: string;
    signInWithGoogle: string;
    signInBlurb: string;
    signOut: string;
    signedInAs: string;
    noAccessTitle: string;
    noAccessMessage: string;

    tabs: { catalogue: string; orders: string; deals: string; settings: string };

    categories: string;
    subclasses: string;
    products: string;
    newCategory: string;
    newSubclass: string;
    newProduct: string;
    editCategory: string;
    editSubclass: string;
    editProduct: string;
    noSubclass: string;
    directlyInCategory: string;

    fields: {
      nameHe: string;
      nameEn: string;
      nameAr: string;
      descriptionHe: string;
      descriptionEn: string;
      descriptionAr: string;
      price: string;
      category: string;
      subclass: string;
      available: string;
      visible: string;
      stock: string;
      stockHelper: string;
      icon: string;
      tint: string;
      photo: string;
      sortOrder: string;
    };

    validation: {
      nameRequired: string;
      priceRequired: string;
      priceInvalid: string;
      categoryRequired: string;
      qtyInvalid: string;
      bundleDearer: string;
      duplicateQty: string;
    };

    photos: {
      title: string;
      add: string;
      uploading: string;
      uploadFailed: string;
      tooLarge: string;
      wrongType: string;
      removeAria: string;
      none: string;
      hint: string;
    };

    orders: {
      title: string;
      subtitle: string;
      openOnly: string;
      all: string;
      none: string;
      noneMessage: string;
      collect: string;
      collectAria: (number: string) => string;
      cancel: string;
      cancelAria: (number: string) => string;
      confirmCancelTitle: (number: string) => string;
      confirmCancelBody: string;
      customer: string;
      noCustomer: string;
      note: string;
      copy: string;
      copied: string;
      paidLabel: string;
      unpaidLabel: string;
      pendingLabel: string;
      flaggedLabel: string;
      flaggedHelper: string;
      methodCounter: string;
      methodCard: string;
      statusPlaced: string;
      statusCollected: string;
      statusCancelled: string;
      statusExpired: string;
      itemsLine: (n: number) => string;
      /** Shown when the checkout is switched off in Settings. */
      checkoutOff: string;
    };

    deals: {
      title: string;
      subtitle: string;
      none: string;
      newDeal: string;
      editDeal: string;
      scope: string;
      scopeProduct: string;
      scopeSubclass: string;
      scopeCategory: string;
      scopeHint: string;
      minQty: string;
      bundlePrice: string;
      active: string;
      labelHe: string;
      startsAt: string;
      endsAt: string;
      ladderPreview: string;
      appliesTo: string;
      perUnit: (price: string) => string;
    };

    settingsScreen: {
      title: string;
      /** Group headers. Each settings group saves on its own, so each is named. */
      shopSection: string;
      paymentSection: string;
      checkoutSection: string;
      appearanceSection: string;
      checkoutEnabled: string;
      checkoutEnabledHelper: string;
      onlinePayments: string;
      onlinePaymentsHelper: string;
      /** Shown when no payment provider is configured server-side. */
      onlinePaymentsUnavailable: string;
      shopOpen: string;
      shopOpenHelper: string;
      closedMessage: string;
      bitLink: string;
      bitLinkHelper: string;
      bitLinkInvalid: string;
      whatsapp: string;
      whatsappHelper: string;
      whatsappInvalid: string;
      announcement: string;
      announcementHelper: string;
      staff: string;
      staffHelper: string;
      inviteEmail: string;
      inviteEmailInvalid: string;
      inviteRole: string;
      roleOwner: string;
      roleStaff: string;
      invite: string;
      pendingInvites: string;
      noPendingInvites: string;
      revoke: string;
      revokeAria: (email: string) => string;
      /**
       * Endonyms. A language is labelled in its own script in every UI
       * language — the same convention iOS uses — so these three are
       * identical across the blocks below rather than translated.
       */
      langHe: string;
      langEn: string;
      langAr: string;
    };

    confirmDelete: (name: string) => string;
    confirmDeleteBody: string;
    /** Shown when the database refuses a delete because something still
        references the row — a category with products still in it. */
    deleteBlocked: string;
    deleted: (name: string) => string;
    saved: string;
    saveFailed: string;
    reorderHint: string;
    moveUp: string;
    moveDown: string;
    itemCount: (n: number) => string;
    readOnlyTitle: string;
    readOnlyMessage: string;
  };
}

/* --------------------------------------------------------------------------
   Hebrew — the primary language. Written first; the others are translations
   of it, not the other way round.
   -------------------------------------------------------------------------- */

const he: Dict = {
  common: {
    appName: "הדפסות תלת־ממד",
    cancel: "ביטול",
    save: "שמירה",
    saving: "שומר…",
    delete: "מחיקה",
    edit: "עריכה",
    add: "הוספה",
    done: "סיום",
    back: "חזרה",
    close: "סגירה",
    dismiss: "סגירה",
    search: "חיפוש",
    clearSearch: "ניקוי החיפוש",
    retry: "נסה שוב",
    loading: "טוען…",
    all: "הכל",
    optional: "לא חובה",
    required: "חובה",
    yes: "כן",
    no: "לא",
    language: "שפה",
    appearance: "מראה",
    light: "בהיר",
    dark: "כהה",
    settings: "הגדרות",
    somethingWentWrong: "משהו השתבש",
  },

  landing: {
    eyebrow: "מוצרים · מתנות · הדפסות תלת־ממד",
    title: "הדפסות קטנות שעושות וואו.",
    body: "חנות קטנה ומהירה ליד עגלת הקפה: בוחרים מוצר, רואים מחיר, ומשלמים בביט בדלפק.",
    browse: "לחנות",
    quickBit: "יודעים מה אתם רוצים? ישר לביט",
    suggestions: "יש לכם הצעה או בקשה? דברו איתי",
    whatsappInquiry: "היי, הגעתי לכאן דרך האתר על מנת ליצור קשר לגבי הדפסת תלת מימד",
    whatsappSuggestion: "היי, הגעתי דרך האתר ויש לי הצעה או בקשה לגבי הדפסת תלת מימד:",
    contactAria: "יצירת קשר בוואטסאפ",
  },

  shop: {
    title: "מוצרים מודפסים בתלת־ממד",
    subtitle: "בוחרים כאן, רואים את הסכום, ומשלמים בביט בדלפק.",
    searchPlaceholder: "חיפוש מוצר",
    cart: "עגלה",
    cartAria: (count) => `עגלה, ${count} פריטים`,
    addToCart: "הוספה לעגלה",
    addedToCart: (name) => `${name} נוסף לעגלה`,
    outOfStock: "אזל המלאי",
    onlyLeft: (n) => `נשארו ${n}`,
    emptyTitle: "אין כרגע מוצרים",
    emptyMessage: "המלאי מתעדכן כל הזמן — שווה לבדוק שוב בקרוב.",
    noMatchesTitle: "לא נמצאו מוצרים",
    noMatchesMessage: (query) => `אין תוצאות עבור ״${query}״.`,
    loadErrorTitle: "לא ניתן לטעון את החנות",
    loadErrorMessage: "בדקו את החיבור לאינטרנט ונסו שוב.",
    closedTitle: "החנות סגורה",
    bundleHint: (minQty, price) => `${minQty} ב־${price}`,
    mixAndMatch: "אפשר לשלב בין הדגמים",
    each: "ליחידה",
  },

  cart: {
    title: "העגלה שלך",
    emptyTitle: "העגלה ריקה",
    emptyMessage: "הוסיפו מוצרים מהחנות והסכום יופיע כאן.",
    browse: "לחנות",
    subtotal: "לפני הנחות",
    savings: "חסכת",
    total: 'סה"כ',
    removeAria: (name) => `הסרת ${name} מהעגלה`,
    oneMore: "עוד אחד",
    oneFewer: "אחד פחות",
    copyOrderNote: "העתקת פתק הזמנה",
    copied: "פתק ההזמנה הועתק",
    copyFailed: "לא ניתן להעתיק",
    payWithBit: "תשלום בביט",
    paymentNote: "ביט ייפתח בנפרד. יש להזין את הסכום ידנית ולהדביק את פתק ההזמנה.",
    bitNotConfigured: "קישור התשלום עדיין לא הוגדר — שלמו בדלפק.",
    orderNoteHeading: "הזמנה",
    clear: "ניקוי העגלה",
    bundleApplied: (times, minQty) => `מבצע ${minQty} יחידות · ${times}×`,
    placeOrder: "שליחת הזמנה",
    orderInstead: "שולחים הזמנה ומקבלים מספר לדלפק.",
  },

  checkout: {
    title: "הזמנה",
    steps: { review: "העגלה", details: "פרטים", payment: "תשלום" },
    stepAria: (index, total) => `שלב ${index} מתוך ${total}`,
    back: "חזרה",
    continue: "המשך",
    placeOrder: "שליחת הזמנה",
    placing: "שולח…",

    emptyTitle: "אין מה להזמין",
    emptyMessage: "העגלה ריקה — הוסיפו משהו מהחנות.",
    disabledTitle: "הזמנות סגורות כרגע",
    disabledMessage: "אפשר לעיין ולשלם בדלפק כרגיל.",

    detailsIntro: "הכל לא חובה. שם עוזר לנו לקרוא לכם כשההזמנה מוכנה.",
    name: "שם",
    namePlaceholder: "איך לקרוא לכם",
    optional: "לא חובה",
    phone: "טלפון",
    phonePlaceholder: "050-0000000",
    phoneHelper: "לא חובה. רק אם צריך להתקשר.",
    phoneInvalid: "מספר טלפון לא תקין",
    note: "הערה",
    notePlaceholder: "משהו שכדאי שנדע",
    honeypotLabel: "חברה",

    method: "תשלום",
    methodCounter: "תשלום בדלפק",
    methodCounterHelper: "ביט או מזומן, כשאתם אוספים.",
    methodCard: "תשלום בכרטיס",
    methodCardHelper: "בעמוד מאובטח של חברת הסליקה. פרטי הכרטיס לא עוברים דרכנו.",
    methodCardUnavailable: "תשלום בכרטיס עדיין לא זמין.",

    summary: "סיכום",
    itemCount: (n) => (n === 1 ? "פריט אחד" : `${n} פריטים`),

    orderTitle: "ההזמנה שלך",
    orderNumber: "מספר הזמנה",
    showAtCounter: "הראו את המסך הזה בדלפק.",
    payAtCounter: "תשלום בדלפק",
    payAtCounterHelper: "ביט או מזומן. הסכום כבר שמור אצלנו.",
    payByCard: "תשלום בכרטיס",
    payingTitle: "מעבירים לתשלום",
    payingHelper: "אל תסגרו את הדף עד שהתשלום מסתיים.",
    paymentWindow: "עמוד התשלום",
    expiresIn: (minutes) => `ההזמנה שמורה עוד ${minutes} דקות`,
    expiredTitle: "ההזמנה פגה",
    expiredMessage: "המחירים מתעדכנים במהלך היום, אז צריך להזמין מחדש.",
    paidTitle: "התשלום התקבל",
    paidMessage: "הראו את מספר ההזמנה בדלפק.",
    collectedTitle: "ההזמנה נמסרה",
    collectedMessage: "תודה, ונתראה בפעם הבאה.",
    cancelledTitle: "ההזמנה בוטלה",
    cancelledMessage: "לא חויבתם. אפשר להזמין שוב מהחנות.",
    flaggedTitle: "התשלום דורש בדיקה",
    flaggedMessage: "הסכום שהתקבל לא תואם להזמנה. גשו לדלפק — אל תשלמו שוב.",
    awaitingTitle: "ממתינים לתשלום",
    awaitingMessage: "אם התשלום כבר בוצע, המסך יתעדכן תוך כמה שניות.",

    cancelOrder: "ביטול ההזמנה",
    cancelConfirmTitle: "לבטל את ההזמנה?",
    cancelConfirmBody: "אפשר להזמין שוב מהחנות בכל רגע.",
    keepOrder: "להשאיר",

    privacyTitle: "מה שמור אצלנו",
    privacyBody: "רק מה שכתבתם כאן וההזמנה עצמה. אפשר למחוק את הפרטים האישיים עכשיו.",
    forget: "מחיקת הפרטים שלי",
    forgetDone: "הפרטים נמחקו",
    forgetConfirmTitle: "למחוק את השם והטלפון?",
    forgetConfirmBody: "ההזמנה נשארת, בלי הפרטים האישיים.",

    retry: "ניסיון נוסף",
    backToShop: "חזרה לחנות",
    copySummary: "העתקת ההזמנה",
    viewOrder: "לצפייה בהזמנה",

    errors: {
      generic: "משהו השתבש. נסו שוב.",
      offline: "אין חיבור. בדקו את האינטרנט ונסו שוב.",
      rateLimited: "יותר מדי נסיונות. חכו רגע ונסו שוב.",
      unavailable: "חלק מהפריטים כבר לא זמינים — עדכנו את העגלה.",
      expired: "ההזמנה פגה. הזמינו מחדש.",
      alreadyPaid: "ההזמנה כבר שולמה.",
      providerDown: "שירות התשלומים לא זמין כרגע. אפשר לשלם בדלפק.",
      cartEmpty: "העגלה ריקה.",
      notFound: "לא מצאנו את ההזמנה.",
      disabled: "הזמנות סגורות כרגע.",
    },
  },

  manager: {
    title: "ניהול קטלוג",
    signIn: "כניסה",
    signInWithGoogle: "כניסה עם Google",
    signInBlurb: "האזור הזה מיועד לבעלי החנות בלבד.",
    signOut: "יציאה",
    signedInAs: "מחובר כ־",
    noAccessTitle: "אין הרשאה",
    noAccessMessage:
      "החשבון הזה מחובר אבל אינו מורשה לנהל את הקטלוג. פנו לבעל החנות כדי לקבל גישה.",

    tabs: { catalogue: "קטלוג", orders: "הזמנות", deals: "מבצעים", settings: "הגדרות" },

    categories: "קטגוריות",
    subclasses: "תתי־קטגוריות",
    products: "מוצרים",
    newCategory: "קטגוריה חדשה",
    newSubclass: "תת־קטגוריה חדשה",
    newProduct: "מוצר חדש",
    editCategory: "עריכת קטגוריה",
    editSubclass: "עריכת תת־קטגוריה",
    editProduct: "עריכת מוצר",
    noSubclass: "ללא תת־קטגוריה",
    directlyInCategory: "ישירות בקטגוריה",

    fields: {
      nameHe: "שם (עברית)",
      nameEn: "שם (אנגלית)",
      nameAr: "שם (ערבית)",
      descriptionHe: "תיאור (עברית)",
      descriptionEn: "תיאור (אנגלית)",
      descriptionAr: "תיאור (ערבית)",
      price: "מחיר ליחידה",
      category: "קטגוריה",
      subclass: "תת־קטגוריה",
      available: "זמין למכירה",
      visible: "מוצג בחנות",
      stock: "מלאי",
      stockHelper: "אפשר להשאיר ריק אם לא סופרים מלאי.",
      icon: "אייקון",
      tint: "צבע",
      photo: "תמונה",
      sortOrder: "סדר",
    },

    validation: {
      nameRequired: "חובה למלא שם בעברית",
      priceRequired: "חובה למלא מחיר",
      priceInvalid: "מחיר לא תקין",
      categoryRequired: "חובה לבחור קטגוריה",
      qtyInvalid: "הכמות חייבת להיות 2 ומעלה",
      bundleDearer: "מחיר המבצע יקר מהמחיר הרגיל לאותה כמות",
      duplicateQty: "כבר קיים מבצע לכמות הזו",
    },

    photos: {
      title: "תמונות",
      add: "הוספת תמונה",
      uploading: "מעלה…",
      uploadFailed: "ההעלאה נכשלה",
      tooLarge: "הקובץ גדול מדי (מקסימום 8MB)",
      wrongType: "סוג קובץ לא נתמך",
      removeAria: "הסרת התמונה",
      none: "אין עדיין תמונה",
      hint: "אפשר לצלם ישירות מהטלפון.",
    },

    orders: {
      title: "הזמנות",
      subtitle: "מה מחכה בדלפק.",
      openOnly: "פתוחות",
      all: "הכל",
      none: "אין הזמנות פתוחות",
      noneMessage: "הזמנה חדשה תופיע כאן ברגע שתישלח.",
      collect: "נמסר",
      collectAria: (number) => `סימון הזמנה ${number} כנמסרה`,
      cancel: "ביטול",
      cancelAria: (number) => `ביטול הזמנה ${number}`,
      confirmCancelTitle: (number) => `לבטל את הזמנה ${number}?`,
      confirmCancelBody: "הלקוח יראה שההזמנה בוטלה.",
      customer: "לקוח",
      noCustomer: "בלי שם",
      note: "הערה",
      copy: "העתקה",
      copied: "ההזמנה הועתקה",
      paidLabel: "שולם",
      unpaidLabel: "לא שולם",
      pendingLabel: "בתשלום",
      flaggedLabel: "לבדיקה",
      flaggedHelper: "הסכום שהתקבל שונה מסכום ההזמנה. אל תמסרו לפני בדיקה.",
      methodCounter: "בדלפק",
      methodCard: "כרטיס",
      statusPlaced: "פתוחה",
      statusCollected: "נמסרה",
      statusCancelled: "בוטלה",
      statusExpired: "פגה",
      itemsLine: (n) => (n === 1 ? "פריט אחד" : `${n} פריטים`),
      checkoutOff: "קבלת הזמנות כבויה בהגדרות — לקוחות לא יכולים לשלוח הזמנה חדשה.",
    },

    deals: {
      title: "מבצעים",
      subtitle: "מבצע חל על כל הפריטים בהיקף שנבחר — אפשר לשלב דגמים שונים.",
      none: "אין עדיין מבצעים",
      newDeal: "מבצע חדש",
      editDeal: "עריכת מבצע",
      scope: "חל על",
      scopeProduct: "מוצר בודד",
      scopeSubclass: "תת־קטגוריה",
      scopeCategory: "קטגוריה שלמה",
      scopeHint: "מבצע על מוצר בודד גובר על מבצע של תת־קטגוריה, וזה על מבצע של קטגוריה.",
      minQty: "כמות",
      bundlePrice: "מחיר המבצע",
      active: "פעיל",
      labelHe: "תווית (עברית)",
      startsAt: "מתחיל",
      endsAt: "מסתיים",
      ladderPreview: "כך זה ייראה בחנות",
      appliesTo: "חל על",
      perUnit: (price) => `${price} ליחידה`,
    },

    settingsScreen: {
      title: "הגדרות",
      shopSection: "החנות",
      paymentSection: "תשלום ויצירת קשר",
      checkoutSection: "הזמנות",
      appearanceSection: "מראה ושפה",
      checkoutEnabled: "לקבל הזמנות",
      checkoutEnabledHelper: "כשזה כבוי אפשר עדיין לעיין ולשלם בדלפק — פשוט בלי הזמנה מראש.",
      onlinePayments: "תשלום בכרטיס",
      onlinePaymentsHelper: "דורש חשבון סליקה פעיל.",
      onlinePaymentsUnavailable: "עדיין לא הוגדר ספק סליקה, אז האפשרות לא תוצג ללקוחות.",
      shopOpen: "החנות פתוחה",
      shopOpenHelper: "כשכבוי, המבקרים רואים הודעת סגירה במקום הקטלוג.",
      closedMessage: "הודעת סגירה",
      bitLink: "קישור לתשלום בביט",
      bitLinkHelper: "הקישור שנפתח בלחיצה על ״תשלום בביט״.",
      bitLinkInvalid: "צריך להיות קישור https תקין",
      whatsapp: "מספר וואטסאפ",
      whatsappHelper: "בפורמט בינלאומי, ספרות בלבד. לדוגמה: 972549109603",
      whatsappInvalid: "ספרות בלבד, בין 9 ל־15",
      announcement: "הודעה בראש החנות",
      announcementHelper: "אפשר להשאיר ריק.",
      staff: "צוות",
      staffHelper: "הזמנה נכנסת לתוקף כשהאדם נכנס עם אותה כתובת Google.",
      inviteEmail: "כתובת אימייל",
      inviteEmailInvalid: "כתובת אימייל לא תקינה",
      inviteRole: "הרשאה",
      roleOwner: "בעלים",
      roleStaff: "צוות",
      invite: "הזמנה",
      pendingInvites: "הזמנות ממתינות",
      noPendingInvites: "אין הזמנות ממתינות",
      revoke: "ביטול",
      revokeAria: (email) => `ביטול ההזמנה של ${email}`,
      langHe: "עברית",
      langEn: "English",
      langAr: "العربية",
    },

    confirmDelete: (name) => `למחוק את ${name}?`,
    confirmDeleteBody: "אי אפשר לבטל את הפעולה.",
    deleteBlocked: "אי אפשר למחוק — יש עדיין פריטים בפנים.",
    deleted: (name) => `${name} נמחק`,
    saved: "נשמר",
    saveFailed: "השמירה נכשלה",
    reorderHint: "סדר התצוגה בחנות",
    moveUp: "העברה למעלה",
    moveDown: "העברה למטה",
    itemCount: (n) => `${n} פריטים`,
    readOnlyTitle: "מצב קריאה בלבד",
    readOnlyMessage:
      "האתר עדיין לא מחובר למסד הנתונים, ולכן הקטלוג נטען מקובץ ואי אפשר לערוך. ראו docs/SETUP.md.",
  },
};

/* -------------------------------------------------------------------------- */

const en: Dict = {
  common: {
    appName: "3D Prints",
    cancel: "Cancel",
    save: "Save",
    saving: "Saving…",
    delete: "Delete",
    edit: "Edit",
    add: "Add",
    done: "Done",
    back: "Back",
    close: "Close",
    dismiss: "Dismiss",
    search: "Search",
    clearSearch: "Clear search",
    retry: "Try again",
    loading: "Loading…",
    all: "All",
    optional: "optional",
    required: "required",
    yes: "Yes",
    no: "No",
    language: "Language",
    appearance: "Appearance",
    light: "Light",
    dark: "Dark",
    settings: "Settings",
    somethingWentWrong: "Something went wrong",
  },

  landing: {
    eyebrow: "Offers · Gifts · 3D Prints",
    title: "Small prints with big character.",
    body: "A quick little shop next to the coffee truck: pick an item, check the price, pay with Bit at the counter.",
    browse: "Browse the shop",
    quickBit: "Know what you want? Straight to Bit",
    suggestions: "Got a suggestion or request? Message me",
    whatsappInquiry: "Hi, I came from the website and wanted to ask about 3D printing",
    whatsappSuggestion: "Hi, I came from the website and have a suggestion or request about 3D printing:",
    contactAria: "Contact me on WhatsApp",
  },

  shop: {
    title: "3D printed items",
    subtitle: "Pick what you want here, check the total, and pay with Bit at the counter.",
    searchPlaceholder: "Search items",
    cart: "Cart",
    cartAria: (count) => `Cart, ${count} items`,
    addToCart: "Add to cart",
    addedToCart: (name) => `${name} added to cart`,
    outOfStock: "Sold out",
    onlyLeft: (n) => `Only ${n} left`,
    emptyTitle: "Nothing here yet",
    emptyMessage: "The stand is restocked often — worth checking back soon.",
    noMatchesTitle: "No items found",
    noMatchesMessage: (query) => `Nothing matches “${query}”.`,
    loadErrorTitle: "Couldn't load the shop",
    loadErrorMessage: "Check your connection and try again.",
    closedTitle: "The shop is closed",
    bundleHint: (minQty, price) => `${minQty} for ${price}`,
    mixAndMatch: "Mix and match any designs",
    each: "each",
  },

  cart: {
    title: "Your cart",
    emptyTitle: "Your cart is empty",
    emptyMessage: "Add something from the shop and the total will appear here.",
    browse: "Browse the shop",
    subtotal: "Before deals",
    savings: "You saved",
    total: "Total",
    removeAria: (name) => `Remove ${name} from cart`,
    oneMore: "One more",
    oneFewer: "One fewer",
    copyOrderNote: "Copy order note",
    copied: "Order note copied",
    copyFailed: "Couldn't copy",
    payWithBit: "Pay with Bit",
    paymentNote: "Bit opens separately. Enter the amount by hand and paste the order note.",
    bitNotConfigured: "The payment link isn't set up yet — pay at the counter.",
    orderNoteHeading: "Order",
    clear: "Empty the cart",
    bundleApplied: (times, minQty) => `${minQty}-item deal · ${times}×`,
    placeOrder: "Place order",
    orderInstead: "Send the order and get a number for the counter.",
  },

  checkout: {
    title: "Checkout",
    steps: { review: "Cart", details: "Details", payment: "Payment" },
    stepAria: (index, total) => `Step ${index} of ${total}`,
    back: "Back",
    continue: "Continue",
    placeOrder: "Place order",
    placing: "Sending…",

    emptyTitle: "Nothing to order",
    emptyMessage: "Your cart is empty — add something from the shop.",
    disabledTitle: "Orders are closed right now",
    disabledMessage: "You can still browse and pay at the counter as usual.",

    detailsIntro: "All optional. A name helps us call you when it's ready.",
    name: "Name",
    namePlaceholder: "What to call you",
    optional: "Optional",
    phone: "Phone",
    phonePlaceholder: "050-0000000",
    phoneHelper: "Optional. Only if we need to call.",
    phoneInvalid: "That doesn't look like a phone number",
    note: "Note",
    notePlaceholder: "Anything we should know",
    honeypotLabel: "Company",

    method: "Payment",
    methodCounter: "Pay at the counter",
    methodCounterHelper: "Bit or cash, when you collect.",
    methodCard: "Pay by card",
    methodCardHelper: "On the payment provider's own secure page. Card details never pass through us.",
    methodCardUnavailable: "Card payment isn't available yet.",

    summary: "Summary",
    itemCount: (n) => (n === 1 ? "1 item" : `${n} items`),

    orderTitle: "Your order",
    orderNumber: "Order number",
    showAtCounter: "Show this screen at the counter.",
    payAtCounter: "Pay at the counter",
    payAtCounterHelper: "Bit or cash. We already have the amount.",
    payByCard: "Pay by card",
    payingTitle: "Taking you to payment",
    payingHelper: "Don't close this page until the payment finishes.",
    paymentWindow: "Payment page",
    expiresIn: (minutes) => `Held for another ${minutes} minutes`,
    expiredTitle: "This order expired",
    expiredMessage: "Prices change through the day, so it needs ordering again.",
    paidTitle: "Payment received",
    paidMessage: "Show the order number at the counter.",
    collectedTitle: "Order collected",
    collectedMessage: "Thanks — see you next time.",
    cancelledTitle: "Order cancelled",
    cancelledMessage: "You weren't charged. You can order again from the shop.",
    flaggedTitle: "This payment needs checking",
    flaggedMessage: "The amount received doesn't match the order. Come to the counter — please don't pay again.",
    awaitingTitle: "Waiting for payment",
    awaitingMessage: "If you've already paid, this screen updates within a few seconds.",

    cancelOrder: "Cancel this order",
    cancelConfirmTitle: "Cancel this order?",
    cancelConfirmBody: "You can order again from the shop at any time.",
    keepOrder: "Keep it",

    privacyTitle: "What we hold",
    privacyBody: "Only what you typed here, and the order itself. You can remove your personal details now.",
    forget: "Remove my details",
    forgetDone: "Details removed",
    forgetConfirmTitle: "Remove your name and phone number?",
    forgetConfirmBody: "The order stays; the personal details do not.",

    retry: "Try again",
    backToShop: "Back to the shop",
    copySummary: "Copy the order",
    viewOrder: "View the order",

    errors: {
      generic: "Something went wrong. Try again.",
      offline: "No connection. Check the internet and try again.",
      rateLimited: "Too many attempts. Wait a moment and try again.",
      unavailable: "Some items aren't available any more — update your cart.",
      expired: "This order expired. Please order again.",
      alreadyPaid: "This order is already paid.",
      providerDown: "Card payment isn't reachable right now. You can pay at the counter.",
      cartEmpty: "Your cart is empty.",
      notFound: "We couldn't find that order.",
      disabled: "Orders are closed right now.",
    },
  },

  manager: {
    title: "Catalogue manager",
    signIn: "Sign in",
    signInWithGoogle: "Sign in with Google",
    signInBlurb: "This area is for the shop owner.",
    signOut: "Sign out",
    signedInAs: "Signed in as",
    noAccessTitle: "No access",
    noAccessMessage:
      "This account is signed in but isn't allowed to manage the catalogue. Ask the shop owner for access.",

    tabs: { catalogue: "Catalogue", orders: "Orders", deals: "Deals", settings: "Settings" },

    categories: "Categories",
    subclasses: "Subclasses",
    products: "Products",
    newCategory: "New category",
    newSubclass: "New subclass",
    newProduct: "New product",
    editCategory: "Edit category",
    editSubclass: "Edit subclass",
    editProduct: "Edit product",
    noSubclass: "No subclass",
    directlyInCategory: "Directly in the category",

    fields: {
      nameHe: "Name (Hebrew)",
      nameEn: "Name (English)",
      nameAr: "Name (Arabic)",
      descriptionHe: "Description (Hebrew)",
      descriptionEn: "Description (English)",
      descriptionAr: "Description (Arabic)",
      price: "Price each",
      category: "Category",
      subclass: "Subclass",
      available: "Available to sell",
      visible: "Shown in the shop",
      stock: "Stock",
      stockHelper: "Leave empty if you don't count stock.",
      icon: "Icon",
      tint: "Colour",
      photo: "Photo",
      sortOrder: "Order",
    },

    validation: {
      nameRequired: "A Hebrew name is required",
      priceRequired: "A price is required",
      priceInvalid: "That price isn't valid",
      categoryRequired: "Pick a category",
      qtyInvalid: "Quantity must be 2 or more",
      bundleDearer: "This deal costs more than paying for the same count singly",
      duplicateQty: "There is already a deal for that quantity",
    },

    photos: {
      title: "Photos",
      add: "Add a photo",
      uploading: "Uploading…",
      uploadFailed: "Upload failed",
      tooLarge: "That file is too large (8MB max)",
      wrongType: "That file type isn't supported",
      removeAria: "Remove photo",
      none: "No photo yet",
      hint: "You can take one with the phone camera.",
    },

    orders: {
      title: "Orders",
      subtitle: "What is waiting at the counter.",
      openOnly: "Open",
      all: "All",
      none: "No open orders",
      noneMessage: "A new order appears here the moment it is sent.",
      collect: "Handed over",
      collectAria: (number) => `Mark order ${number} as handed over`,
      cancel: "Cancel",
      cancelAria: (number) => `Cancel order ${number}`,
      confirmCancelTitle: (number) => `Cancel order ${number}?`,
      confirmCancelBody: "The customer will see that it was cancelled.",
      customer: "Customer",
      noCustomer: "No name",
      note: "Note",
      copy: "Copy",
      copied: "Order copied",
      paidLabel: "Paid",
      unpaidLabel: "Unpaid",
      pendingLabel: "Paying",
      flaggedLabel: "Needs checking",
      flaggedHelper: "The amount received differs from the order total. Do not hand it over before checking.",
      methodCounter: "Counter",
      methodCard: "Card",
      statusPlaced: "Open",
      statusCollected: "Handed over",
      statusCancelled: "Cancelled",
      statusExpired: "Expired",
      itemsLine: (n) => (n === 1 ? "1 item" : `${n} items`),
      checkoutOff: "Accepting orders is switched off in Settings — customers cannot send a new one.",
    },

    deals: {
      title: "Deals",
      subtitle: "A deal covers everything in the scope you choose — different designs can be mixed.",
      none: "No deals yet",
      newDeal: "New deal",
      editDeal: "Edit deal",
      scope: "Applies to",
      scopeProduct: "One product",
      scopeSubclass: "A subclass",
      scopeCategory: "A whole category",
      scopeHint: "A product deal beats a subclass deal, which beats a category deal.",
      minQty: "Quantity",
      bundlePrice: "Deal price",
      active: "Active",
      labelHe: "Label (Hebrew)",
      startsAt: "Starts",
      endsAt: "Ends",
      ladderPreview: "How it will read in the shop",
      appliesTo: "Applies to",
      perUnit: (price) => `${price} each`,
    },

    settingsScreen: {
      title: "Settings",
      shopSection: "Shop",
      paymentSection: "Payment & contact",
      checkoutSection: "Orders",
      appearanceSection: "Appearance & language",
      checkoutEnabled: "Accept orders",
      checkoutEnabledHelper: "With this off, people can still browse and pay at the counter — they just cannot order ahead.",
      onlinePayments: "Card payment",
      onlinePaymentsHelper: "Needs an active merchant account.",
      onlinePaymentsUnavailable: "No payment provider is configured yet, so this stays hidden from customers.",
      shopOpen: "Shop is open",
      shopOpenHelper: "When off, visitors see a closed message instead of the catalogue.",
      closedMessage: "Closed message",
      bitLink: "Bit payment link",
      bitLinkHelper: "The page the “Pay with Bit” button opens.",
      bitLinkInvalid: "Must be a valid https link",
      whatsapp: "WhatsApp number",
      whatsappHelper: "International format, digits only. For example 972549109603",
      whatsappInvalid: "Digits only, 9 to 15 of them",
      announcement: "Banner at the top of the shop",
      announcementHelper: "Leave empty for none.",
      staff: "Staff",
      staffHelper: "An invite takes effect when that person signs in with the same Google address.",
      inviteEmail: "Email address",
      inviteEmailInvalid: "That isn't a valid email address",
      inviteRole: "Access",
      roleOwner: "Owner",
      roleStaff: "Staff",
      invite: "Invite",
      pendingInvites: "Pending invites",
      noPendingInvites: "No pending invites",
      revoke: "Revoke",
      revokeAria: (email) => `Revoke the invite for ${email}`,
      langHe: "עברית",
      langEn: "English",
      langAr: "العربية",
    },

    confirmDelete: (name) => `Delete ${name}?`,
    confirmDeleteBody: "This can't be undone.",
    deleteBlocked: "Can't delete — there are still items inside it.",
    deleted: (name) => `${name} deleted`,
    saved: "Saved",
    saveFailed: "Couldn't save",
    reorderHint: "Order shown in the shop",
    moveUp: "Move up",
    moveDown: "Move down",
    itemCount: (n) => `${n} items`,
    readOnlyTitle: "Read-only",
    readOnlyMessage:
      "The site isn't connected to the database yet, so the catalogue is loaded from a file and can't be edited. See docs/SETUP.md.",
  },
};

/* -------------------------------------------------------------------------- */

const ar: Dict = {
  common: {
    appName: "طباعة ثلاثية الأبعاد",
    cancel: "إلغاء",
    save: "حفظ",
    saving: "جارٍ الحفظ…",
    delete: "حذف",
    edit: "تعديل",
    add: "إضافة",
    done: "تم",
    back: "رجوع",
    close: "إغلاق",
    dismiss: "إغلاق",
    search: "بحث",
    clearSearch: "مسح البحث",
    retry: "حاول مرة أخرى",
    loading: "جارٍ التحميل…",
    all: "الكل",
    optional: "اختياري",
    required: "مطلوب",
    yes: "نعم",
    no: "لا",
    language: "اللغة",
    appearance: "المظهر",
    light: "فاتح",
    dark: "داكن",
    settings: "الإعدادات",
    somethingWentWrong: "حدث خطأ ما",
  },

  landing: {
    eyebrow: "عروض · هدايا · طباعة ثلاثية الأبعاد",
    title: "مطبوعات صغيرة بطابع مميز.",
    body: "متجر صغير وسريع بجانب عربة القهوة: اختر المنتج، شاهد السعر، وادفع عبر Bit عند الكاونتر.",
    browse: "إلى المتجر",
    quickBit: "تعرف ما تريد؟ مباشرة إلى Bit",
    suggestions: "لديك اقتراح أو طلب؟ راسلني",
    whatsappInquiry: "مرحباً، وصلت من الموقع وأود الاستفسار عن الطباعة ثلاثية الأبعاد",
    whatsappSuggestion: "مرحباً، وصلت من الموقع ولدي اقتراح أو طلب بخصوص الطباعة ثلاثية الأبعاد:",
    contactAria: "تواصل معي عبر واتساب",
  },

  shop: {
    title: "منتجات مطبوعة ثلاثية الأبعاد",
    subtitle: "اختر ما تريد هنا، شاهد المجموع، وادفع عبر Bit عند الكاونتر.",
    searchPlaceholder: "ابحث عن منتج",
    cart: "السلة",
    cartAria: (count) => `السلة، ${count} عناصر`,
    addToCart: "أضف إلى السلة",
    addedToCart: (name) => `تمت إضافة ${name} إلى السلة`,
    outOfStock: "نفد المخزون",
    onlyLeft: (n) => `بقي ${n} فقط`,
    emptyTitle: "لا توجد منتجات بعد",
    emptyMessage: "يتم تجديد المخزون باستمرار — تفقّد المتجر قريباً.",
    noMatchesTitle: "لم يتم العثور على منتجات",
    noMatchesMessage: (query) => `لا نتائج لـ «${query}».`,
    loadErrorTitle: "تعذّر تحميل المتجر",
    loadErrorMessage: "تحقق من الاتصال وحاول مرة أخرى.",
    closedTitle: "المتجر مغلق",
    bundleHint: (minQty, price) => `${minQty} بـ ${price}`,
    mixAndMatch: "يمكنك المزج بين التصاميم",
    each: "للقطعة",
  },

  cart: {
    title: "سلتك",
    emptyTitle: "السلة فارغة",
    emptyMessage: "أضف منتجاً من المتجر وسيظهر المجموع هنا.",
    browse: "إلى المتجر",
    subtotal: "قبل العروض",
    savings: "وفّرت",
    total: "المجموع",
    removeAria: (name) => `إزالة ${name} من السلة`,
    oneMore: "واحد إضافي",
    oneFewer: "واحد أقل",
    copyOrderNote: "نسخ ورقة الطلب",
    copied: "تم نسخ ورقة الطلب",
    copyFailed: "تعذّر النسخ",
    payWithBit: "الدفع عبر Bit",
    paymentNote: "سيفتح Bit بشكل منفصل. أدخل المبلغ يدوياً والصق ورقة الطلب.",
    bitNotConfigured: "رابط الدفع لم يُضبط بعد — ادفع عند الكاونتر.",
    orderNoteHeading: "طلب",
    clear: "إفراغ السلة",
    bundleApplied: (times, minQty) => `عرض ${minQty} قطع · ${times}×`,
    placeOrder: "إرسال الطلب",
    orderInstead: "أرسل الطلب واحصل على رقم للكاونتر.",
  },

  checkout: {
    title: "إتمام الطلب",
    steps: { review: "السلة", details: "التفاصيل", payment: "الدفع" },
    stepAria: (index, total) => `الخطوة ${index} من ${total}`,
    back: "رجوع",
    continue: "متابعة",
    placeOrder: "إرسال الطلب",
    placing: "جارٍ الإرسال…",

    emptyTitle: "لا يوجد ما يُطلب",
    emptyMessage: "السلة فارغة — أضف شيئاً من المتجر.",
    disabledTitle: "الطلبات مغلقة حالياً",
    disabledMessage: "يمكنك التصفّح والدفع عند الكاونتر كالمعتاد.",

    detailsIntro: "كل الحقول اختيارية. الاسم يساعدنا على مناداتك عند الجهوزية.",
    name: "الاسم",
    namePlaceholder: "بماذا نناديك",
    optional: "اختياري",
    phone: "الهاتف",
    phonePlaceholder: "050-0000000",
    phoneHelper: "اختياري. فقط إن احتجنا الاتصال.",
    phoneInvalid: "رقم الهاتف غير صحيح",
    note: "ملاحظة",
    notePlaceholder: "أي شيء يجدر بنا معرفته",
    honeypotLabel: "الشركة",

    method: "الدفع",
    methodCounter: "الدفع عند الكاونتر",
    methodCounterHelper: "Bit أو نقداً، عند الاستلام.",
    methodCard: "الدفع بالبطاقة",
    methodCardHelper: "على صفحة آمنة تخصّ شركة الدفع. بيانات البطاقة لا تمرّ عبرنا.",
    methodCardUnavailable: "الدفع بالبطاقة غير متاح بعد.",

    summary: "الملخّص",
    itemCount: (n) => (n === 1 ? "قطعة واحدة" : `${n} قطع`),

    orderTitle: "طلبك",
    orderNumber: "رقم الطلب",
    showAtCounter: "اعرض هذه الشاشة عند الكاونتر.",
    payAtCounter: "الدفع عند الكاونتر",
    payAtCounterHelper: "Bit أو نقداً. المبلغ محفوظ لدينا.",
    payByCard: "الدفع بالبطاقة",
    payingTitle: "جارٍ التحويل إلى الدفع",
    payingHelper: "لا تُغلق الصفحة حتى انتهاء الدفع.",
    paymentWindow: "صفحة الدفع",
    expiresIn: (minutes) => `الطلب محفوظ ${minutes} دقيقة أخرى`,
    expiredTitle: "انتهت صلاحية الطلب",
    expiredMessage: "الأسعار تتغيّر خلال اليوم، لذا يلزم إعادة الطلب.",
    paidTitle: "تم استلام الدفع",
    paidMessage: "اعرض رقم الطلب عند الكاونتر.",
    collectedTitle: "تم تسليم الطلب",
    collectedMessage: "شكراً، ونراك في المرة القادمة.",
    cancelledTitle: "تم إلغاء الطلب",
    cancelledMessage: "لم يتم خصم أي مبلغ. يمكنك الطلب مجدداً من المتجر.",
    flaggedTitle: "الدفع يحتاج مراجعة",
    flaggedMessage: "المبلغ المستلم لا يطابق الطلب. توجّه إلى الكاونتر — لا تدفع مرة أخرى.",
    awaitingTitle: "بانتظار الدفع",
    awaitingMessage: "إن كنت قد دفعت، ستتحدّث الشاشة خلال ثوانٍ.",

    cancelOrder: "إلغاء الطلب",
    cancelConfirmTitle: "إلغاء هذا الطلب؟",
    cancelConfirmBody: "يمكنك الطلب مجدداً من المتجر في أي وقت.",
    keepOrder: "الإبقاء عليه",

    privacyTitle: "ما نحتفظ به",
    privacyBody: "فقط ما كتبته هنا، والطلب نفسه. يمكنك حذف بياناتك الشخصية الآن.",
    forget: "حذف بياناتي",
    forgetDone: "تم حذف البيانات",
    forgetConfirmTitle: "حذف الاسم ورقم الهاتف؟",
    forgetConfirmBody: "يبقى الطلب، بدون البيانات الشخصية.",

    retry: "محاولة أخرى",
    backToShop: "العودة إلى المتجر",
    copySummary: "نسخ الطلب",
    viewOrder: "عرض الطلب",

    errors: {
      generic: "حدث خطأ ما. حاول مجدداً.",
      offline: "لا يوجد اتصال. تحقّق من الإنترنت وحاول مجدداً.",
      rateLimited: "محاولات كثيرة. انتظر قليلاً ثم حاول مجدداً.",
      unavailable: "بعض القطع لم تعد متوفّرة — حدّث السلة.",
      expired: "انتهت صلاحية الطلب. أعد الطلب من فضلك.",
      alreadyPaid: "تم دفع هذا الطلب مسبقاً.",
      providerDown: "خدمة الدفع غير متاحة حالياً. يمكنك الدفع عند الكاونتر.",
      cartEmpty: "السلة فارغة.",
      notFound: "لم نعثر على الطلب.",
      disabled: "الطلبات مغلقة حالياً.",
    },
  },

  manager: {
    title: "إدارة الكتالوج",
    signIn: "تسجيل الدخول",
    signInWithGoogle: "الدخول عبر Google",
    signInBlurb: "هذه المنطقة مخصصة لصاحب المتجر.",
    signOut: "تسجيل الخروج",
    signedInAs: "مسجّل الدخول كـ",
    noAccessTitle: "لا توجد صلاحية",
    noAccessMessage:
      "هذا الحساب مسجّل الدخول لكنه غير مخوّل لإدارة الكتالوج. تواصل مع صاحب المتجر للحصول على صلاحية.",

    tabs: { catalogue: "الكتالوج", orders: "الطلبات", deals: "العروض", settings: "الإعدادات" },

    categories: "الفئات",
    subclasses: "الفئات الفرعية",
    products: "المنتجات",
    newCategory: "فئة جديدة",
    newSubclass: "فئة فرعية جديدة",
    newProduct: "منتج جديد",
    editCategory: "تعديل الفئة",
    editSubclass: "تعديل الفئة الفرعية",
    editProduct: "تعديل المنتج",
    noSubclass: "بدون فئة فرعية",
    directlyInCategory: "مباشرة ضمن الفئة",

    fields: {
      nameHe: "الاسم (بالعبرية)",
      nameEn: "الاسم (بالإنجليزية)",
      nameAr: "الاسم (بالعربية)",
      descriptionHe: "الوصف (بالعبرية)",
      descriptionEn: "الوصف (بالإنجليزية)",
      descriptionAr: "الوصف (بالعربية)",
      price: "السعر للقطعة",
      category: "الفئة",
      subclass: "الفئة الفرعية",
      available: "متاح للبيع",
      visible: "معروض في المتجر",
      stock: "المخزون",
      stockHelper: "اتركه فارغاً إذا كنت لا تحصي المخزون.",
      icon: "الأيقونة",
      tint: "اللون",
      photo: "الصورة",
      sortOrder: "الترتيب",
    },

    validation: {
      nameRequired: "الاسم بالعبرية مطلوب",
      priceRequired: "السعر مطلوب",
      priceInvalid: "السعر غير صالح",
      categoryRequired: "اختر فئة",
      qtyInvalid: "يجب أن تكون الكمية 2 أو أكثر",
      bundleDearer: "سعر العرض أغلى من سعر نفس الكمية بالقطعة",
      duplicateQty: "يوجد عرض لهذه الكمية بالفعل",
    },

    photos: {
      title: "الصور",
      add: "إضافة صورة",
      uploading: "جارٍ الرفع…",
      uploadFailed: "فشل الرفع",
      tooLarge: "الملف كبير جداً (8MB كحد أقصى)",
      wrongType: "نوع الملف غير مدعوم",
      removeAria: "إزالة الصورة",
      none: "لا توجد صورة بعد",
      hint: "يمكنك التصوير مباشرة بالهاتف.",
    },

    orders: {
      title: "الطلبات",
      subtitle: "ما ينتظر عند الكاونتر.",
      openOnly: "المفتوحة",
      all: "الكل",
      none: "لا توجد طلبات مفتوحة",
      noneMessage: "سيظهر الطلب الجديد هنا فور إرساله.",
      collect: "تم التسليم",
      collectAria: (number) => `تعليم الطلب ${number} كمُسلَّم`,
      cancel: "إلغاء",
      cancelAria: (number) => `إلغاء الطلب ${number}`,
      confirmCancelTitle: (number) => `إلغاء الطلب ${number}؟`,
      confirmCancelBody: "سيرى الزبون أنّ الطلب أُلغي.",
      customer: "الزبون",
      noCustomer: "بدون اسم",
      note: "ملاحظة",
      copy: "نسخ",
      copied: "تم نسخ الطلب",
      paidLabel: "مدفوع",
      unpaidLabel: "غير مدفوع",
      pendingLabel: "قيد الدفع",
      flaggedLabel: "يحتاج مراجعة",
      flaggedHelper: "المبلغ المستلم يختلف عن مجموع الطلب. لا تُسلّم قبل المراجعة.",
      methodCounter: "الكاونتر",
      methodCard: "بطاقة",
      statusPlaced: "مفتوح",
      statusCollected: "تم التسليم",
      statusCancelled: "ملغى",
      statusExpired: "منتهٍ",
      itemsLine: (n) => (n === 1 ? "قطعة واحدة" : `${n} قطع`),
      checkoutOff: "استقبال الطلبات مُوقَف في الإعدادات — لا يستطيع الزبائن إرسال طلب جديد.",
    },

    deals: {
      title: "العروض",
      subtitle: "العرض يشمل كل ما ضمن النطاق المختار — يمكن المزج بين التصاميم.",
      none: "لا توجد عروض بعد",
      newDeal: "عرض جديد",
      editDeal: "تعديل العرض",
      scope: "ينطبق على",
      scopeProduct: "منتج واحد",
      scopeSubclass: "فئة فرعية",
      scopeCategory: "فئة كاملة",
      scopeHint: "عرض المنتج يتقدّم على عرض الفئة الفرعية، وهذا يتقدّم على عرض الفئة.",
      minQty: "الكمية",
      bundlePrice: "سعر العرض",
      active: "مفعّل",
      labelHe: "التسمية (بالعبرية)",
      startsAt: "يبدأ",
      endsAt: "ينتهي",
      ladderPreview: "هكذا سيظهر في المتجر",
      appliesTo: "ينطبق على",
      perUnit: (price) => `${price} للقطعة`,
    },

    settingsScreen: {
      title: "الإعدادات",
      shopSection: "المتجر",
      paymentSection: "الدفع والتواصل",
      checkoutSection: "الطلبات",
      appearanceSection: "المظهر واللغة",
      checkoutEnabled: "استقبال الطلبات",
      checkoutEnabledHelper: "عند الإيقاف يبقى التصفّح والدفع عند الكاونتر ممكناً — دون طلب مسبق فقط.",
      onlinePayments: "الدفع بالبطاقة",
      onlinePaymentsHelper: "يتطلّب حساب دفع فعّالاً.",
      onlinePaymentsUnavailable: "لم يُضبط مزوّد دفع بعد، لذا يبقى هذا مخفياً عن الزبائن.",
      shopOpen: "المتجر مفتوح",
      shopOpenHelper: "عند الإيقاف، يرى الزوار رسالة إغلاق بدل الكتالوج.",
      closedMessage: "رسالة الإغلاق",
      bitLink: "رابط الدفع عبر Bit",
      bitLinkHelper: "الصفحة التي يفتحها زر «الدفع عبر Bit».",
      bitLinkInvalid: "يجب أن يكون رابط https صالحاً",
      whatsapp: "رقم واتساب",
      whatsappHelper: "بصيغة دولية، أرقام فقط. مثال: 972549109603",
      whatsappInvalid: "أرقام فقط، من 9 إلى 15 رقماً",
      announcement: "شريط أعلى المتجر",
      announcementHelper: "اتركه فارغاً لإخفائه.",
      staff: "الطاقم",
      staffHelper: "تسري الدعوة عندما يسجّل الشخص الدخول بنفس عنوان Google.",
      inviteEmail: "البريد الإلكتروني",
      inviteEmailInvalid: "البريد الإلكتروني غير صالح",
      inviteRole: "الصلاحية",
      roleOwner: "مالك",
      roleStaff: "طاقم",
      invite: "دعوة",
      pendingInvites: "دعوات معلّقة",
      noPendingInvites: "لا توجد دعوات معلّقة",
      revoke: "إلغاء",
      revokeAria: (email) => `إلغاء دعوة ${email}`,
      langHe: "עברית",
      langEn: "English",
      langAr: "العربية",
    },

    confirmDelete: (name) => `حذف ${name}؟`,
    confirmDeleteBody: "لا يمكن التراجع عن هذا.",
    deleteBlocked: "لا يمكن الحذف — ما زالت هناك عناصر بداخله.",
    deleted: (name) => `تم حذف ${name}`,
    saved: "تم الحفظ",
    saveFailed: "تعذّر الحفظ",
    reorderHint: "الترتيب المعروض في المتجر",
    moveUp: "نقل لأعلى",
    moveDown: "نقل لأسفل",
    itemCount: (n) => `${n} عناصر`,
    readOnlyTitle: "للقراءة فقط",
    readOnlyMessage:
      "الموقع غير متصل بقاعدة البيانات بعد، لذا يُحمَّل الكتالوج من ملف ولا يمكن تعديله. راجع docs/SETUP.md.",
  },
};

const DICT: Record<Locale, Dict> = { he, en, ar };

/** For server components, which have no context. Defaults to Hebrew. */
export function dictFor(locale: Locale): Dict {
  return DICT[locale];
}
