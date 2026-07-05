import { X } from "lucide-react";
import { useEffect, useRef } from "react";

interface DialogFAQProps {
  onClose: () => void;
}

// Hardcoded on purpose — this is short enough that a code change is fine,
// and keeps it in the same review/deploy flow as everything else. Edit
// this array directly to add/update entries.
const FAQ_ENTRIES: Array<{ question: string; answer: string }> = [
  {
    question:
      'What do "Unpublished," "Draft," "Published," and "Sync" actually mean?',
    answer:
      '<ul><li>"Unpublished" = this product/variant has never been created in WooCommerce at all (no Woo ID yet) — nothing to sync, nothing on the site.</li><li> "Draft" = it exists in WooCommerce (has a Woo ID) but isn\'t visible to customers — either created as a draft, or previously live and taken down. </li><li>"Published" = it exists in WooCommerce and is live/visible. </li><li>"Sync" is a verb, not a state: it means pushing your current name/description/price/etc. to WooCommerce — it never changes Draft/Published status by itself, no matter which of the three states above currently applies. Only the product card\'s own button ("Publish to site" or "Publish status") ever changes Draft ⇄ Published — Edit Product, Edit Variant, and Add Variants all just sync content and leave status exactly as it is.</li></ul>',
  },
  {
    question: "Why doesn't my product have an image after I publish it?",
    answer:
      "Images aren't attached automatically — whatever you upload or link is sent to the dev team to optimize and watermark by hand, then attached manually. That happens after the product is already live, so it's normal for a freshly published product to sit with no image for a bit. If you don't want it live until the image is ready, leave it as a Draft and publish it once the image is in place — the publish confirm dialog will also warn you if you're about to go live with no image yet.",
  },
  {
    question: "Why am I asked for a stock quantity when publishing?",
    answer:
      "A product going live with zero declared stock would show as out-of-stock (or unpurchaseable) immediately. Whenever something is about to become visible for the first time (or a brand-new variant is being pushed to an existing product) with no stock recorded, you'll get a quick prompt to enter a starting quantity instead of it silently going live empty. An existing, already-synced item that's genuinely sold out won't re-trigger this just because you synced the product for an unrelated reason.",
  },
  {
    question: "Why can't I add this color/size/dimension combination?",
    answer:
      'Either that exact combination already exists as a variant on this product, or two of your current selections would resolve to the same SKU as each other (most often because a dimension was picked alongside multiple sizes — dimension always wins over size in the SKU, so "3\\"x5\\" + Large" and "3\\"x5\\" + no size" are actually the same variant). The error message lists exactly which selections are conflicting.',
  },
  {
    question: "How do I remove an image that's already on the site?",
    answer:
      "Open Edit Product — the \"Current images on site\" section shows the product's live gallery plus any variant-specific images, each with its own Remove button. This reads directly from WooCommerce, so it always reflects what's actually live.",
  },
  {
    question: "What happens when I delete the last variant of a product?",
    answer:
      "Youre asked whether you want to delete the entire product entry or convert it back to a simple product (no variants). Since stock was tracked per-variant before, the now-simple product starts with no stock of its own — you'll be prompted for a starting quantity the same way as any other first-time publish.",
  },
  {
    question:
      "I deleted something that was on the site — is it really gone from WooCommerce too?",
    answer:
      "Yes. Deleting a product or variant here also permanently deletes it from WooCommerce if it has a Woo ID — this is true whether it's currently Published or sitting as a Draft. There's no undo, so double-check before confirming a delete.",
  },
];

export default function DialogFAQ({ onClose }: DialogFAQProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog ref={ref} className="dialog-faq card" onCancel={onClose}>
      <div className="grid gap-1half dialog-inner">
        <div className="row jc-sb ai-cen">
          <h2>FAQ</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <X aria-hidden="true" />
          </button>
        </div>

        <div className="grid gap-1">
          {FAQ_ENTRIES.map((entry) => (
            <details key={entry.question} className="faq-entry toggle-group">
              <summary className="bold">{entry.question}</summary>
              <div className="faq-content padding-1 surface-secondary">
                <p className="small clr-muted">{entry.answer}</p>
              </div>
            </details>
          ))}
        </div>
      </div>
    </dialog>
  );
}
