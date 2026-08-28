import { useEffect, useState, type ReactNode } from "react";
import { getGameAssetUrl } from "../../lib/supabase.js";

export function SpriteFrame({ children, size = "md", className = "", selected = false }: { children: ReactNode; size?: "xs" | "sm" | "md" | "lg" | "hero"; className?: string; selected?: boolean }) {
  return <span className={`sprite-frame sprite-frame-${size} ${selected ? "selected" : ""} ${className}`.trim()}>{children}</span>;
}

export function Sprite({
  name,
  element,
  assetPath,
  size = "medium",
  locked,
  flipped,
  fit = "contain",
}: {
  name: string;
  element: string;
  assetPath?: string | null;
  size?: "small" | "medium" | "large" | "hero";
  locked?: boolean;
  flipped?: boolean;
  fit?: "contain" | "portrait";
}) {
  const [failedAssetPath, setFailedAssetPath] = useState<string | null>(null);
  const src = !locked && assetPath && failedAssetPath !== assetPath ? getGameAssetUrl(assetPath) : null;
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  useEffect(() => {
    setFailedAssetPath(null);
  }, [assetPath]);

  return (
    <span
      className={`sprite sprite-${size} sprite-fit-${fit} element-${element} ${src ? "has-asset" : ""} ${locked ? "locked" : ""} ${
        flipped ? "flipped" : ""
      }`}
      data-sprite-box
    >
      {src ? (
        <img
          src={src}
          alt={name}
          className={`sprite-box__image ${fit === "portrait" ? "portrait-sprite-image" : ""}`.trim()}
          data-sprite-image
          decoding="async"
          loading={size === "hero" || size === "small" ? "eager" : "lazy"}
          onError={() => setFailedAssetPath(assetPath ?? null)}
        />
      ) : locked ? "?" : initials}
    </span>
  );
}

export function AssetIcon({
  path,
  alt,
  loading = "lazy",
  fallback,
}: {
  path?: string | null;
  alt: string;
  loading?: "lazy" | "eager";
  fallback: ReactNode;
}) {
  const [failedAssetPath, setFailedAssetPath] = useState<string | null>(null);
  const src = path && failedAssetPath !== path ? getGameAssetUrl(path) : null;

  useEffect(() => {
    setFailedAssetPath(null);
  }, [path]);

  if (!src && fallback === null) return null;
  return (
    <span className="asset-icon" data-sprite-box>
      {src ? (
        <img
          className="asset-icon__image sprite-box__image"
          src={src}
          alt={alt}
          data-sprite-image
          decoding="async"
          loading={loading}
          onError={() => setFailedAssetPath(path ?? null)}
        />
      ) : fallback}
    </span>
  );
}
