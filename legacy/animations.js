// animations.js
// Vanilla Motion (https://motion.dev) — resolved via the importmap in index.html.
// This file is a starting point; add more animations as the site grows.

import { animate } from "motion";

// Animate the hero card in on first load.
const heroCard = document.querySelector(".hero-card");
if (heroCard) {
  animate(
    heroCard,
    { opacity: [0, 1], transform: ["translateY(16px)", "translateY(0)"] },
    { duration: 0.6, easing: "ease-out" }
  );
}
