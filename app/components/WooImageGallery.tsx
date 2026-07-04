import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useToast } from "~/context/ToastContext";
import type { CatalogGroup } from "~/types/catalog";

interface WooImage {
  id: number;
  src: string;
  name: string;
}

interface WooVariationImage {
  wooVariantId: number;
  sku: string;
  image: WooImage;
}

interface WooImageGalleryProps {
  group: CatalogGroup;
  disabled?: boolean;
}

export default function WooImageGallery({
  group,
  disabled,
}: WooImageGalleryProps) {
  const { showToast } = useToast();
  const [images, setImages] = useState<WooImage[] | null>(null);
  const [variantImages, setVariantImages] = useState<
    WooVariationImage[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [removingKey, setRemovingKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/catalog/product/${encodeURIComponent(group.sku)}/woo_images`, {
      credentials: "include",
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (!data.ok) throw new Error(data.error || "Failed to load images");
        setImages(data.images);
        setVariantImages(data.variantImages ?? []);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load images",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [group.sku]);

  const handleRemoveProductImage = async (imageId: number) => {
    setRemovingKey(`product:${imageId}`);
    try {
      const res = await fetch(
        `/api/catalog/product/${encodeURIComponent(group.sku)}/woo_images/${imageId}`,
        { method: "DELETE", credentials: "include" },
      );
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to remove image");
      setImages(data.images);
      showToast("Image removed from site", "success");
    } catch (err) {
      showToast(
        `Failed to remove image: ${err instanceof Error ? err.message : "Unknown error"}`,
        "error",
      );
    } finally {
      setRemovingKey(null);
    }
  };

  const handleRemoveVariantImage = async (wooVariantId: number) => {
    setRemovingKey(`variant:${wooVariantId}`);
    try {
      const res = await fetch(
        `/api/catalog/woo_variant_image/${group.wooId}/${wooVariantId}`,
        { method: "DELETE", credentials: "include" },
      );
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Failed to remove image");
      setVariantImages((prev) =>
        (prev ?? []).filter((vi) => vi.wooVariantId !== wooVariantId),
      );
      showToast("Variant image removed from site", "success");
    } catch (err) {
      showToast(
        `Failed to remove variant image: ${err instanceof Error ? err.message : "Unknown error"}`,
        "error",
      );
    } finally {
      setRemovingKey(null);
    }
  };

  if (error) {
    return (
      <p className="xsmall clr-danger">
        Could not load current site images: {error}
      </p>
    );
  }

  if (!images || !variantImages) {
    return (
      <p role="status" className="xsmall clr-muted">
        Loading current site images…
      </p>
    );
  }

  if (images.length === 0 && variantImages.length === 0) {
    return <p className="xsmall clr-muted">No images currently on site.</p>;
  }

  return (
    <fieldset className="form-fieldset grid gap-1">
      <legend className="bold">Current images on site</legend>

      {images.length > 0 && (
        <ul className="woo-image-gallery" role="list">
          {images.map((img) => (
            <li
              key={img.id}
              className="woo-image-gallery__item"
            >
              <img
                className="woo-image-thumb"
                src={img.src}
                alt={img.name || "Product image"}
              />
              <button
                type="button"
                className="row ai-cen jc-cen gap-quarter xsmall fw-wrap"
                aria-label={`Remove ${img.name || "image"} from site`}
                onClick={() => void handleRemoveProductImage(img.id)}
                disabled={disabled || removingKey !== null}
              >
                {removingKey === `product:${img.id}` ? (
                  <span className="render-loader">Removing…</span>
                ) : (
                  <>
                    <X size={14} aria-hidden="true" />
                    <span>Remove</span>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {variantImages.length > 0 && (
        <div className="grid gap-half">
          <p className="xsmall bold clr-muted">Variant images</p>
          <ul className="woo-image-gallery" role="list">
            {variantImages.map((vi) => {
              const label =
                group.rows.find((r) => r.sku === vi.sku)?.label ?? vi.sku;
              return (
                <li
                  key={vi.wooVariantId}
                  className="woo-image-gallery__item"
                >
                  <img
                    className="woo-image-thumb"
                    src={vi.image.src}
                    alt={vi.image.name || label}
                  />
                  <p className="xsmall clr-muted ta-cen">{label}</p>
                  <button
                    type="button"
                    className="row ai-cen jc-cen gap-quarter xsmall fw-wrap"
                    aria-label={`Remove ${label} image from site`}
                    onClick={() =>
                      void handleRemoveVariantImage(vi.wooVariantId)
                    }
                    disabled={disabled || removingKey !== null}
                  >
                    {removingKey === `variant:${vi.wooVariantId}` ? (
                      <span className="render-loader">Removing…</span>
                    ) : (
                      <>
                        <X size={14} aria-hidden="true" />
                        <span>Remove</span>
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </fieldset>
  );
}
