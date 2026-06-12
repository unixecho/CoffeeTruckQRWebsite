const PRODUCTS_URL = "data/products.json";
const BIT_PAYMENT_LINK =
  "https://www.bitpay.co.il/app/me/2436F027-F158-1BBB-5486-B4ED45C3DC40E2A1"; // replace later

const WHATSAPP_PHONE = "972549109603";
const WHATSAPP_MESSAGE =
  "היי, הגעתי אלייך דרך האתר לגבי יצירת קשר להדפסת תלת מימד";

let products = [];
let activeCategory = "all";
let cart = {};
let currentLanguage = localStorage.getItem("siteLanguage") || "he";

const RTL_LANGUAGES = ["he", "ar"];

const i18n = {
  he: {
    landingEyebrow: "מוצרים · מתנות · הדפסות תלת־ממד",
    landingTitle: "גלו הדפסות קטנות שעושות וואו.",
    landingText:
      "חנות קטנה ומהירה למוצרי תלת־ממד ליד עגלת הקפה: בוחרים מוצר, רואים מחיר, ומשלמים בביט בדלפק.",
    buyAtTruck: "קנייה בדוכן",
    onlineSoon: "הזמנות אונליין · בקרוב",
    quickBit: "⚡ יודעים מה אתם רוצים? ישר לביט",

    storeEyebrow: "חנות פיזית",
    storeTitle: "מוצרים מודפסים בתלת־ממד",
    cart: "עגלה",
    infoBanner: "בוחרים כאן מוצרים, רואים את הסכום בסוף, ואז משלמים בביט.",
    yourSelection: "הבחירה שלך",
    cartSummary: "סיכום עגלה",
    total: 'סה"כ',
    copyOrderNote: "העתק פתק הזמנה",
    payWithBit: "תשלום בביט",
    paymentNote:
      "אפליקציית ביט תיפתח בנפרד. יש להזין ידנית את הסכום ולהדביק את פתק ההזמנה.",
    all: "הכל",
    addToCart: "הוסף לעגלה",
    noItemsInCategory: "אין כרגע מוצרים זמינים בקטגוריה הזו.",
    cartEmpty: "העגלה ריקה.",
    loadError: "לא ניתן לטעון את המוצרים. בדוק שקובץ data/products.json קיים.",

    messages: {
      added: "נוסף לעגלה",
      copied: "פתק ההזמנה הועתק",
      copyError: "לא ניתן להעתיק",
      cartEmpty: "העגלה ריקה",
    },

    categories: {
      keychains: "מחזיקי מפתחות",
      magnets: "מגנטים",
      homeDecor: "דקורציה לבית",
      figures: "דמויות",
      customPrints: "הדפסות בהתאמה אישית",
    },

    orderPrefix: "הדפסות תלת־ממד",
    orderTotal: 'סה"כ',
  },

  en: {
    landingEyebrow: "Offers · Gifts · 3D Prints",
    landingTitle: "Explore small prints with big character.",
    landingText:
      "A fast mini-store for 3D printed gifts near the coffee truck: pick an item, check the price, and pay with Bit at the counter.",
    buyAtTruck: "Buy at the Truck",
    onlineSoon: "Online Ordering · Coming Soon",
    quickBit: "⚡ Know what you want? Straight to Bit",

    storeEyebrow: "Physical Store",
    storeTitle: "3D Printed Items",
    cart: "Cart",
    infoBanner: "Choose items here, review the total, and then pay with Bit.",
    yourSelection: "Your Selection",
    cartSummary: "Cart Summary",
    total: "Total",
    copyOrderNote: "Copy Order Note",
    payWithBit: "Pay with Bit",
    paymentNote:
      "Bit will open separately. Please enter the amount manually and paste the order note.",
    all: "All",
    addToCart: "Add to Cart",
    noItemsInCategory: "No available items in this category right now.",
    cartEmpty: "Your cart is empty.",
    loadError: "Could not load products. Check that data/products.json exists.",

    messages: {
      added: "Added to cart",
      copied: "Order note copied",
      copyError: "Could not copy",
      cartEmpty: "Cart is empty",
    },

    categories: {
      keychains: "Keychains",
      magnets: "Magnets",
      homeDecor: "Home Decor",
      figures: "Figures",
      customPrints: "Custom Prints",
    },

    orderPrefix: "Coffee Truck 3D Prints",
    orderTotal: "Total",
  },

  ar: {
    landingEyebrow: "عروض · هدايا · طباعة ثلاثية الأبعاد",
    landingTitle: "اكتشف مطبوعات صغيرة بطابع مميز.",
    landingText:
      "متجر سريع لهدايا مطبوعة ثلاثية الأبعاد قرب عربة القهوة: اختر المنتج، شاهد السعر، وادفع عبر Bit عند الكاونتر.",
    buyAtTruck: "الشراء من العربة",
    onlineSoon: "الطلب أونلاين · قريباً",
    quickBit: "⚡ تعرف ماذا تريد؟ مباشرة إلى Bit",

    storeEyebrow: "المتجر الفعلي",
    storeTitle: "منتجات مطبوعة ثلاثية الأبعاد",
    cart: "السلة",
    infoBanner: "اختر المنتجات هنا، شاهد المجموع النهائي، ثم ادفع عبر Bit.",
    yourSelection: "اختياراتك",
    cartSummary: "ملخص السلة",
    total: "المجموع",
    copyOrderNote: "نسخ ملاحظة الطلب",
    payWithBit: "الدفع عبر Bit",
    paymentNote:
      "سيتم فتح تطبيق Bit بشكل منفصل. يرجى إدخال المبلغ يدوياً ولصق ملاحظة الطلب.",
    all: "الكل",
    addToCart: "أضف إلى السلة",
    noItemsInCategory: "لا توجد منتجات متاحة حالياً في هذه الفئة.",
    cartEmpty: "السلة فارغة.",
    loadError: "تعذر تحميل المنتجات. تأكد من وجود الملف data/products.json.",

    messages: {
      added: "تمت الإضافة إلى السلة",
      copied: "تم نسخ ملاحظة الطلب",
      copyError: "تعذر النسخ",
      cartEmpty: "السلة فارغة",
    },

    categories: {
      keychains: "ميداليات",
      magnets: "مغناطيسات",
      homeDecor: "ديكور منزلي",
      figures: "مجسمات",
      customPrints: "مطبوعات مخصصة",
    },

    orderPrefix: "مطبوعات ثلاثية الأبعاد",
    orderTotal: "المجموع",
  },
};

const landingView = document.getElementById("landingView");
const storeView = document.getElementById("storeView");
const openStoreBtn = document.getElementById("openStoreBtn");
const backToLandingBtn = document.getElementById("backToLandingBtn");

const productsGrid = document.getElementById("productsGrid");
const categoryFilters = document.getElementById("categoryFilters");

const cartToggleBtn = document.getElementById("cartToggleBtn");
const closeCartBtn = document.getElementById("closeCartBtn");
const cartDrawer = document.getElementById("cartDrawer");
const overlay = document.getElementById("overlay");

const cartCount = document.getElementById("cartCount");
const cartItems = document.getElementById("cartItems");
const cartTotal = document.getElementById("cartTotal");

const copyNoteBtn = document.getElementById("copyNoteBtn");
const payWithBitBtn = document.getElementById("payWithBitBtn");
const toast = document.getElementById("toast");

const langSwitcher = document.getElementById("langSwitcher");
const langToggleBtn = document.getElementById("langToggleBtn");

const landingBitBtn = document.getElementById("landingBitBtn");

const productModal = document.getElementById("productModal");
const closeModalBtn = document.getElementById("closeModalBtn");
const modalImage = document.getElementById("modalImage");
const modalName = document.getElementById("modalName");
const modalPrice = document.getElementById("modalPrice");
const modalDescription = document.getElementById("modalDescription");
const modalAddBtn = document.getElementById("modalAddBtn");

let modalProductId = null;

openStoreBtn.addEventListener("click", () => {
  landingView.classList.add("hidden");
  storeView.classList.remove("hidden");
  window.scrollTo(0, 0);
});

backToLandingBtn.addEventListener("click", () => {
  storeView.classList.add("hidden");
  landingView.classList.remove("hidden");
  window.scrollTo(0, 0);
});

cartToggleBtn.addEventListener("click", openCart);
closeCartBtn.addEventListener("click", closeCart);
overlay.addEventListener("click", closeCart);

copyNoteBtn.addEventListener("click", copyOrderNote);
payWithBitBtn.addEventListener("click", payWithBit);

landingBitBtn.addEventListener("click", () => {
  window.open(BIT_PAYMENT_LINK, "_blank");
});

document.getElementById(
  "whatsappWidget"
).href = `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(
  WHATSAPP_MESSAGE
)}`;

closeModalBtn.addEventListener("click", closeProductModal);
productModal.addEventListener("click", (event) => {
  if (event.target === productModal) closeProductModal();
});
modalAddBtn.addEventListener("click", () => {
  if (modalProductId) addToCart(modalProductId, modalAddBtn);
});
modalImage.addEventListener("error", () => {
  modalImage.style.display = "none";
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeProductModal();
    closeCart();
    closeLanguageMenu();
  }
});

langToggleBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  langSwitcher.classList.toggle("open");
});

document.querySelectorAll(".lang-option").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    setLanguage(button.dataset.lang);
  });
});

document.addEventListener("click", (event) => {
  const clickedInside = langSwitcher.contains(event.target);
  if (!clickedInside) {
    closeLanguageMenu();
  }
});

setLanguage(currentLanguage);
loadProducts();

function t(key) {
  return i18n[currentLanguage][key];
}

function setLanguage(lang) {
  if (!i18n[lang]) return;

  currentLanguage = lang;
  localStorage.setItem("siteLanguage", lang);

  document.documentElement.lang = lang;
  document.documentElement.dir = RTL_LANGUAGES.includes(lang) ? "rtl" : "ltr";

  document.querySelectorAll(".lang-option").forEach((button) => {
    button.classList.toggle("active", button.dataset.lang === lang);
  });

  updateStaticText();
  renderCategories();
  renderProducts();
  renderCart();
  refreshProductModal();
  closeLanguageMenu();
}

function closeLanguageMenu() {
  langSwitcher.classList.remove("open");
}

function updateStaticText() {
  document.getElementById("landingEyebrow").textContent = t("landingEyebrow");
  document.getElementById("landingTitle").textContent = t("landingTitle");
  document.getElementById("landingText").textContent = t("landingText");
  document.getElementById("openStoreBtn").textContent = t("buyAtTruck");
  document.getElementById("onlineOrderingBtn").textContent = t("onlineSoon");
  document.getElementById("landingBitBtn").textContent = t("quickBit");

  document.getElementById("storeEyebrow").textContent = t("storeEyebrow");
  document.getElementById("storeTitle").textContent = t("storeTitle");
  document.getElementById("cartLabel").textContent = t("cart");
  document.getElementById("infoBanner").textContent = t("infoBanner");

  document.getElementById("cartEyebrow").textContent = t("yourSelection");
  document.getElementById("cartTitle").textContent = t("cartSummary");
  document.getElementById("totalLabel").textContent = t("total");
  document.getElementById("copyNoteBtn").textContent = t("copyOrderNote");
  document.getElementById("payWithBitBtn").textContent = t("payWithBit");
  document.getElementById("paymentNote").textContent = t("paymentNote");

  backToLandingBtn.textContent = RTL_LANGUAGES.includes(currentLanguage)
    ? "→"
    : "←";
}

async function loadProducts() {
  try {
    const response = await fetch(PRODUCTS_URL);

    if (!response.ok) {
      throw new Error("Could not load products.json");
    }

    const data = await response.json();

    // Sort products by price ascending (lowest to highest) by default
    products = data.sort((a, b) => a.price - b.price);

    renderCategories();
    renderProducts();
    renderCart();
  } catch (error) {
    console.error(error);
    productsGrid.innerHTML = `
      <div class="cart-empty">
        ${t("loadError")}
      </div>
    `;
  }
}

function getLocalizedValue(value) {
  if (typeof value === "string") return value;
  if (!value) return "";
  return value[currentLanguage] || value.he || value.en || value.ar || "";
}

function getLocalizedTags(product) {
  if (!product.tags) return [];
  return (
    product.tags[currentLanguage] ||
    product.tags.he ||
    product.tags.en ||
    product.tags.ar ||
    []
  );
}

function getCategoryLabel(categoryKey) {
  if (categoryKey === "all") return t("all");
  return i18n[currentLanguage].categories[categoryKey] || categoryKey;
}

function renderCategories() {
  const categoryKeys = [
    "all",
    ...new Set(products.map((product) => product.categoryKey)),
  ];

  categoryFilters.innerHTML = categoryKeys
    .map(
      (categoryKey) => `
      <button
        class="category-btn ${categoryKey === activeCategory ? "active" : ""}"
        data-category="${categoryKey}"
      >
        ${getCategoryLabel(categoryKey)}
      </button>
    `
    )
    .join("");

  document.querySelectorAll(".category-btn").forEach((button) => {
    button.addEventListener("click", () => {
      activeCategory = button.dataset.category;
      renderCategories();
      renderProducts();
    });
  });
}

function renderProducts() {
  const filteredProducts =
    activeCategory === "all"
      ? products
      : products.filter((product) => product.categoryKey === activeCategory);

  const availableProducts = filteredProducts.filter(
    (product) => product.available
  );

  if (availableProducts.length === 0) {
    productsGrid.innerHTML = `
      <div class="cart-empty">
        ${t("noItemsInCategory")}
      </div>
    `;
    return;
  }

  productsGrid.innerHTML = availableProducts
    .map((product, index) => {
      const name = getLocalizedValue(product.name);
      const description = getLocalizedValue(product.description);
      const tags = getLocalizedTags(product);

      return `
        <article class="product-card" data-id="${product.id}" style="--card-index: ${index}">
          <div class="product-image-box">
            <img
              class="product-image"
              src="${product.image}"
              alt="${name}"
              onerror="this.style.display='none'; this.nextElementSibling.style.display='grid';"
            />
            <div class="product-image-placeholder">3D</div>
          </div>

          <div class="product-content">
            <div class="product-top">
              <div class="product-name">${name}</div>
              <div class="product-price">₪${product.price}</div>
            </div>

            <p class="product-description">${description}</p>

            <div class="product-tags">
              ${tags.map((tag) => `<span class="tag">${tag}</span>`).join("")}
            </div>

            <button class="add-btn" data-id="${product.id}">
              ${t("addToCart")}
            </button>
          </div>
        </article>
      `;
    })
    .join("");

  document.querySelectorAll(".products-grid .add-btn").forEach((button) => {
    button.addEventListener("click", () => {
      addToCart(button.dataset.id, button);
    });
  });

  document.querySelectorAll(".product-card").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest(".add-btn")) return;
      openProductModal(card.dataset.id);
    });
  });
}

function openProductModal(productId) {
  const product = products.find((item) => item.id === productId);
  if (!product) return;

  modalProductId = productId;
  modalImage.style.display = "";
  modalImage.src = product.image;
  modalImage.alt = getLocalizedValue(product.name);
  modalName.textContent = getLocalizedValue(product.name);
  modalPrice.textContent = `₪${product.price}`;
  modalDescription.textContent = getLocalizedValue(product.description);
  modalAddBtn.textContent = t("addToCart");

  productModal.classList.add("open");
  document.body.classList.add("no-scroll");
}

function refreshProductModal() {
  if (!modalProductId || !productModal.classList.contains("open")) return;
  openProductModal(modalProductId);
}

function closeProductModal() {
  productModal.classList.remove("open");
  modalProductId = null;

  if (!cartDrawer.classList.contains("open")) {
    document.body.classList.remove("no-scroll");
  }
}

function addToCart(productId, sourceButton) {
  // 1. Core State Update
  cart[productId] = (cart[productId] || 0) + 1;
  renderCart();
  showToast(i18n[currentLanguage].messages.added);

  // 2. Locate Interface Elements for the Micro-interactions
  const clickedButton =
    sourceButton ||
    document.querySelector(`.add-btn[data-id="${productId}"]`);
  const cartTargetContainer = document.getElementById("cartToggleBtn");

  // Safety fallback if buttons are missing from view context
  if (!clickedButton || !cartTargetContainer) return;

  // 3. Extract exact screen positions
  const btnRect = clickedButton.getBoundingClientRect();
  const cartRect = cartTargetContainer.getBoundingClientRect();

  // Create the flying particle node
  const particle = document.createElement("div");
  particle.className = "flying-particle";

  // Center the particle on the clicked "Add to Cart" button coordinate origin
  const originX = btnRect.left + btnRect.width / 2 - 8;
  const originY = btnRect.top + btnRect.height / 2 - 8;

  particle.style.left = `${originX}px`;
  particle.style.top = `${originY}px`;
  document.body.appendChild(particle);

  // 4. Trigger the translation animation path toward the header cart container
  requestAnimationFrame(() => {
    const targetX = cartRect.left + cartRect.width / 2 - 8;
    const targetY = cartRect.top + cartRect.height / 2 - 8;

    const moveX = targetX - originX;
    const moveY = targetY - originY;

    particle.style.transform = `translate(${moveX}px, ${moveY}px) scale(0.4)`;
    particle.style.opacity = "0.2";
  });

  // 5. Cleanup particle and trigger the Cart Container Highlight/Shake on impact
  setTimeout(() => {
    particle.remove();

    // Force reset the animation container wrapper class if clicked rapidly
    cartTargetContainer.classList.remove("cart-highlight-active");
    void cartTargetContainer.offsetWidth; // Trigger DOM reflow to re-arm keyframes

    cartTargetContainer.classList.add("cart-highlight-active");
  }, 600); // Transitions finish exactly inside the 600ms window
}

function removeFromCart(productId) {
  if (!cart[productId]) return;

  cart[productId] -= 1;

  if (cart[productId] <= 0) {
    delete cart[productId];
  }

  renderCart();
}

function getCartProducts() {
  return Object.keys(cart)
    .map((productId) => {
      const product = products.find((item) => item.id === productId);
      if (!product) return null;

      const localizedName = getLocalizedValue(product.name);
      const quantity = cart[productId];
      let lineTotal = 0;

      // Check if product has special wholesale pricing tiers (e.g. 1 for 10, 3 for 25, 5 for 35)
      if (
        product.pricingTier &&
        Array.isArray(product.pricingTier) &&
        product.pricingTier.length > 0
      ) {
        // Sort tiers descending by quantity requirement to apply largest bundles first
        const sortedTiers = [...product.pricingTier].sort(
          (a, b) => b.qty - a.qty
        );
        let remainingQty = quantity;

        for (const tier of sortedTiers) {
          if (remainingQty >= tier.qty) {
            const bundleCount = Math.floor(remainingQty / tier.qty);
            lineTotal += bundleCount * tier.price;
            remainingQty = remainingQty % tier.qty;
          }
        }
        // Catch any remaining standalone items at standard base price
        if (remainingQty > 0) {
          lineTotal += remainingQty * product.price;
        }
      } else {
        // Fallback default calculation if no bulk scheme is set
        lineTotal = quantity * product.price;
      }

      return {
        ...product,
        localizedName,
        quantity,
        lineTotal,
      };
    })
    .filter(Boolean);
}

function getCartTotal() {
  return getCartProducts().reduce((sum, item) => sum + item.lineTotal, 0);
}

function getCartCount() {
  return Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);
}

function renderCart() {
  const cartProducts = getCartProducts();

  cartCount.textContent = getCartCount();
  cartTotal.textContent = `₪${getCartTotal()}`;

  if (cartProducts.length === 0) {
    cartItems.innerHTML = `
      <div class="cart-empty">
        ${t("cartEmpty")}
      </div>
    `;
    return;
  }

  cartItems.innerHTML = cartProducts
    .map(
      (item) => `
      <div class="cart-item">
        <div>
          <div class="cart-item-name">${item.localizedName}</div>
          <div class="cart-item-price">₪${item.price} × ${item.quantity} = ₪${item.lineTotal}</div>
        </div>

        <div class="qty-controls">
          <button class="qty-btn decrease-btn" data-id="${item.id}">−</button>
          <span class="qty-number">${item.quantity}</span>
          <button class="qty-btn increase-btn" data-id="${item.id}">+</button>
        </div>
      </div>
    `
    )
    .join("");

  document.querySelectorAll(".increase-btn").forEach((button) => {
    button.addEventListener("click", () =>
      addToCart(button.dataset.id, button)
    );
  });

  document.querySelectorAll(".decrease-btn").forEach((button) => {
    button.addEventListener("click", () => removeFromCart(button.dataset.id));
  });
}

function openCart() {
  cartDrawer.classList.add("open");
  overlay.classList.add("open");
  document.body.classList.add("no-scroll");
}

function closeCart() {
  cartDrawer.classList.remove("open");
  overlay.classList.remove("open");
  document.body.classList.remove("no-scroll");
}

function buildOrderNote() {
  const cartProducts = getCartProducts();

  if (cartProducts.length === 0) {
    return `${t("orderPrefix")} - ${t("cartEmpty")}`;
  }

  const itemLines = cartProducts
    .map((item) => `${item.quantity}x ${item.localizedName}`)
    .join(", ");

  return `${t("orderPrefix")} - ${itemLines} - ${t(
    "orderTotal"
  )} ₪${getCartTotal()}`;
}

async function copyOrderNote() {
  const note = buildOrderNote();

  try {
    await navigator.clipboard.writeText(note);
    showToast(i18n[currentLanguage].messages.copied);
  } catch (error) {
    console.error(error);
    showToast(i18n[currentLanguage].messages.copyError);
  }
}

function payWithBit() {
  if (getCartCount() === 0) {
    showToast(i18n[currentLanguage].messages.cartEmpty);
    return;
  }

  window.open(BIT_PAYMENT_LINK, "_blank");
}

let toastTimer = null;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 1600);
}
