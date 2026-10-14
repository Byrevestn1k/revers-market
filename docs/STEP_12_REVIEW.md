# Step 12 — Buy Request UX parity: review notes

**Status:** READY FOR INDEPENDENT REVIEW; no merge or push to `main`.

## Actual differences found before implementation

- Product already had a category tree, location editor, photo upload and image card. Buy Request reused the tree and location editor, but had no persisted photos, no gallery and no image on its cards.
- Buy Request creation and editing used separate forms. Editing did not expose photos; its locked terms needed to account for existing Deals as well as Seller Offers.
- The generic card image needs a category image index. The Buy Request API omitted it, so unrelated categories showed the same fallback illustration.
- Product has no separate category-specific attribute fields in its current schema/UI. Step 12 therefore does not introduce them for requests.

## Implementation and reuse

- A Buy Request photo table and local storage path support up to eight uploaded photos. The API validates type, byte signature, size and ownership, and retains/reorders/removes existing photos during edits.
- The request forms reuse `ListingBasics`, `QuantityFields`, `CurrencyField`, `ListingLocationFields` and `CategoryPicker`. `PhotoPicker` is shared by request creation and editing; Product's existing photo editor remains unchanged.
- Cards reuse Product's `ListingPicture` and the category illustration. Request detail uses `RequestGallery`; the first photo is also available to map markers.
- The API locks agreed quantity/unit/category/currency after an Offer or Deal. Price and receipt edits do not alter the Deal's stored terms. Existing subscriptions keep the optional budget behavior.
- The local browser scenario creates and cleans its own QA accounts and photo files.

## Review focus and boundaries

- Check photo storage and cleanup on transaction failure, retaining/removing photos, and the 56 MB Buy Request request-body limit.
- Check owner, seller, guest and unrelated-user visibility, plus agreement snapshots after request edits.
- Check `/my/requests`, `/requests`, `/favorites`, request detail and mobile controls. Map clustering and keyboard language switching were not redesigned.
- Independent REVIEW PASS and integration into `main` are still required before Step 12 can be called complete.
