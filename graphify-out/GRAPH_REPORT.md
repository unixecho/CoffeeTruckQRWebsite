# Graph Report - .  (2026-06-16)

## Corpus Check
- 17 files · ~288,222 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 88 nodes · 116 edges · 10 communities (8 shown, 2 thin omitted)
- Extraction: 87% EXTRACTED · 13% INFERRED · 0% AMBIGUOUS · INFERRED: 15 edges (avg confidence: 0.8)
- Token cost: 105,869 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Cart UI Elements & i18n State|Cart UI Elements & i18n State]]
- [[_COMMUNITY_Storefront Page & Features|Storefront Page & Features]]
- [[_COMMUNITY_Package Manifest|Package Manifest]]
- [[_COMMUNITY_Cart & Checkout Logic|Cart & Checkout Logic]]
- [[_COMMUNITY_ESLint Config|ESLint Config]]
- [[_COMMUNITY_Product Rendering & Localization|Product Rendering & Localization]]
- [[_COMMUNITY_Decorative 3D Prints|Decorative 3D Prints]]
- [[_COMMUNITY_Novelty 3D Prints|Novelty 3D Prints]]
- [[_COMMUNITY_Fidget Sculptures|Fidget Sculptures]]
- [[_COMMUNITY_Ice Quartz Display|Ice Quartz Display]]

## God Nodes (most connected - your core abstractions)
1. `renderCart()` - 9 edges
2. `t()` - 7 edges
3. `Coffee Truck 3D Prints Page` - 7 edges
4. `setLanguage()` - 6 edges
5. `Cart Drawer` - 6 edges
6. `loadProducts()` - 5 edges
7. `buildOrderNote()` - 5 edges
8. `Store View` - 5 edges
9. `renderProducts()` - 4 edges
10. `getCartProducts()` - 4 edges

## Surprising Connections (you probably didn't know these)
- `CoffeeTruckQRWebsite Project Overview` --references--> `Coffee Truck 3D Prints Page`  [INFERRED]
  README.md → index.html
- `Articulated Dragon (3D-Printed Flexi Toy)` --semantically_similar_to--> `Fidget Tower (Tiered Spinning Fidget Toy)`  [INFERRED] [semantically similar]
  assets/articulated-dragon.png → assets/fidget-tower.png
- `Geometric Fidget Sculpture` --semantically_similar_to--> `Hex Spinner Fidget`  [INFERRED] [semantically similar]
  assets/geometric-fidget.png → assets/hex-spinner.png
- `Prank Coffee Mug ('Relax' Spiral Overflow)` --semantically_similar_to--> `Spiral Fidget Toy (Twisted Cone)`  [INFERRED] [semantically similar]
  assets/prank-coffee-mug.jpg → assets/spiral-fidget.png
- `Articulated Dragon (3D-Printed Flexi Toy)` --conceptually_related_to--> `Custom Sign (Dancing Figurine Display Piece)`  [INFERRED]
  assets/articulated-dragon.png → assets/custom-sign.png

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Single-Page View Navigation Flow** — index_landing_view, index_store_view, index_cart_drawer [INFERRED 0.85]
- **Store Browsing and Filtering Pipeline** — index_category_filters, index_products_grid, index_cart_drawer [INFERRED 0.85]
- **Cart Checkout Completion Flow** — index_cart_drawer, index_bit_payment, index_copy_note [INFERRED 0.85]
- **3D-Printed Product Line** — assets_articulated_dragon, assets_custom_sign, assets_fidget_tower [INFERRED 0.85]
- **3D-Printed Decorative Display Objects** — assets_geometric_fidget, assets_hex_spinner, assets_ice_quartz [INFERRED 0.75]
- **3D-Printed Novelty Products** — assets_keychain_star, assets_prank_coffee_mug, assets_spiral_fidget [INFERRED 0.85]

## Communities (10 total, 2 thin omitted)

### Community 0 - "Cart UI Elements & i18n State"
Cohesion: 0.07
Nodes (23): backToLandingBtn, cart, cartCount, cartDrawer, cartItems, cartToggleBtn, cartTotal, categoryFilters (+15 more)

### Community 1 - "Storefront Page & Features"
Cohesion: 0.29
Nodes (12): app.js Frontend Logic, Pay With Bit Checkout, Cart Drawer, Category Filters, Copy Order Note Action, Landing View, Multilingual Language Switcher (he/en/ar), Coffee Truck 3D Prints Page (+4 more)

### Community 2 - "Package Manifest"
Cohesion: 0.17
Nodes (11): author, description, devDependencies, serve, keywords, license, main, name (+3 more)

### Community 3 - "Cart & Checkout Logic"
Cohesion: 0.29
Nodes (10): addToCart(), buildOrderNote(), copyOrderNote(), getCartCount(), getCartProducts(), getCartTotal(), payWithBit(), removeFromCart() (+2 more)

### Community 4 - "ESLint Config"
Cohesion: 0.22
Nodes (8): env, browser, es2021, extends, parser, parserOptions, ecmaVersion, sourceType

### Community 5 - "Product Rendering & Localization"
Cohesion: 0.36
Nodes (8): closeLanguageMenu(), getCategoryLabel(), loadProducts(), renderCategories(), renderProducts(), setLanguage(), t(), updateStaticText()

### Community 6 - "Decorative 3D Prints"
Cohesion: 1.00
Nodes (3): Articulated Dragon (3D-Printed Flexi Toy), Custom Sign (Dancing Figurine Display Piece), Fidget Tower (Tiered Spinning Fidget Toy)

### Community 7 - "Novelty 3D Prints"
Cohesion: 0.67
Nodes (3): Star / Novelty Keychains Market Display, Prank Coffee Mug ('Relax' Spiral Overflow), Spiral Fidget Toy (Twisted Cone)

## Knowledge Gaps
- **45 isolated node(s):** `browser`, `es2021`, `extends`, `parser`, `ecmaVersion` (+40 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **2 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Are the 3 inferred relationships involving `Cart Drawer` (e.g. with `app.js Frontend Logic` and `Products Grid`) actually correct?**
  _`Cart Drawer` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `browser`, `es2021`, `extends` to the rest of the system?**
  _45 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Cart UI Elements & i18n State` be split into smaller, more focused modules?**
  _Cohesion score 0.07142857142857142 - nodes in this community are weakly interconnected._