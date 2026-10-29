/**
 * @fileoverview The sample trip's photos: drawings, not pictures.
 *
 * The sample is written in one transaction on the first open, offline as
 * often as not, so its photos cannot be fetched. They are small SVG drawings
 * kept as text here and turned into blobs by the seed. A drawing is also
 * honest about being an example: nobody mistakes it for the real house.
 *
 * The sample is never uploaded, and the bucket refuses SVG, so these bytes
 * never leave the device (see `uploadPendingPhotos`).
 *
 * @module features/trips/utils/sample-trip-photos
 */

// ============================================================================
// Drawings
// ============================================================================

/** A stone farmhouse with blue shutters, lavender and an olive tree. */
const HOUSE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">
<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8ec5e8"/><stop offset="1" stop-color="#f6e7c8"/></linearGradient></defs>
<rect width="320" height="180" fill="url(#s)"/>
<circle cx="262" cy="38" r="16" fill="#ffd36b"/>
<path d="M0 118 Q80 98 160 112 T320 106 V180 H0Z" fill="#b9c98a"/>
<rect x="104" y="66" width="120" height="58" fill="#e7cfa6"/>
<path d="M96 70 L164 38 L232 70Z" fill="#c8664a"/>
<rect x="118" y="80" width="18" height="18" fill="#5b8fb9"/><rect x="190" y="80" width="18" height="18" fill="#5b8fb9"/>
<rect x="155" y="92" width="20" height="32" fill="#4a7fa8"/>
<g fill="#8a76c4"><rect x="0" y="136" width="320" height="6" rx="3"/><rect x="0" y="150" width="320" height="7" rx="3"/><rect x="0" y="165" width="320" height="8" rx="4"/></g>
<rect x="262" y="96" width="6" height="34" fill="#7a5a3a"/><ellipse cx="265" cy="88" rx="26" ry="18" fill="#7f9a5a"/>
</svg>`;

/** A double bed under a window onto the olive trees. */
const MAIN_BEDROOM = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">
<rect width="320" height="180" fill="#f3ead9"/>
<rect x="0" y="132" width="320" height="48" fill="#c9a77c"/>
<rect x="196" y="28" width="84" height="64" fill="#9fd0ee" stroke="#ffffff" stroke-width="6"/>
<ellipse cx="226" cy="80" rx="18" ry="10" fill="#7f9a5a"/><ellipse cx="258" cy="76" rx="16" ry="9" fill="#6f8a4c"/>
<rect x="40" y="70" width="12" height="76" fill="#8a5a3a"/>
<rect x="46" y="100" width="150" height="34" rx="6" fill="#ffffff"/>
<rect x="46" y="116" width="150" height="22" rx="4" fill="#5b8fb9"/>
<rect x="56" y="92" width="38" height="16" rx="6" fill="#fdf7ee"/><rect x="98" y="92" width="38" height="16" rx="6" fill="#fdf7ee"/>
<rect x="196" y="110" width="6" height="36" fill="#8a5a3a"/>
</svg>`;

/** A tent under a fig tree, at dusk. */
const GARDEN_TENT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180">
<defs><linearGradient id="d" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f2a65a"/><stop offset="1" stop-color="#f7d9a8"/></linearGradient></defs>
<rect width="320" height="180" fill="url(#d)"/>
<rect x="0" y="128" width="320" height="52" fill="#9bb37a"/>
<rect x="232" y="64" width="10" height="72" fill="#6b4a2e"/>
<ellipse cx="236" cy="56" rx="54" ry="34" fill="#5f7d43"/>
<path d="M70 136 L130 68 L190 136Z" fill="#d9603b"/>
<path d="M130 68 L130 136 L150 136Z" fill="#a8452a"/>
<path d="M118 136 L130 104 L142 136Z" fill="#3a2a22"/>
<circle cx="292" cy="30" r="4" fill="#fff6d8"/><circle cx="40" cy="22" r="3" fill="#fff6d8"/>
</svg>`;

// ============================================================================
// Exports
// ============================================================================

/** The sample's drawings, by what they show. */
export const SAMPLE_PHOTOS = {
  house: HOUSE,
  master: MAIN_BEDROOM,
  tent: GARDEN_TENT,
} as const;

/**
 * Turns a drawing into the blob the photo cache stores.
 *
 * @param svg - The drawing's source
 * @returns An `image/svg+xml` blob
 */
export function samplePhotoBlob(svg: string): Blob {
  return new Blob([svg], { type: 'image/svg+xml' });
}
