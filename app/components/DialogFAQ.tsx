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
    question: "How do I...?",
    answer:
      "<ul class='faq-list'>" +
      "<li><strong>Create a product</strong> — click <strong>New Product</strong> (top of the Products page), fill out the form, and click <strong>Create Product</strong>. This takes a minute; you'll be notified in the status line and with a toast on success or failure. It's sheet-only and stays a Draft — nothing appears on the live site until you also publish it from the <strong>⋯</strong> menu on that product.</li>" +
      "<li><strong>Edit a product</strong> — open the product's <strong>⋯</strong> menu and choose <strong>Edit</strong>. Make your changes and click <strong>Sync changes</strong> — this always saves and pushes to the site and the sheet automatically (unless the product has not been published to the site). It never changes whether the product is published or hidden via Draft mode.</li>" +
      "<li><strong>Publish or unpublish a product</strong> — open the <strong>⋯</strong> menu and click <strong>Status</strong> (or <strong>Publish to site</strong> if it's never been on the site before), then confirm. This is the only action that flips Draft ⇄ Published.</li>" +
      "<li><strong>Add variants</strong> — open the <strong>⋯</strong> menu and choose <strong>Add Variants</strong>. You can choose a combination of colors, sizes, and dimensions but know that there is very strong deduplication programmed in. The dimensions take precedence so while it seems like your variants should be unique, they may be flagged. If you're having trouble, please dont hesitate to contact your developer.</li>" +
      "<li><strong>Edit or delete one variant</strong> — in the variant table on that product, find the column labeled 'Actions' and use the pencil (edit) or trash (delete) icon in that row. If you delete the last variant of a product, you'll be asked to either convert to a 'simple' product or delete the entire product.</li>" +
      "<li><strong>Delete a product</strong> — open the <strong>⋯</strong> menu and choose <strong>Delete</strong>. If it was ever published, this also removes it from WooCommerce — there's no undo.</li>" +
      "<li><strong>Sync everything at once</strong> — use the <strong>Sync All</strong> button at the top of the Products page. This will sync any products that have changes and you'l be asked if you also want to publish any products that have never been published to the site.</li>" +
      "<li><strong>Adjust Inventory</strong> — Navigate to the <a href='/inventory'>Inventory page</a> and adjust the stock quantity for a simple product or a variant. <ul>If a product has: <li><strong class='clr-danger'>Conflicts</strong> (the warehouse stock differs from the stock currently on the website), you can resolve them by choosing the 'resolve conflicts' mode or finding the product by the <span class='clr-danger'>&middot;</span>.</li><li><strong class='clr-warning'>Out of Stock</strong> (the website stock is 0) adjust the warehouse stock quantity and sync changes.</li><li><strong class='clr-accent'>New changes</strong> (the warehouse stock has been altered) as indicated by <span class='clr-accent'>&middot;</span>. You can choose to sync with 'sync changes' mode to only push these products, or with mode 'custom select' and your changes are automatically included in the selection.</li></ul> </li>" +
      "</ul>",
  },
  {
    question:
      'What do "Unpublished", "Draft", "Content Unsynced", "Published", and "Sync" actually mean?',
    answer:
      "<p><strong>States (what it currently is):</strong></p>" +
      "<ul class='faq-list'>" +
      "<li><strong>Unpublished</strong> — never created in WooCommerce at all (no Woo ID yet). Nothing to sync, nothing on the site.</li>" +
      "<li><strong>Draft</strong> — exists in WooCommerce (has a Woo ID) but hidden from customers.</li>" +
      "<li><strong>Content Unsynced</strong> — a change exists in the sheet or in this app that hasnt been resolved; it differs from the last content the site received. Use the 'Status' button to sync changes or will be included when using 'Sync All'.</li>" +
      "<li><strong>Published</strong> — exists in WooCommerce and is live/visible.</li>" +
      "</ul>" +
      "<p><strong>Actions (what a button does):</strong></p>" +
      "<ul class='faq-list'>" +
      "<li><strong>Sync changes</strong> (Edit Product, Edit Variant, Add Variants) — always pushes your content to WooCommerce automatically, whether the product is currently Draft or Published. It never changes which one it is.</li>" +
      "<li><strong>Publish status</strong> / <strong>Publish to site</strong> (on the product card) — the only button that changes Draft ⇄ Published. This is a separate, deliberate choice from editing content.</li>" +
      "</ul>" +
      "<p>In short: editing and saving is automatic and always safe. Making something visible or hidden is a manual switch you flip on the product card, on purpose.</p>",
  },
  {
    question: "Why doesn't my product have an image after I publish it?",
    answer:
      "<p>Images aren't attached automatically — whatever you upload or link is sent to the dev team to optimize and watermark by hand, then attached manually. That happens after the product is already live, so it's normal for a freshly published product to sit with no image for a bit. If you don't want it live until the image is ready, leave it as a Draft and publish it once the image is in place — the publish confirm dialog will also warn you if you're about to go live with no image yet.</p>",
  },
  {
    question: "Why am I asked for a stock quantity when publishing?",
    answer:
      "<p>A product going live with zero declared stock would show as out-of-stock (or unpurchaseable) immediately. Whenever something is about to become visible for the first time (or a brand-new variant is being pushed to an existing product) with no stock recorded, you'll get a quick prompt to enter a starting quantity instead of it silently going live empty. An existing, already-synced item that's genuinely sold out won't re-trigger this just because you synced the product for an unrelated reason.</p>",
  },
  {
    question: "Why can't I add this color/size/dimension combination?",
    answer:
      '<p>Either that exact combination already exists as a variant on this product, or two of your current selections would resolve to the same SKU as each other (most often because a dimension was picked alongside multiple sizes — dimension always wins over size in the SKU, so "3\\"x5\\" + Large" and "3\\"x5\\" + no size" are actually the same variant). The error message lists exactly which selections are conflicting.</p>',
  },
  {
    question: 'What does a "Stock Conflict" mean on the Inventory page?',
    answer:
      "<p>It means the sheet's stock quantity and what's actually live on WooCommerce disagree for that SKU — usually because an order sold through the site (or someone edited stock directly in wp-admin) since the last sync. The Inventory page's \"Stock Conflicts\" count and the chips underneath it list which products are affected.</p>" +
      '<p>To fix it: under "Select edit mode," choose <strong>Resolve Conflicts</strong>, then <strong>Push Stock</strong>. This pushes the sheet\'s current numbers to WooCommerce for exactly the mismatched SKUs, leaving everything else untouched.</p>',
  },
  {
    question: "How do I remove an image that's already on the site?",
    answer:
      "<p>Open Edit Product — the \"Current images on site\" section shows the product's live gallery plus any variant-specific images, each with its own Remove button. This reads directly from WooCommerce, so it always reflects what's actually live.</p>",
  },
  {
    question: "What happens when I delete the last variant of a product?",
    answer:
      "<p>You're asked whether you want to delete the entire product entry or convert it back to a simple product (no variants). Since stock was tracked per-variant before, the now-simple product starts with no stock of its own — you'll be prompted for a starting quantity the same way as any other first-time publish.</p>",
  },
  {
    question:
      "I deleted something that was on the site — is it really gone from WooCommerce too?",
    answer:
      "<p>Yes. Deleting a product or variant here also permanently deletes it from WooCommerce if it has a Woo ID — this is true whether it's currently Published or sitting as a Draft. There's no undo, so double-check before confirming a delete.</p>",
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
              <div
                className="faq-content padding-1 surface-secondary small "
                dangerouslySetInnerHTML={{ __html: entry.answer }}
              />
            </details>
          ))}
        </div>
      </div>
    </dialog>
  );
}
